import {useRef, useState} from "react";
import {HubCore} from "../hub/core";
import {ServerRecord, TestResult, WorkflowProfile} from "../hub/types";
import {palette} from "./styles";
import {Btn, Field, StatusPill, Toggle} from "./primitives";

export function ServerCard({hub, rec}: { hub: HubCore; rec: ServerRecord }) {
    const rt = hub.runtimeOf(rec.id);
    const [expanded, setExpanded] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);

    const [editUrl, setEditUrl] = useState(rec.url);
    const [editKey, setEditKey] = useState(rec.apiKey ?? '');
    const [editAlias, setEditAlias] = useState(rec.alias);
    const [editCheckpoint, setEditCheckpoint] = useState(rec.checkpoint ?? '');
    const [uploadMsg, setUploadMsg] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const tools = rt.tools ?? [];
    const isComfy = rec.kind === 'comfy';

    const doTest = async () => {
        setTesting(true);
        setTestResult(null);
        const r = await hub.testServer({kind: rec.kind, url: editUrl, apiKey: editKey || undefined});
        setTestResult(r);
        setTesting(false);
    };

    const doSave = async () => {
        await hub.updateServer(rec.id, {
            url: editUrl.trim(),
            apiKey: editKey.trim() || undefined,
            alias: editAlias.trim() || rec.alias,
            checkpoint: editCheckpoint.trim() || undefined,
        });
        if (rec.enabled) void hub.refresh(rec.id);
    };

    const doWorkflowUpload = (file: File) => {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const json = JSON.parse(String(reader.result));
                const res = await hub.addCustomProfile(file.name.replace(/\.json$/i, ''), json);
                setUploadMsg(res.ok ? `✓ saved “${file.name}”` : `✗ ${res.error}`);
            } catch {
                setUploadMsg('✗ not a JSON file');
            }
        };
        reader.readAsText(file);
    };

    return <div className="mcp-card mcp-fade" style={{padding: '10px 12px', marginBottom: 8}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <span style={{width: 22, height: 22, display: 'grid', placeItems: 'center', fontSize: 13,
                borderRadius: 7, background: isComfy ? 'rgba(166,255,110,0.12)' : 'rgba(56,224,255,0.12)'}}>
                {isComfy ? '🖼' : '⇆'}
            </span>
            <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{rec.alias}</div>
                <div style={{fontSize: 10.5, color: palette.dim, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{rec.url}</div>
            </div>
            <StatusPill status={rec.enabled ? rt.status : 'offline'}/>
            <Toggle on={rec.enabled} onClick={() => void hub.setEnabled(rec.id, !rec.enabled)}/>
            <button className="mcp-iconbtn" title="details" onClick={() => setExpanded(v => !v)}>{expanded ? '▾' : '▸'}</button>
        </div>

        {tools.length > 0 && !expanded && (
            <div style={{display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7}}>
                {tools.slice(0, 4).map(t => <span key={t.name} className="mcp-chip" title={t.description}>{t.name}</span>)}
                {tools.length > 4 && <span className="mcp-chip" style={{opacity: 0.7}}>+{tools.length - 4}</span>}
            </div>
        )}
        {rt.error && <div style={{color: palette.bad, fontSize: 11, marginTop: 6}}>{rt.error}</div>}

        {expanded && <div style={{marginTop: 10, borderTop: `1px solid ${palette.border}`, paddingTop: 10}}>
            {tools.length > 0 && <>
                <div style={{fontSize: 10.5, color: palette.dim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em'}}>Exposed tools</div>
                <div style={{display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10}}>
                    {tools.map(t => <span key={t.name} className="mcp-chip" title={t.description}>{t.name}</span>)}
                </div>
            </>}

            <Field label="Alias">
                <input className="mcp-input" value={editAlias} onChange={e => setEditAlias(e.target.value)}/>
            </Field>
            <Field label={isComfy ? 'ComfyUI base URL' : 'Server URL (Streamable HTTP MCP endpoint)'}
                   hint={isComfy ? 'Any host:port works — local default http://127.0.0.1:8188' : undefined}>
                <input className="mcp-input" value={editUrl} onChange={e => setEditUrl(e.target.value)}
                       placeholder={isComfy ? 'http://127.0.0.1:8188' : 'https://server/mcp'}/>
            </Field>
            {!isComfy && <Field label="API key (optional — stored in your stage storage, never sent to the model)">
                <input className="mcp-input" type="password" value={editKey} onChange={e => setEditKey(e.target.value)} placeholder="••••••"/>
            </Field>}

            {isComfy && <>
                <Field label="Workflow profile">
                    <select className="mcp-input" value={rec.profileId ?? 'sdxl-general'}
                            onChange={e => void hub.updateServer(rec.id, {profileId: e.target.value})}>
                        {hub.getProfiles().map((p: WorkflowProfile) =>
                            <option key={p.id} value={p.id}>{p.name}{p.builtin ? '' : ' (custom)'}</option>)}
                    </select>
                </Field>
                <Field label="Checkpoint (optional override)" hint="blank = first checkpoint found on your ComfyUI">
                    <input className="mcp-input" value={editCheckpoint} onChange={e => setEditCheckpoint(e.target.value)}
                           placeholder="e.g. myModel.safetensors"/>
                </Field>
                <div style={{display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10}}>
                    <Btn variant="ghost" onClick={() => fileRef.current?.click()}>⬆ upload workflow .json</Btn>
                    <input ref={fileRef} type="file" accept="application/json,.json" style={{display: 'none'}}
                           onChange={e => { const f = e.target.files?.[0]; if (f) doWorkflowUpload(f); e.target.value = ''; }}/>
                    {uploadMsg && <span style={{fontSize: 11, color: uploadMsg.startsWith('✓') ? palette.good : palette.bad}}>{uploadMsg}</span>}
                </div>
                {hub.customProfiles.length > 0 && <div style={{marginBottom: 10}}>
                    {hub.customProfiles.map(p => (
                        <div key={p.id} style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: palette.dim, padding: '2px 0'}}>
                            <span style={{flex: 1}}>{p.name}</span>
                            <button className="mcp-iconbtn" title="delete profile" onClick={() => void hub.removeCustomProfile(p.id)}>🗑</button>
                        </div>
                    ))}
                </div>}
            </>}

            <div style={{display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap'}}>
                <Btn onClick={doSave}>Save</Btn>
                <Btn variant="ghost" onClick={doTest} disabled={testing}>{testing ? 'testing…' : 'Test connection'}</Btn>
                <Btn variant="ghost" onClick={() => void hub.refresh(rec.id)} title="Reconnect + re-list tools">↻ Reconnect</Btn>
                <Btn variant="danger" onClick={() => { if (window.confirm(`Remove ${rec.alias}?`)) void hub.removeServer(rec.id); }}>Remove</Btn>
            </div>
            {testResult && <div style={{marginTop: 8, fontSize: 11.5,
                color: testResult.ok ? palette.good : palette.bad}} className="mcp-fade">
                {testResult.ok
                    ? `✓ connected${testResult.device ? ` — ${testResult.device}` : ''}${testResult.tools != null ? ` — ${testResult.tools} tool(s)` : ''}`
                    : `✗ ${testResult.detail}`}
            </div>}
        </div>}
    </div>;
}
