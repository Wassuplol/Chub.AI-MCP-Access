import {CSSProperties, ReactElement, useEffect, useState} from "react";
import {Character, InitialData, Message, StageBase, StageResponse, LoadResponse, User} from "@chub-ai/stages-ts";
import {z} from "zod";

/***
 MCP SPIKE STAGE
 ===============
 Purpose: verify the native MCP path. Every stage instance gets an
 `McpServer` at `this.mcp`. In production/staging, ReactRunner connects it
 to the Chub host via IframeServerTransport right after load().
 Anything registered here SHOULD become visible to the host (and model).

 This stage registers four test tools and logs every invocation so we can
 prove from the stage's own UI that a tool call actually happened.
 ***/

export type ToolCallRecord = {
    tool: string;
    args: Record<string, any>;
    resultPreview: string;
    at: string;
};

export type TrafficRecord = {
    kind: string;
    detail: string;
    at: string;
};

type MessageStateType = { calls: ToolCallRecord[] };
type ChatStateType = { totalCalls: number };
type ConfigType = { echoPrefix?: string };

export class Stage extends StageBase<any, ChatStateType, MessageStateType, ConfigType> {

    calls: ToolCallRecord[];
    notes: string[] = [];
    traffic: TrafficRecord[] = [];
    environment: string = 'unknown';
    configPrefix: string;
    private rosterCharacters: { [key: string]: Character } = {};
    private rosterUsers: { [key: string]: User } = {};
    private readonly listeners = new Set<() => void>();
    private tick = 0;

    constructor(data: InitialData<any, ChatStateType, MessageStateType, ConfigType>) {
        super(data);
        const {characters, users, config, messageState, environment} = data;

        this.rosterCharacters = characters ?? {};
        this.rosterUsers = users ?? {};
        this.calls = messageState?.calls ?? [];
        this.configPrefix = (config as ConfigType | null)?.echoPrefix ?? 'stage says';
        this.environment = String(environment);

        this.watchHostTraffic();
        this.registerTools();

        // Exposed on the instance: also callable via the host's CALL
        // postMessage path (`StageFunctionCall` type).
        (this as any).mcpSpikeStats = () => ({
            calls: this.calls.length,
            notes: this.notes.length,
            characters: Object.keys(characters).length,
            users: Object.keys(users).length,
            environment,
        });
    }

    /***
     Passive observer: logs every message the host page posts into this iframe.
     Completely read-only -- proves whether the host ever attempts an MCP
     handshake (initialize / tools/list), independent of the model's behavior.
     ***/
    private watchHostTraffic() {
        if (typeof window === 'undefined' || window.parent === window) return;
        window.addEventListener('message', (event) => {
            try {
                const d = event.data;
                if (d == null || typeof d !== 'object') return;
                if (d.type === 'mcp-message' && d.payload != null) {
                    const msgs = Array.isArray(d.payload) ? d.payload : [d.payload];
                    for (const m of msgs) {
                        this.logTraffic('MCP', (m as any)?.method ?? 'response/id:' + ((m as any)?.id ?? '?'));
                    }
                } else if (typeof d.type === 'string' && d.type.startsWith('iframe-')) {
                    this.logTraffic('HOST', d.type);
                } else if (typeof d.messageType === 'string') {
                    this.logTraffic('HOST', d.messageType);
                }
            } catch { /* observer must never throw */ }
        });
    }

    private logTraffic(kind: string, detail: string) {
        this.traffic = [...this.traffic.slice(-49), {kind, detail, at: new Date().toISOString()}];
        this.notify();
    }

    private record(tool: string, args: Record<string, any>, result: string) {
        this.calls = [...this.calls, {tool, args, resultPreview: result.slice(0, 300), at: new Date().toISOString()}];
        this.notify();
    }

    private registerTools() {
        const text = (message: string) => ({content: [{type: 'text' as const, text: message}]});
        // registerTool's generics explode (TS2589) when called on the typed
        // McpServer field with this zod/sdk combo; cast once, keep handlers sane.
        const register = (name: string, config: Record<string, any>, handler: (args: any) => any) =>
            (this.mcp as any).registerTool(name, config, handler);

        register(
            'stage_ping',
            {
                title: 'Stage Ping',
                description: 'Ping the stage currently running inside this chat. Useful to verify the stage and its tools are alive. Cheap to call; call it whenever unsure whether stage tools work.',
                inputSchema: {message: z.string().optional().describe('Optional word to echo back')},
                annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
            },
            async ({message}) => {
                const result = `${this.configPrefix}: pong${message ? ` (${message})` : ''}`;
                this.record('stage_ping', {message: message ?? null}, result);
                return text(result);
            },
        );

        register(
            'current_time',
            {
                title: 'Current Time',
                description: 'Get the current date and time (ISO 8601) from the stage environment.',
                inputSchema: {},
                annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
            },
            async () => {
                const result = new Date().toISOString();
                this.record('current_time', {}, result);
                return text(result);
            },
        );

        register(
            'chat_roster',
            {
                title: 'Chat Roster',
                description: 'List the characters and users present in this chat as the stage sees them.',
                inputSchema: {},
                annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
            },
            async () => {
                const chars = this.rosterCharacters;
                const users = this.rosterUsers;
                const names = [
                    ...Object.values(users).map(u => `${u.name || 'unnamed user'} (user)`),
                    ...Object.values(chars).map(c => `${c.name || 'unnamed character'} (character${c.isRemoved ? ', removed' : ''})`),
                ];
                const result = names.length > 0 ? names.join('\n') : 'nobody here';
                this.record('chat_roster', {}, result);
                return text(result);
            },
        );

        register(
            'stage_note',
            {
                title: 'Stage Note',
                description: 'Leave a short note on the stage panel. Visible to the human in the stage UI until the page reloads.',
                inputSchema: {text: z.string().max(280).describe('The note text')},
                annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
            },
            async ({text: noteText}) => {
                this.notes = [...this.notes, noteText];
                const result = `note recorded (${this.notes.length} total)`;
                this.record('stage_note', {text: noteText}, result);
                return text(result);
            },
        );
    }

    addListener(cb: () => void) {
        this.listeners.add(cb);
    }

    removeListener(cb: () => void) {
        this.listeners.delete(cb);
    }

    private notify() {
        this.tick += 1;
        this.listeners.forEach(cb => cb());
    }

    async load(): Promise<Partial<LoadResponse<any, ChatStateType, MessageStateType>>> {
        return {
            success: true,
            error: null,
            initState: null,
            chatState: {totalCalls: this.calls.length},
        };
    }

    async setState(state: MessageStateType): Promise<void> {
        if (state != null) {
            this.calls = state.calls ?? [];
            this.notify();
        }
    }

    async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
        return {
            messageState: {calls: this.calls},
            chatState: {totalCalls: this.calls.length},
        };
    }

    async afterResponse(_botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
        return {
            messageState: {calls: this.calls},
            chatState: {totalCalls: this.calls.length},
        };
    }

    render(): ReactElement {
        return <SpikePanel stage={this}/>;
    }
}

function SpikePanel({stage}: { stage: Stage }) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const cb = () => setTick(t => t + 1);
        stage.addListener(cb);
        return () => stage.removeListener(cb);
    }, [stage]);

    const mono: CSSProperties = {fontFamily: 'ui-monospace, Consolas, monospace'};

    return <div style={{
        ...mono,
        height: '100%',
        maxHeight: '100vh',
        overflowY: 'auto',
        background: 'rgba(12, 14, 20, 0.92)',
        color: '#d6e4ff',
        padding: '10px',
        fontSize: '12px',
        boxSizing: 'border-box',
    }}>
        <div style={{fontSize: '14px', fontWeight: 700, marginBottom: 6}}>MCP Spike</div>
        <div style={{opacity: 0.8, marginBottom: 10}}>
            4 tools registered on this.mcp. If the host consumes the stage MCP server, the model can call these.
            Every invocation is logged below.
        </div>
        <div style={{marginBottom: 8}}>
            <b>Environment:</b> {stage.environment}
        </div>
        <div style={{marginBottom: 8}}>
            <b>Registered:</b> stage_ping · current_time · chat_roster · stage_note
        </div>
        <div style={{marginBottom: 8}}>
            <b>Calls observed by stage:</b> {stage.calls.length}
        </div>
        <div style={{marginBottom: 8}}>
            <b>Host traffic into iframe</b> <span style={{opacity: 0.6}}>(INIT/BEFORE/AFTER = chat lifecycle · MCP initialize/tools-* = MCP session)</span>:
            {stage.traffic.length === 0 && <div style={{opacity: 0.6}}>none observed</div>}
            {stage.traffic.length > 0 && <div style={{
                maxHeight: 140, overflowY: 'auto', marginTop: 4,
                border: '1px solid rgba(120,160,255,0.18)', borderRadius: 6, padding: '4px 6px'
            }}>
                {[...stage.traffic].reverse().map((t, i) => (
                    <div key={i} style={{opacity: 0.75}}>
                        {t.at.slice(11, 19)} <b>{t.kind}</b> {t.detail}
                    </div>
                ))}
            </div>}
        </div>
        {stage.notes.length > 0 && <div style={{marginBottom: 8}}>
            <b>Notes from the model:</b>
            <ul style={{margin: '4px 0', paddingLeft: 16}}>
                {stage.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
        </div>}
        {stage.calls.length > 0 && <div>
            <b>Call log:</b>
            {stage.calls.map((c, i) => (
                <div key={i} style={{
                    border: '1px solid rgba(120, 160, 255, 0.25)',
                    borderRadius: 6,
                    padding: '4px 6px',
                    marginTop: 6
                }}>
                    <div><b>{c.tool}</b> <span style={{opacity: 0.6}}>{c.at}</span></div>
                    <div style={{opacity: 0.85}}>args: {JSON.stringify(c.args)}</div>
                    <div style={{opacity: 0.85}}>result: {c.resultPreview}</div>
                </div>
            ))}
        </div>}
    </div>;
}
