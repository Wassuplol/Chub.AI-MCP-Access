/***
 MCP Access hub — shared types.
 ***/

export type ServerKind = 'mcp' | 'comfy';

/***
 A user's registered upstream connection. Persisted per account
 (stage storage, user scope).
 ***/
export interface ServerRecord {
    /** Stable internal id, generated on creation. */
    id: string;
    /** What kind of connector serves this record. */
    kind: ServerKind;
    /** User-chosen display name; also the tool prefix after sanitizing. */
    alias: string;
    /** On/off without deleting. */
    enabled: boolean;
    /** MCP server URL (kind 'mcp') or ComfyUI base URL (kind 'comfy'). */
    url: string;
    /** Optional API key. For MCP sent as bearer; for Tavily remote folded into the URL. */
    apiKey?: string;
    /** ComfyUI: selected workflow profile id. */
    profileId?: string;
    /** ComfyUI: explicit checkpoint override; otherwise the first available is used. */
    checkpoint?: string;
    /** Route through the user's local bridge (npm run bridge) — fixes CORS/PNA. */
    useBridge?: boolean;
}

export type ProviderStatus = 'offline' | 'connecting' | 'online' | 'error';

export interface HubTool {
    /** Bare tool name from the upstream server (or synthetic for comfy). */
    name: string;
    /** Exposed to the host: `${aliasSlug}__${name}`. */
    fullName: string;
    description?: string;
    /** Upstream JSON schema for the input, if any. */
    inputSchema?: any;
}

export interface HubEvent {
    kind: 'server' | 'tool' | 'image' | 'error' | 'info';
    text: string;
    at: string;
}

export interface GalleryItem {
    url: string;
    prompt: string;
    at: string;
}

/***
 ComfyUI workflow profile: a JSON graph template with placeholders
 ({prompt} {negative} {seed} {width} {height} {checkpoint}).
 ***/
export interface WorkflowProfile {
    id: string;
    name: string;
    /** True for shipped defaults (not deletable). */
    builtin: boolean;
    /** The parsed workflow template. Inner values may contain {placeholders}. */
    workflow: Record<string, any>;
}

export interface ComfyRunResult {
    imageUrl: string;
    filename: string;
    seed: number;
}

export interface TestResult {
    ok: boolean;
    detail: string;
    tools?: number;
    device?: string;
}

export type { };

/** Sanitize an alias into a valid MCP tool-name prefix. */
export function aliasSlug(alias: string): string {
    const slug = alias.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return slug.length > 0 ? slug : 'srv';
}

export function uid(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
