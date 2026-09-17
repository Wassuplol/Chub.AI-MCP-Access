import {useEffect, useState} from "react";
import {DEFAULT_INITIAL, InitialData, StageBase} from "@chub-ai/stages-ts";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";

// Test chat data. Modify to fit whatever scenario you need.
import InitData from './assets/test-init.json';
import {Stage} from "./Stage";

export interface TestStageRunnerProps<StageType extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType>, InitStateType, ChatStateType, MessageStateType, ConfigType> {
    factory: (data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) => StageType;
}

type ListedTool = {
    name: string;
    description?: string;
};

/***
 Local test runner for development mode. In addition to running the stage,
 it plugs a real MCP Client into the stage's MCP server via an in-memory
 transport -- the same protocol path the Chub host uses over the iframe
 (host: IframeServerTransport + postMessage; here: InMemoryTransport).

 This lets you prove locally that (1) tools register correctly and
 (2) tool calls reach the stage and produce results.
 ***/
export const TestStageRunner = <StageType extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType>,
    InitStateType, ChatStateType, MessageStateType, ConfigType>({factory}: TestStageRunnerProps<StageType, InitStateType, ChatStateType, MessageStateType, ConfigType>) => {

    // @ts-ignore test data is intentionally loose
    const [stage] = useState(() => factory({...DEFAULT_INITIAL, ...InitData}));
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [tools, setTools] = useState<ListedTool[]>([]);
    const [mcpError, setMcpError] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<string>('');

    useEffect(() => {
        let cancelled = false;

        (async () => {
            const res = await stage.load();
            if (cancelled) return;
            if (!res.success || res.error != null) {
                setLoadError(res.error ?? 'load() reported failure');
                return;
            }
            setLoaded(true);

            try {
                const client = new Client({name: 'local-mcp-probe', version: '0.0.1'});
                const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
                // Stage side: pretend we are the Chub host.
                await (stage as any).mcp.connect(serverTransport);
                await client.connect(clientTransport);

                const list = await client.listTools();
                if (cancelled) return;
                setTools((list.tools ?? []) as ListedTool[]);
                (window as any).__mcpProbeClient = client;
            } catch (e: any) {
                if (!cancelled) setMcpError(String(e?.message ?? e));
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [stage]);

    const callTool = async (name: string, args: Record<string, any>) => {
        const client: Client | undefined = (window as any).__mcpProbeClient;
        if (!client) return;
        try {
            const result: any = await client.callTool({name, arguments: args});
            const text = (result?.content ?? [])
                .map((c: any) => (c?.type === 'text' ? c.text : JSON.stringify(c)))
                .join('\n');
            setLastResult(text || JSON.stringify(result));
        } catch (e: any) {
            setLastResult(`ERROR: ${String(e?.message ?? e)}`);
        }
    };

    return <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 13,
        background: '#0b0e14',
        color: '#d6e4ff',
    }}>
        <div style={{
            padding: '8px 10px',
            borderBottom: '1px solid rgba(120,160,255,0.25)',
            background: 'rgba(20,26,40,0.95)'
        }}>
            <b>MCP Spike — local probe</b>
            {loadError != null && <span style={{color: '#ff8080'}}> load error: {loadError}</span>}
            {mcpError != null && <span style={{color: '#ff8080'}}> mcp error: {mcpError}</span>}
            {loaded && !mcpError && <span> · connected · tools: {tools.map(t => t.name).join(', ') || '(none!)'}</span>}
            <div style={{marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                {tools.map(t => (
                    <button key={t.name} style={{cursor: 'pointer'}} onClick={() =>
                        callTool(t.name, t.name === 'stage_ping'
                            ? {message: 'local-probe'}
                            : t.name === 'stage_note'
                                ? {text: 'note from local probe'}
                                : {})
                    }>call {t.name}</button>
                ))}
            </div>
            {lastResult && <div style={{marginTop: 6, whiteSpace: 'pre-wrap', color: '#9fe8a9'}}>{lastResult}</div>}
        </div>
        <div style={{flex: 1, minHeight: 0}}>
            {loaded ? stage.render() : <div style={{padding: 10}}>Stage loading...</div>}
        </div>
    </div>;
}
