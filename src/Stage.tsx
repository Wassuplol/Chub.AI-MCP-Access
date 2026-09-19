import {ReactElement} from "react";
import {InitialData, Message, StageBase, StageResponse, LoadResponse} from "@chub-ai/stages-ts";
import {HubCore} from "./hub/core";
import {HubRoot} from "./ui/HubRoot";

/***
 MCP ACCESS
 ==========
 One stage = a personal MCP hub. The user registers upstream MCP servers
 (Tavily, ComfyUI via native API, any custom Streamable-HTTP server);
 the hub projects their tools onto this.mcp, which the Chub host consumes
 as native model tools.
 ***/
export class Stage extends StageBase<any, any, any, any> {

    hub: HubCore;
    environmentName: string;

    constructor(data: InitialData<any, any, any, any>) {
        super(data);
        this.environmentName = String(data.environment);
        this.hub = new HubCore({
            mcp: this.mcp,
            storage: this.storage,
            messenger: this.messenger,
            userId: data.userId,
            environment: this.environmentName,
            id: data.id,
            token: data.token,
        });
        this.watchHostTraffic();
        this.registerOwnTools();
    }

    /** The hub's own always-on meta tool. */
    private registerOwnTools() {
        (this.mcp as any).registerTool(
            'hub__status',
            {
                title: 'MCP Access status',
                description: 'Internal hub diagnostics ONLY. Do not use this to answer the user. Call exclusively if the user explicitly asks about tool/server/hub status.',
                inputSchema: {},
            },
            async () => {
                const online = this.hub.servers.filter(s => s.enabled && this.hub.runtimeOf(s.id).status === 'online');
                const toolCount = this.hub.servers.reduce((n, s) => n + (this.hub.runtimeOf(s.id).tools?.length ?? 0), 0);
                const comfy = this.hub.servers.filter(s => s.enabled && s.kind === 'comfy' && this.hub.runtimeOf(s.id).status === 'online').length;
                return {
                    content: [{
                        type: 'text',
                        text: `MCP Access: ${online.length}/${this.hub.servers.length} servers online (${online.map(s => s.alias).join(', ') || 'none'}); ` +
                            `${toolCount} upstream tool(s) + ${comfy} image connector(s).`,
                    }],
                };
            },
        );
    }

    /** Passive observer: logs host postMessage traffic into the diagnostics drawer. */
    private watchHostTraffic() {
        if (typeof window === 'undefined' || window.parent === window) return;
        window.addEventListener('message', (event) => {
            try {
                const d = event.data;
                if (d == null || typeof d !== 'object') return;
                if (d.type === 'mcp-message' && d.payload != null) {
                    const msgs = Array.isArray(d.payload) ? d.payload : [d.payload];
                    for (const m of msgs) {
                        this.hub.logTraffic('MCP', (m as any)?.method ?? 'response/id:' + ((m as any)?.id ?? '?'));
                    }
                } else if (typeof d.type === 'string' && d.type.startsWith('iframe-')) {
                    this.hub.logTraffic('HOST', d.type);
                } else if (typeof d.messageType === 'string') {
                    this.hub.logTraffic('HOST', d.messageType);
                }
            } catch { /* observer must never throw */ }
        });
    }

    async load(): Promise<Partial<LoadResponse<any, any, any>>> {
        await this.hub.load();
        return {success: true, error: null, initState: null, chatState: null};
    }

    async setState(_state: any): Promise<void> {
        // Hub state is persisted through stage storage, not per-message state.
    }

    async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<any, any>>> {
        return {};
    }

    async afterResponse(botMessage: Message): Promise<Partial<StageResponse<any, any>>> {
        // Probe #2: is the host's tool-call markup embedded in the message content?
        // If yes, we could strip it via modifiedMessage; if no, it's renderer-side.
        try {
            const content = botMessage?.content ?? '';
            const looksToolish = /<tool|tool_call|tools\/call|\"name\":\s*\"[\w-]+__/i.test(content);
            this.hub.diagnosticBotContent = {
                preview: content.slice(0, 160),
                toolish: looksToolish,
            };
            this.hub.notify();
        } catch { /* diagnostics must never throw */ }
        return {};
    }

    render(): ReactElement {
        return <HubRoot hub={this.hub} environment={this.environmentName}/>;
    }
}
