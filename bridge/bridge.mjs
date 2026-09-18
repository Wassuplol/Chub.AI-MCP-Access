/***
 MCP Access — Local Bridge
 =========================
 A zero-dependency Node relay that lets the browser stage reach servers
 it otherwise couldn't:

   • Remote HTTP APIs/MCP endpoints without CORS headers (Tavily MCP, …)
   • Local HTTP services the browser blocks (ComfyUI, Qllama, Qdrant, …)

 Routes:
   GET  /health                     → liveness probe
   ANY  /cors/<encodeURIComponent(url)>            → relay (full URL, e.g. MCP endpoints)
   ANY  /corsbase/<encodeURIComponent(base)>/<path> → relay for REST APIs (base + path)
        (append ?token=… if started with a token)

 The relay answers CORS + Private-Network-Access preflights and streams
 responses (including SSE) back to the stage.

 Run:   npm run bridge            (or: node bridge/bridge.mjs [port])
 Optional env: BRIDGE_TOKEN=secret   BRIDGE_PORT=7360
 ***/
import http from 'node:http';
import {Readable} from 'node:stream';

const PORT = parseInt(process.env.BRIDGE_PORT || process.argv[2] || '7360', 10);
const TOKEN = process.env.BRIDGE_TOKEN || '';

const HOP_REQUEST = new Set(['host', 'origin', 'referer', 'connection',
    'accept-encoding', 'x-bridge-token', 'content-length']);
const HOP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding',
    'connection', 'keep-alive']);

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
        req.on('error', reject);
    });
}

function corsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
}

const server = http.createServer(async (req, res) => {
    corsHeaders(res);
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (url.pathname === '/health') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: true, token: TOKEN ? 'required' : 'open'}));
        return;
    }

    if (TOKEN && url.searchParams.get('token') !== TOKEN && req.headers['x-bridge-token'] !== TOKEN) {
        res.writeHead(401, {'Content-Type': 'text/plain'});
        res.end('bridge: bad or missing token');
        return;
    }
    url.searchParams.delete('token');

    let target = null;
    if (url.pathname.startsWith('/cors/')) {
        try {
            target = decodeURIComponent(url.pathname.slice('/cors/'.length));
        } catch { /* fallthrough */ }
    } else if (url.pathname.startsWith('/corsbase/')) {
        const rest = url.pathname.slice('/corsbase/'.length);
        const slash = rest.indexOf('/');
        const enc = slash === -1 ? rest : rest.slice(0, slash);
        const path = slash === -1 ? '/' : rest.slice(slash);
        try {
            target = decodeURIComponent(enc).replace(/\/+$/, '') + path;
        } catch { /* fallthrough */ }
    }
    if (!target || !/^https?:\/\//i.test(target)) {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end('MCP Access bridge — use /cors/<encoded-url> or /corsbase/<encoded-base>/<path>, or /health');
        return;
    }

    const q = url.searchParams.toString();
    const full = q ? target + (target.includes('?') ? '&' : '?') + q : target;

    const headers = {...req.headers};
    for (const h of HOP_REQUEST) delete headers[h];

    try {
        const body = (req.method === 'GET' || req.method === 'HEAD') ? undefined : await readBody(req);
        const up = await fetch(full, {method: req.method, headers, body, redirect: 'manual'});

        const outHeaders = {};
        up.headers.forEach((v, k) => {
            if (!HOP_RESPONSE.has(k.toLowerCase())) outHeaders[k] = v;
        });

        res.writeHead(up.status, outHeaders);
        if (up.body) {
            Readable.fromWeb(up.body).pipe(res);
        } else {
            res.end();
        }
    } catch (e) {
        if (!res.headersSent) {
            res.writeHead(502, {'Content-Type': 'text/plain'});
        }
        res.end('bridge fetch failed: ' + (e?.message ?? String(e)));
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`MCP Access bridge listening on http://127.0.0.1:${PORT}`);
    console.log(TOKEN ? 'Auth: token required (?token=…)' : 'Auth: open (localhost only)');
    console.log('Routes: /health · /cors/<encoded-url> · /corsbase/<encoded-base>/<path>');
});
