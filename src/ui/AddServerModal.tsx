import {useState} from "react";
import {HubCore} from "../hub/core";
import {ServerRecord, TestResult, uid} from "../hub/types";
import {palette} from "./styles";
import {Btn, Field, Toggle} from "./primitives";

type Preset = 'custom' | 'tavily' | 'comfy';

const PRESETS: { id: Preset; icon: string; title: string; blurb: string }[] = [
    {id: 'custom', icon: '⇆', title: 'Custom MCP server', blurb: 'Any Streamable-HTTP MCP server URL (remote or your own).'},
    {id: 'tavily', icon: '⌕', title: 'Tavily (web search)', blurb: 'Host tool for live web search — uses your own Tavily API key.'},
    {id: 'comfy', icon: '🖼', title: 'ComfyUI (images)', blurb: 'Your local/remote ComfyUI for in-chat image generation.'},
];

export function AddServerModal({hub, onClose}: { hub: HubCore; onClose: () => void }) {
    const [preset, setPreset] = useState<Preset | null>(null);
    const [alias, setAlias] = useState('');
    const [url, setUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [useBridge, setUseBridge] = useState(!!hub.bridgeBase);

    const pick = (p: Preset) => {
        setPreset(p);
        setTestResult(null);
        if (p === 'tavily') {
            setAlias('Tavily');
            setUrl('https://mcp.tavily.com/mcp/?tavilyApiKey=TAVILY_API_KEY');
        } else if (p === 'comfy') {
            setAlias('ComfyUI');
            setUrl('http://127.0.0.1:8188');
        } else {
            setAlias('');
            setUrl('');
        }
    };

    const kind = preset === 'comfy' ? 'comfy' as const : 'mcp' as const;

    const test = async () => {
        setTesting(true);
        setTestResult(null);
        const r = await hub.testServer({kind, url, apiKey: apiKey || undefined, useBridge});
        setTestResult(r);
        setTesting(false);
    };

    const add = async () => {
        const rec: ServerRecord = {
            id: uid(),
            kind,
            alias: alias.trim() || (preset === 'comfy' ? 'ComfyUI' : preset === 'tavily' ? 'Tavily' : 'Server'),
            enabled: true,
            url: url.trim(),
            apiKey: apiKey.trim() || undefined,
            useBridge,
        };
        onClose();
        await hub.addServer(rec);
    };

    return <div style={{
        position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center',
        background: 'rgba(4, 6, 10, 0.65)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
        <div className="mcp-card" style={{
            width: 'min(420px, 92%)', padding: 18, animation: 'mcp-modal-in .2s ease both',
            border: `1px solid ${palette.borderBright}`,
        }} onClick={e => e.stopPropagation()}>
            <div style={{fontSize: 15, fontWeight: 700, marginBottom: 12}}>
                Add server
            </div>

            {!preset && <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                {PRESETS.map(p => (
                    <div key={p.id} className="mcp-card" onClick={() => pick(p.id)}
                         style={{padding: '10px 12px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center'}}>
                        <span style={{fontSize: 18}}>{p.icon}</span>
                        <div>
                            <div style={{fontWeight: 700, fontSize: 12.5}}>{p.title}</div>
                            <div style={{fontSize: 11, color: palette.dim}}>{p.blurb}</div>
                        </div>
                    </div>
                ))}
                <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 4}}>
                    <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
                </div>
            </div>}

            {preset && <div className="mcp-fade">
                <div style={{fontSize: 11, color: palette.dim, marginBottom: 10, cursor: 'pointer'}}
                     onClick={() => setPreset(null)}>← presets · <b>{PRESETS.find(p => p.id === preset)?.title}</b></div>

                <Field label="Alias (tool prefix)">
                    <input className="mcp-input" value={alias} onChange={e => setAlias(e.target.value)} placeholder="Tavily"/>
                </Field>
                <Field label={preset === 'comfy' ? 'ComfyUI base URL' : 'Server URL'}
                       hint={preset === 'tavily' ? 'Keep the TAVILY_API_KEY placeholder in the URL' :
                           preset === 'comfy' ? 'If remote or non-default port — edit freely' : undefined}>
                    <input className="mcp-input" value={url} onChange={e => setUrl(e.target.value)}/>
                </Field>
                {(preset === 'tavily' || preset === 'custom') &&
                    <Field label={preset === 'tavily' ? 'Your Tavily API key' : 'API key (optional)'}
                           hint="Stored in your stage storage only. Never sent to the model.">
                        <input className="mcp-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}/>
                    </Field>}

                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12}}>
                    <Toggle on={useBridge} onClick={() => setUseBridge(v => !v)}/>
                    <div style={{fontSize: 11.5, color: palette.dim}}>
                        Route via local bridge
                        <span style={{display: 'block', fontSize: 10.5, opacity: .8}}>
                            Fixes browser CORS/PNA blocks — requires <code style={{color: palette.accent}}>npm run bridge</code> running{!hub.bridgeBase ? ' (set its URL in Diagnostics first)' : ''}
                        </span>
                    </div>
                </div>

                {testResult && <div className="mcp-fade" style={{
                    marginBottom: 10, fontSize: 12,
                    color: testResult.ok ? palette.good : palette.bad,
                }}>
                    {testResult.ok
                        ? `✓ connected${testResult.device ? ` — ${testResult.device}` : ''}${testResult.tools != null ? ` — ${testResult.tools} tool(s) found` : ''}`
                        : `✗ ${testResult.detail}`}
                </div>}

                <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                    <Btn variant="ghost" onClick={test} disabled={testing || !url}>{testing ? 'testing…' : 'Test'}</Btn>
                    <Btn onClick={add} disabled={!url}>Add server</Btn>
                </div>
            </div>}
        </div>
    </div>;
}
