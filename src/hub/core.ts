/***
 HubCore: owns the upstream-server registry, spins per-server runtimes
 (MCP client / ComfyUI connector), projects upstream tools onto the
 stage's own MCP server (this.mcp) so the Chub host/model can call them,
 and persists the user's setup via stage storage (user scope).

 No React in here — the UI subscribes through the tiny emitter pattern.
 ***/
import {z} from "zod";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
    aliasSlug, GalleryItem, HubEvent, HubTool,
    ProviderStatus, ServerRecord, TestResult, uid, WorkflowProfile,
} from "./types";
import {jsonSchemaToZodShape} from "./jsonschema";
import {BUILTIN_PROFILES, ComfyClient, isValidWorkflow} from "./comfy";

const SK_SERVERS = 'hub_servers';
const SK_PROFILES = 'hub_profiles_custom';
const SK_GALLERY = 'hub_gallery';
const SK_BRIDGE = 'hub_bridge_base';

const EVENT_KEEP = 120;

interface StageServices {
    mcp?: any;
    storage?: any;
    messenger?: any;
    userId?: string;
    environment?: string;
}

interface Runtime {
    status: ProviderStatus;
    error?: string;
    tools: HubTool[];
    client?: Client;
    comfy?: ComfyClient;
}

export class HubCore {
    servers: ServerRecord[] = [];
    events: HubEvent[] = [];
    gallery: GalleryItem[] = [];
    customProfiles: WorkflowProfile[] = [];
    traffic: { kind: string, detail: string, at: string }[] = [];
    /** Probe #2 result: last bot message preview + whether it carried tool-call markup. */
    diagnosticBotContent?: { preview: string; toolish: boolean };
    /** Base URL of the user's local bridge (e.g. http://127.0.0.1:7360), '' if unset. */
    bridgeBase: string = '';

    private runtimes = new Map<string, Runtime>();
    private listeners = new Set<() => void>();
    private registeredByServer = new Map<string, string[]>();
    /** Full names we've registered on this.mcp; guards against double-registration. */
    private registeredNames = new Set<string>();

    constructor(private svc: StageServices) {
    }

    /* ---------------------------------------------------- events + notify */

    subscribe(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    notify() {
        this.listeners.forEach(cb => cb());
    }

    log(kind: HubEvent['kind'], text: string) {
        this.events = [...this.events.slice(-EVENT_KEEP + 1), {kind, text, at: new Date().toISOString()}];
        this.notify();
    }

    logTraffic(kind: string, detail: string) {
        this.traffic = [...this.traffic.slice(-79), {kind, detail, at: new Date().toISOString()}];
        this.notify();
    }

    /* ------------------------------------------------------- persistence */

    private async save(sk: string, value: any) {
        try {
            const res = await this.svc.storage?.set(sk, JSON.stringify(value)).forUser();
            const ok = Array.isArray(res?.data) && res.data.length > 0;
            if (!ok && res?.error) {
                this.log('error', `storage save "${sk}" FAILED: ${String(res.error).slice(0, 140)}`);
            } else {
                this.log('info', `storage save "${sk}" ok`);
            }
        } catch (e) {
            this.log('error', `storage save "${sk}" FAILED: ${String(e?.message ?? e).slice(0, 140)}`);
        }
    }

    /***
     Two fetch paths, because storage scopes are finicky:
     1) Direct query exactly as documented (user_ids null = unfiltered).
     2) Builder fetch scoped to this user's anonymized ID.
     ***/
    private async loadKey<T>(sk: string): Promise<T | null> {
        try {
            const res = await this.svc.storage?.query({
                keys: [sk], character_ids: null, user_ids: null,
                persona_ids: null, chat_local: false,
            });
            const raw = res?.data?.[0]?.value;
            if (typeof raw === 'string') return JSON.parse(raw) as T;
            if (res?.error) console.warn('hub storage query error:', res.error);
        } catch (e) {
            console.warn('hub storage query failed', sk, e);
        }
        try {
            const res = await this.svc.storage?.get([sk]).forUser(this.svc.userId ?? '');
            const raw = res?.data?.[0]?.value;
            if (typeof raw === 'string') return JSON.parse(raw) as T;
        } catch (e) {
            console.warn('hub storage builder fetch failed', sk, e);
        }
        return null;
    }

    /** Diagnostics: full storage round-trip check (write → read back). */
    async probeStorage(): Promise<void> {
        const marker = `hub-storage-test-${Date.now()}`;
        this.log('info', `storage test: writing marker ${marker}`);
        try {
            const res = await this.svc.storage?.set('hub_storage_test', JSON.stringify({marker})).forUser();
            if (!Array.isArray(res?.data) || res.data.length === 0) {
                this.log('error', `storage test: SAVE failed${res?.error ? ` (${String(res.error).slice(0, 120)})` : ' (empty response)'}`);
                return;
            }
            this.log('info', 'storage test: save ok, reading back…');
        } catch (e: any) {
            this.log('error', `storage test: SAVE threw: ${String(e?.message ?? e).slice(0, 140)}`);
            return;
        }
        const back = await this.loadKey<{ marker: string }>('hub_storage_test');
        if (back?.marker === marker) {
            this.log('info', 'storage test: ✓ roundtrip OK — persistence should work');
        } else {
            this.log('error', `storage test: ✗ read-back mismatch (got ${JSON.stringify(back)?.slice(0, 80) ?? 'null'}) — saves land but loads can't find them`);
        }
    }

    /* --------------------------------------------------------- lifecycle */

    async load() {
        this.servers = await this.loadKey<ServerRecord[]>(SK_SERVERS) ?? [];
        this.customProfiles = await this.loadKey<WorkflowProfile[]>(SK_PROFILES) ?? [];
        this.gallery = (await this.loadKey<GalleryItem[]>(SK_GALLERY)) ?? [];
        this.bridgeBase = (await this.loadKey<string>(SK_BRIDGE)) ?? '';
        for (const srv of this.servers) {
            this.runtimes.set(srv.id, {status: 'offline', tools: []});
        }
        this.log('info', `hub loaded: ${this.servers.length} server(s)${this.bridgeBase ? ' · bridge on' : ''}`);
        // Connect enabled servers BEFORE the host's tools/list handshake so
        // the model sees the full tool surface from the very first message.
        // Bounded per server so a dead host can't stall the chat forever;
        // stragglers keep connecting in the background.
        const connectAll = this.servers
            .filter(srv => srv.enabled)
            .map(srv => Promise.race([
                this.refresh(srv.id).catch(() => {}),
                new Promise(r => setTimeout(r, 15_000)),
            ]));
        await Promise.all(connectAll);
        const online = this.servers.filter(s => this.runtimeOf(s.id).status === 'online').length;
        this.log('info', `hub ready: ${online}/${this.servers.length} server(s) connected for handshake`);
    }

    /** Tell the host (if it listens) that the tool list changed mid-session. */
    private emitToolsChanged() {
        try {
            (this.svc.mcp as any)?.sendToolListChanged?.();
        } catch { /* ignore */ }
    }

    async setBridgeBase(url: string): Promise<{ ok: boolean; detail?: string }> {
        const base = url.trim().replace(/\/+$/, '');
        if (!base) {
            this.bridgeBase = '';
            await this.save(SK_BRIDGE, '');
            this.log('info', 'bridge cleared');
            this.notify();
            return {ok: true};
        }
        // Health-check through the exact path the browser will use.
        const check = await fetch(`${base}/health`).then(r => r.json()).catch(() => null);
        if (!check?.ok) {
            this.log('error', `bridge check failed - is "npm run bridge" running on ${base}?`);
            this.notify();
            return {ok: false, detail: 'no answer from /health - is the bridge running?'};
        }
        this.bridgeBase = base;
        await this.save(SK_BRIDGE, base);
        this.log('info', `bridge connected: ${base}`);
        this.notify();
        return {ok: true};
    }

    /** Effective MCP endpoint URL for a record (API key + optional bridge wrap). */
    private resolveMcpUrl(rec: ServerRecord): string {
        let url = withUrlKey(rec.url, rec);
        if (rec.useBridge && this.bridgeBase) {
            url = `${this.bridgeBase}/cors/${encodeURIComponent(url)}`;
        }
        return url;
    }

    /** Effective ComfyUI base for a record (optional bridge wrap). */
    private resolveComfyBase(rec: ServerRecord): string {
        const base = rec.url.replace(/\/+$/, '');
        if (rec.useBridge && this.bridgeBase) {
            return `${this.bridgeBase}/corsbase/${encodeURIComponent(base)}`;
        }
        return base;
    }

    /* ---------------------------------------------------------- registry */

    async addServer(rec: ServerRecord) {
        this.servers = [...this.servers, rec];
        this.runtimes.set(rec.id, {status: 'offline', tools: []});
        this.log('server', `added "${rec.alias}" (${rec.kind})`);
        this.log('info', 'note: the model sees new tools after a page refresh (the chat reads the tool list once, at load)');
        await this.save(SK_SERVERS, this.servers);
        if (rec.enabled) void this.refresh(rec.id);
    }

    async updateServer(id: string, patch: Partial<ServerRecord>) {
        this.servers = this.servers.map(s => s.id === id ? {...s, ...patch} : s);
        this.notify();
        await this.save(SK_SERVERS, this.servers);
    }

    async removeServer(id: string) {
        this.unregisterServer(id);
        const rt = this.runtimes.get(id);
        try {
            await rt?.client?.close();
        } catch { /* ignore */ }
        this.runtimes.delete(id);
        const name = this.servers.find(s => s.id === id)?.alias;
        this.servers = this.servers.filter(s => s.id !== id);
        this.log('server', `removed "${name ?? id}"`);
        await this.save(SK_SERVERS, this.servers);
        this.emitToolsChanged();
        this.notify();
    }

    async setEnabled(id: string, on: boolean) {
        await this.updateServer(id, {enabled: on});
        if (on) {
            void this.refresh(id);
        } else {
            this.unregisterServer(id);
            const rt = this.runtimes.get(id);
            try {
                await rt?.client?.close();
            } catch { /* ignore */ }
            this.runtimes.set(id, {status: 'offline', tools: []});
            this.log('server', `disabled ${this.aliasOf(id)}`);
            this.emitToolsChanged();
            this.notify();
        }
    }

    aliasOf(id: string): string {
        return this.servers.find(s => s.id === id)?.alias ?? id;
    }

    runtimeOf(id: string): Runtime {
        let rt = this.runtimes.get(id);
        if (!rt) {
            rt = {status: 'offline', tools: []};
            this.runtimes.set(id, rt);
        }
        return rt;
    }

    /* ------------------------------------------------ connection / tools */

    private setStatus(id: string, status: ProviderStatus, error?: string) {
        const rt = this.runtimeOf(id);
        rt.status = status;
        rt.error = error;
        this.notify();
    }

    /** (Re)connect a server, list its tools, register them on this.mcp. */
    async refresh(id: string) {
        const rec = this.servers.find(s => s.id === id);
        if (!rec) return;
        this.unregisterServer(id);
        this.setStatus(id, 'connecting');
        try {
            if (rec.kind === 'comfy') {
                const comfy = new ComfyClient(this.resolveComfyBase(rec));
                const t = await comfy.testConnection();
                if (!t.ok) throw new Error(t.error);
                this.runtimes.set(id, {status: 'online', tools: [], comfy});
                this.registerComfyTools(rec);
                this.log('server', `"${rec.alias}" online (${t.device})`);
            } else {
                const client = await this.connectMcp(rec);
                const list = await (client as any).listTools();
                const tools: HubTool[] = (list?.tools ?? []).map((t: any) => ({
                    name: t.name,
                    fullName: `${aliasSlug(rec.alias)}__${t.name}`,
                    description: t.description,
                    inputSchema: t.inputSchema,
                }));
                this.runtimes.set(id, {status: 'online', tools, client});
                this.registerMcpTools(rec, tools, client);
                this.log('server', `"${rec.alias}" online - ${tools.length} tool(s): ${tools.map(t => t.name).join(', ').slice(0, 120)}`);
            }
            this.setStatus(id, 'online');
            this.emitToolsChanged();
        } catch (e: any) {
            const msg = classifyConnectError(e);
            this.setStatus(id, 'error', msg);
            this.log('error', `"${rec.alias}" failed: ${msg}`);
        }
    }

    private async connectMcp(rec: ServerRecord): Promise<Client> {
        const url = this.resolveMcpUrl(rec);
        const headers: Record<string, string> = {};
        if (rec.apiKey && !withUrlKeyUsed(rec)) headers['Authorization'] = `Bearer ${rec.apiKey}`;
        const transport = new StreamableHTTPClientTransport(new URL(url), {
            requestInit: {headers},
        });
        const client = new Client({name: 'mcp-access-hub', version: '0.1.0'});
        await (client as any).connect(transport);
        return client;
    }

    /** Dry-run connection test without mutating the registry. */
    async testServer(draft: Partial<ServerRecord>): Promise<TestResult> {
        try {
            if (draft.kind === 'comfy') {
                const base = draft.url ?? '';
                const useBridge = draft.useBridge && this.bridgeBase;
                const t = await new ComfyClient(useBridge
                    ? `${this.bridgeBase}/corsbase/${encodeURIComponent(base.replace(/\/+$/, ''))}`
                    : base).testConnection();
                return t.ok ? {ok: true, detail: 'ok', device: t.device} : {ok: false, detail: t.error ?? 'unknown'};
            }
            const rec = {
                id: 'test', kind: 'mcp', alias: 'test', enabled: false,
                url: draft.url ?? '', apiKey: draft.apiKey, useBridge: draft.useBridge,
            } as ServerRecord;
            const client = await this.connectMcp(rec);
            try {
                const list = await (client as any).listTools();
                return {ok: true, detail: 'ok', tools: (list?.tools ?? []).length};
            } finally {
                try { await (client as any).close(); } catch { /* ignore */ }
            }
        } catch (e: any) {
            return {ok: false, detail: classifyConnectError(e)};
        }
    }

    /** Register MCP tools of an upstream server onto the stage's MCP server. */
    private registerMcpTools(rec: ServerRecord, tools: HubTool[], client: Client) {
        const names: string[] = [];
        for (const tool of tools) {
            if (this.registeredNames.has(tool.fullName)) {
                // Already registered earlier this session; its handler resolves the
                // runtime at call time, so it keeps working after reconnects.
                names.push(tool.fullName);
                continue;
            }
            const shape = jsonSchemaToZodShape(tool.inputSchema);
            const wrappedShape: Record<string, any> = shape ?? {
                args: z.record(z.any()).describe(
                    'Arguments for this tool as a JSON object. Original schema (truncated): ' +
                    JSON.stringify(tool.inputSchema ?? {}).slice(0, 700)),
            };
            try {
                (this.svc.mcp as any)?.registerTool(
                    tool.fullName,
                    {
                        title: tool.name,
                        description: `[${rec.alias}] ${tool.description ?? tool.name}`,
                        inputSchema: wrappedShape,
                    },
                    async (args: any) => this.callUpstream(rec.id, tool.name, shape == null ? (args?.args ?? args) : args),
                );
                this.registeredNames.add(tool.fullName);
                names.push(tool.fullName);
            } catch (e: any) {
                this.log('error', `could not register ${tool.fullName}: ${String(e?.message ?? e).slice(0, 120)}`);
            }
        }
        this.registeredByServer.set(rec.id, names);
    }

    /** Synthetic tools for a ComfyUI connector. */
    private registerComfyTools(rec: ServerRecord) {
        const prefix = aliasSlug(rec.alias);
        const gen = `${prefix}__generate_image`;
        if (!this.registeredNames.has(gen)) {
            try {
                (this.svc.mcp as any)?.registerTool(
                    gen,
                    {
                        title: 'Generate image (ComfyUI)',
                        description: `[${rec.alias}] Generate an image with the user's local ComfyUI and return it as a markdown image for the chat. Use to visually render scenes, characters, outfits, items, or locations when the user asks for a picture (or offers clear visual intent).`,
                        inputSchema: {
                            prompt: z.string().describe('Detailed image description (tags or natural language both fine)'),
                            negative: z.string().optional().describe('What to avoid'),
                            aspect: z.enum(['1:1', '3:2', '2:3']).optional().describe('Image aspect ratio'),
                            seed: z.number().optional().describe('Fixed seed for reproducibility'),
                        },
                        annotations: {readOnlyHint: false, openWorldHint: true, destructiveHint: false},
                    },
                    async (args: any) => this.callComfy(rec.id, args),
                );
                this.registeredNames.add(gen);
            } catch (e: any) {
                this.log('error', `could not register ${gen}: ${String(e?.message ?? e).slice(0, 120)}`);
            }
        }
        this.registeredByServer.set(rec.id, [gen]);
    }

    private unregisterServer(id: string) {
        const names = this.registeredByServer.get(id) ?? [];
        const mcp: any = this.svc.mcp;
        for (const name of names) {
            try {
                if (mcp && typeof mcp.unregisterTool === 'function') mcp.unregisterTool(name);
                else if (mcp && typeof mcp.removeTool === 'function') mcp.removeTool(name);
                // SDK has no public unregister: reach into the internal registry.
                const internal = mcp?._registeredTools;
                if (internal instanceof Map) internal.delete(name);
                const gone = !(mcp?._registeredTools instanceof Map && mcp._registeredTools.has(name));
                if (gone) this.registeredNames.delete(name);
                // If it couldn't be removed, keep it in registeredNames - the
                // guard in the register path will skip re-registering it.
            } catch { /* ignore */ }
        }
        this.registeredByServer.delete(id);
    }

    /* ----------------------------------------------------------- calling */

    private async callUpstream(serverId: string, toolName: string, args: any): Promise<any> {
        const rec = this.servers.find(s => s.id === serverId);
        if (!rec?.enabled) return {isError: true, content: [{type: 'text', text: `server "${rec?.alias ?? '?'}" is disabled.`}]};
        const rt = this.runtimes.get(serverId);
        if (rt?.status !== 'online' || !rt.client) {
            return {isError: true, content: [{type: 'text', text: `server "${rec.alias}" is offline (${rt?.error ?? 'not connected'}).`}]};
        }
        try {
            const result = await (rt.client as any).callTool({name: toolName, arguments: args ?? {}}, undefined, {timeout: 120_000});
            const processed = await this.materializeImages(result?.content, serverId);
            this.log('tool', `${rec.alias}.${toolName} <- ok`);
            return {...result, content: processed};
        } catch (e: any) {
            this.log('error', `${rec.alias}.${toolName} failed: ${String(e?.message ?? e).slice(0, 160)}`);
            return {isError: true, content: [{type: 'text', text: `tool error: ${String(e?.message ?? e).slice(0, 200)}`}]};
        }
    }

    private async callComfy(serverId: string, args: any): Promise<any> {
        const rec = this.servers.find(s => s.id === serverId);
        if (!rec?.enabled) return {isError: true, content: [{type: 'text', text: `comfy server disabled.`}]};
        const rt = this.runtimes.get(serverId);
        if (rt?.status !== 'online' || !rt.comfy) {
            return {isError: true, content: [{type: 'text', text: `ComfyUI (${rec?.alias}) is offline: ${rt?.error ?? 'not connected'}. Enable "route via bridge" in the hub panel if the browser blocks it.`}]};
        }
        const profile = this.getProfiles().find(p => p.id === rec.profileId) ?? BUILTIN_PROFILES[0];
        const {w, h} = aspectToDims(args?.aspect);
        this.log('tool', `${rec.alias} generating: "${String(args?.prompt ?? '').slice(0, 80)}" (profile ${profile.name})`);
        try {
            const res: { bytes: Blob; filename: string; seed: number } = await rt.comfy.generate(profile, {
                prompt: String(args?.prompt ?? ''),
                negative: args?.negative,
                seed: typeof args?.seed === 'number' ? args.seed : undefined,
                checkpoint: rec.checkpoint,
                width: w, height: h,
                onProgress: (txt) => this.log('tool', `${rec.alias}: ${txt}`),
            });
            const url = await this.uploadFile(`comfy_${res.seed}.png`, res.bytes);
            const item: GalleryItem = {url, prompt: String(args?.prompt ?? ''), at: new Date().toISOString()};
            this.gallery = [item, ...this.gallery].slice(0, 60);
            void this.save(SK_GALLERY, this.gallery);
            this.log('image', `${rec.alias} -> image ready (${res.filename}, seed ${res.seed})`);
            return {
                content: [
                    {type: 'text', text: `![${String(args?.prompt ?? 'generated image').slice(0, 220)}](${url})`},
                    {type: 'text', text: `(generated with ComfyUI - profile "${profile.name}" - seed ${res.seed})`},
                ],
            };
        } catch (e: any) {
            const msg = classifyConnectError(e);
            this.log('error', `${rec.alias} generation failed: ${msg}`);
            return {isError: true, content: [{type: 'text', text: `image generation failed: ${msg}`}]};
        }
    }

    /** Upload binary content to stage storage; returns the CDN URL. */
    private async uploadFile(filename: string, bytes: Blob): Promise<string> {
        const file = new File([bytes], filename, {type: bytes.type || 'image/png'});
        const res = await this.svc.storage?.set(filename, file).forUser();
        const url = res?.data?.[0]?.value;
        if (!url) throw new Error('storage upload returned no URL');
        return String(url);
    }

    /***
     MCP tools may return image content items (base64). Convert those to
     CDN URLs so they can be shown in chat; pass everything else through.
     ***/
    private async materializeImages(content: any[], serverId: string): Promise<any[]> {
        if (!Array.isArray(content)) return content;
        const out: any[] = [];
        for (const item of content) {
            if (item?.type === 'image' && typeof item?.data === 'string') {
                try {
                    const blob = b64ToBlob(item.data, item.mimeType ?? 'image/png');
                    const ext = (item.mimeType ?? 'image/png').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
                    const url = await this.uploadFile(`mcp_${uid()}.${ext}`, blob);
                    this.gallery = [{url, prompt: `${this.aliasOf(serverId)} image`, at: new Date().toISOString()}, ...this.gallery].slice(0, 60);
                    void this.save(SK_GALLERY, this.gallery);
                    out.push({type: 'text', text: `![image](${url})`});
                    this.log('image', `${this.aliasOf(serverId)} returned an image -> CDN`);
                } catch {
                    out.push(item);
                }
            } else {
                out.push(item);
            }
        }
        return out;
    }

    /* ---------------------------------------------------------- profiles */

    getProfiles(): WorkflowProfile[] {
        return [...BUILTIN_PROFILES, ...this.customProfiles];
    }

    async addCustomProfile(name: string, json: Record<string, any>): Promise<{ ok: boolean; error?: string }> {
        const check = isValidWorkflow(json);
        if (!check.ok) return {ok: false, error: check.error};
        const profile: WorkflowProfile = {id: 'custom-' + uid(), name: name || 'Custom workflow', builtin: false, workflow: json};
        this.customProfiles = [...this.customProfiles.filter(p => p.name !== profile.name), profile];
        await this.save(SK_PROFILES, this.customProfiles);
        this.log('info', `workflow profile saved: ${profile.name}`);
        this.notify();
        return {ok: true};
    }

    async removeCustomProfile(id: string) {
        this.customProfiles = this.customProfiles.filter(p => p.id !== id);
        await this.save(SK_PROFILES, this.customProfiles);
        this.notify();
    }

    /* ------------------------------------------------------------ probes */

    /** Diagnostics button: probe whether markdown images render in chat. */
    async probeMarkdownImage(): Promise<void> {
        try {
            await this.svc.messenger?.impersonate({
                speaker_id: this.svc.userId,
                message: `![mcp-access-probe](https://picsum.photos/seed/${Date.now()}/640/360)`,
            });
            this.log('info', 'markdown-image probe sent to chat - look for a rendered image in the log');
        } catch (e: any) {
            this.log('error', `probe failed: ${String(e?.message ?? e)}`);
        }
    }
}

/* ----------------------------------------------------------------- misc */

function classifyConnectError(e: any): string {
    const msg = String(e?.message ?? e);
    if (e?.name === 'AbortError') return 'timed out';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        return 'blocked by browser/network (CORS or PNA). Start the local bridge (`npm run bridge`) and enable "route via bridge" for this server.';
    }
    return msg.slice(0, 220);
}

function withUrlKey(url: string, rec: ServerRecord): string {
    if (!rec.apiKey) return url;
    // Tavily remote carries the key as query param; detected via placeholder.
    if (url.includes('TAVILY_API_KEY')) return url.split('TAVILY_API_KEY').join(rec.apiKey);
    return url;
}

function withUrlKeyUsed(rec: ServerRecord): boolean {
    return !!rec.apiKey && rec.url.includes('TAVILY_API_KEY');
}

function aspectToDims(aspect?: string): { w?: number; h?: number } {
    switch (aspect) {
        case '3:2': return {w: 1152, h: 864};
        case '2:3': return {w: 864, h: 1152};
        default: return {};
    }
}

function b64ToBlob(b64: string, mime: string): Blob {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], {type: mime});
}
