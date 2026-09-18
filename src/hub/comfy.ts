/***
 ComfyUI connector: talks to a user's local/remote ComfyUI over its native
 HTTP API (no MCP wrapper needed). Handles workflow templates (built-in or
 user-uploaded), checkpoint autodetection, queue + poll, image fetch.
 ***/
import {ComfyRunResult, WorkflowProfile} from "./types";

/***
 Built-in workflow graphs. Placeholders: {prompt} {negative} {seed}
 {width} {height} {checkpoint}. All are written as quoted strings in the
 template and substituted wholesale.
 ***/
function sdxlGraph(width: number, height: number, steps: number, cfg: number, sampler = 'dpmpp_2m', scheduler = 'karras'): Record<string, any> {
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "{checkpoint}"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": "{width}", "height": "{height}", "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "{prompt}", "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "{negative}", "clip": ["4", 1]}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": "{seed}", "steps": "{steps}", "cfg": "{cfg}",
                "sampler_name": sampler, "scheduler": scheduler, "denoise": 1.0,
                "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]
            }
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "mcpaccess", "images": ["8", 0]}}
    };
}

function withFixed(graph: Record<string, any>, steps: number, cfg: number): Record<string, any> {
    const clone = JSON.parse(JSON.stringify(graph));
    return clone;
}

export const BUILTIN_PROFILES: WorkflowProfile[] = [
    {
        id: 'sdxl-general',
        name: 'SDXL · General (1024²)',
        builtin: true,
        workflow: sdxlGraph(1024, 1024, 25, 7),
    },
    {
        id: 'sdxl-fast',
        name: 'SDXL · Fast draft (8 steps)',
        builtin: true,
        workflow: sdxlGraph(1024, 1024, 8, 2.5),
    },
    {
        id: 'sdxl-portrait',
        name: 'SDXL · Portrait (832×1216)',
        builtin: true,
        workflow: sdxlGraph(832, 1216, 25, 7),
    },
];

/***
 Substitute placeholders into a workflow template. Strings are
 JSON-escaped; numbers are written raw. Returns the graph ready for
 POST /prompt.
 ***/
export function buildGraph(template: Record<string, any>, vars: Record<string, string | number>): Record<string, any> {
    let raw = JSON.stringify(template);
    for (const [key, value] of Object.entries(vars)) {
        const needle = `"${'{' + key + '}'}"`;
        const replacement = typeof value === 'string' ? JSON.stringify(value) : String(value);
        raw = raw.split(needle).join(replacement);
    }
    return JSON.parse(raw);
}

export function isValidWorkflow(obj: any): { ok: boolean; error?: string } {
    if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
        return {ok: false, error: 'workflow JSON must be an object keyed by node id'};
    }
    const keys = Object.keys(obj);
    if (keys.length === 0) return {ok: false, error: 'workflow is empty'};
    for (const k of keys) {
        const node = obj[k];
        if (node == null || typeof node !== 'object' || typeof node.class_type !== 'string') {
            return {ok: false, error: `node ${k} is missing class_type`};
        }
    }
    if (!JSON.stringify(obj).includes('{prompt}')) {
        return {ok: false, error: 'workflow must contain the {prompt} placeholder somewhere'};
    }
    return {ok: true};
}

function baseOf(url: string): string {
    return url.replace(/\/+$/, '');
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {...init, signal: controller.signal});
        if (!res.ok) throw new ComfyHttpError(res.status, `${res.status} ${res.statusText}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

export class ComfyHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export class ComfyClient {
    constructor(public baseUrl: string) {
    }

    async testConnection(): Promise<{ ok: boolean; device?: string; error?: string }> {
        try {
            const stats = await fetchJson(`${baseOf(this.baseUrl)}/system_stats`);
            const device = stats?.devices?.[0]?.name ?? stats?.system?.os ?? 'unknown device';
            return {ok: true, device: String(device)};
        } catch (e: any) {
            return {ok: false, error: classifyError(e)};
        }
    }

    async listCheckpoints(): Promise<string[]> {
        const info = await fetchJson(`${baseOf(this.baseUrl)}/object_info/CheckpointLoaderSimple`);
        const cmd = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]
            ?? info?.CheckpointLoaderSimple?.input?.optional?.ckpt_name?.[0];
        return Array.isArray(cmd) ? cmd.filter((x: any) => typeof x === 'string') : [];
    }

    /***
     Queue a graph and wait for an output image. Returns image bytes + meta.
     ***/
    async generate(profile: WorkflowProfile, opts: {
        prompt: string;
        negative?: string;
        seed?: number;
        checkpoint?: string;
        width?: number;
        height?: number;
        onProgress?: (text: string) => void;
    }, timeoutMs = 180_000): Promise<{ bytes: Blob; filename: string; seed: number }> {
        const seed = opts.seed ?? Math.floor(Math.random() * 4294967295);
        let checkpoint = opts.checkpoint;
        if (!checkpoint) {
            const ckpts = await this.listCheckpoints().catch(() => []);
            checkpoint = ckpts[0];
            if (!checkpoint) {
                throw new Error('No checkpoints found on this ComfyUI. Install a model first.');
            }
        }

        const graph = buildGraph(profile.workflow, {
            prompt: opts.prompt,
            negative: opts.negative ?? 'low quality, blurry, worst quality',
            seed,
            width: opts.width ?? 1024,
            height: opts.height ?? 1024,
            checkpoint,
        });

        opts.onProgress?.('queued');
        const queued = await fetchJson(`${baseOf(this.baseUrl)}/prompt`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({prompt: graph}),
        });
        const promptId = queued?.prompt_id;
        if (!promptId) {
            throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(queued).slice(0, 200)}`);
        }

        const deadline = Date.now() + timeoutMs;
        let ticks = 0;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 1500));
            ticks++;
            opts.onProgress?.(`generating… ${(ticks * 1.5).toFixed(0)}s`);
            let hist: any;
            try {
                hist = await fetchJson(`${baseOf(this.baseUrl)}/history/${promptId}`);
            } catch {
                continue;
            }
            const entry = hist?.[promptId];
            if (!entry) continue;
            const statusStrErr = entry?.status?.status_str;
            if (statusStrErr === 'error') {
                throw new Error('ComfyUI reported an execution error for this workflow.');
            }
            const outputs = entry?.outputs ?? {};
            for (const nodeOut of Object.values<any>(outputs)) {
                const images = nodeOut?.images;
                if (Array.isArray(images) && images.length > 0) {
                    const img = images[0];
                    const viewUrl = `${baseOf(this.baseUrl)}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`;
                    const resp = await fetch(viewUrl);
                    if (!resp.ok) throw new Error(`image fetch failed (${resp.status})`);
                    const blob = await resp.blob();
                    return {bytes: blob, filename: img.filename, seed};
                }
            }
        }
        throw new Error('timed out waiting for ComfyUI (180s). Is a heavy queue running?');
    }
}

export function classifyError(e: any): string {
    if (e instanceof ComfyHttpError) {
        if (e.status === 404) return 'http 404 — wrong base URL? (expected the ComfyUI root, e.g. http://127.0.0.1:8188)';
        if (e.status === 401 || e.status === 403) return `http ${e.status} — auth/CORS rejected by ComfyUI`;
        return `http ${e.status}`;
    }
    if (e?.name === 'AbortError') return 'timed out — is it running and reachable?';
    const msg = String(e?.message ?? e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        return 'blocked by browser/network — ComfyUI must run with `--enable-cors-header` (or be reached through the bridge)';
    }
    return msg;
}
