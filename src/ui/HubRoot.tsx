import {useEffect, useState} from "react";
import {HubCore} from "../hub/core";
import {HubEvent} from "../hub/types";
import {injectCss, palette} from "./styles";
import {dot} from "./primitives";
import {ServerCard} from "./ServerCard";
import {AddServerModal} from "./AddServerModal";

const kindColor: Record<HubEvent['kind'], string> = {
    server: palette.accent,
    tool: palette.accent2,
    image: palette.good,
    error: palette.bad,
    info: palette.dim,
};

export function HubRoot({hub, environment}: { hub: HubCore; environment: string }) {
    injectCss();
    const [, setTick] = useState(0);
    const [showAdd, setShowAdd] = useState(false);
    const [showDiag, setShowDiag] = useState(false);
    const [probeNote, setProbeNote] = useState('');
    const [bridgeUrl, setBridgeUrl] = useState(hub.bridgeBase);
    const [bridgeMsg, setBridgeMsg] = useState('');

    useEffect(() => hub.subscribe(() => setTick(t => t + 1)), [hub]);

    const liveCount = hub.servers.filter(s => s.enabled && hub.runtimeOf(s.id).status === 'online').length;
    const feed = hub.events.slice(-4);

    return <div className="mcp-root" style={{
        height: '100vh', maxHeight: '100vh', overflowY: 'auto', padding: '14px 12px',
        background: 'linear-gradient(160deg, rgba(12,16,26,0.94), rgba(8,10,16,0.96))',
    }}>
        {/* header */}
        <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14}}>
            <div style={{
                width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center',
                background: 'linear-gradient(135deg, rgba(56,224,255,0.25), rgba(166,255,110,0.18))',
                border: `1px solid ${palette.borderBright}`, fontSize: 15,
            }}>⚡</div>
            <div style={{flex: 1}}>
                <div className="mcp-gradient-text" style={{fontWeight: 800, fontSize: 15, letterSpacing: '.02em'}}>MCP ACCESS</div>
                <div style={{fontSize: 10, color: palette.dim}}>any tool, any model, any chat</div>
            </div>
            <div title="servers online" style={{display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: liveCount > 0 ? palette.good : palette.dim}}>
                <span style={dot(liveCount > 0 ? palette.good : palette.off)}/> {liveCount} live
            </div>
        </div>

        {/* add server */}
        <button className="mcp-btn" style={{width: '100%', justifyContent: 'center', marginBottom: 12}}
                onClick={() => setShowAdd(true)}>
            + Add server
        </button>

        {/* servers */}
        {hub.servers.length === 0 && (
            <div style={{textAlign: 'center', color: palette.dim, fontSize: 11.5, padding: '22px 8px', border: `1px dashed ${palette.border}`, borderRadius: 12}}>
                No servers yet.<br/>Add Tavily for web search, ComfyUI for images,<br/>or any custom MCP server by URL.
            </div>
        )}
        {hub.servers.map(rec => <ServerCard key={rec.id} hub={hub} rec={rec}/>)}

        {/* live feed (hybrid: short always-visible tail) */}
        {feed.length > 0 && (
            <div style={{marginTop: 10}}>
                <div style={{fontSize: 10.5, color: palette.dim, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5}}>Live</div>
                <div className="mcp-card" style={{padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3}}>
                    {feed.map((e, i) => (
                        <div key={i} style={{display: 'flex', gap: 7, fontSize: 11, color: palette.dim, alignItems: 'baseline'}}>
                            <span style={{...dot(kindColor[e.kind]), position: 'relative', top: -1}}/>
                            <span style={{fontFamily: 'ui-monospace, monospace', opacity: 0.55, fontSize: 10}}>{e.at.slice(11, 19)}</span>
                            <span style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{e.text}</span>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* gallery */}
        {hub.gallery.length > 0 && (
            <div style={{marginTop: 12}}>
                <div style={{fontSize: 10.5, color: palette.dim, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5}}>Images</div>
                <div style={{display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4}}>
                    {hub.gallery.map((g, i) => (
                        <a key={i} href={g.url} target="_blank" rel="noreferrer" title={g.prompt}>
                            <img src={g.url} alt={g.prompt} style={{
                                height: 84, borderRadius: 8, border: `1px solid ${palette.border}`, display: 'block',
                            }}/>
                        </a>
                    ))}
                </div>
            </div>
        )}

        {/* diagnostics drawer */}
        <div style={{marginTop: 12}}>
            <button className="mcp-iconbtn" style={{width: '100%', textAlign: 'left', fontSize: 11, padding: '6px 8px'}}
                    onClick={() => setShowDiag(v => !v)}>
                {showDiag ? '▾' : '▸'} Diagnostics <span style={{color: palette.dim}}>({environment})</span>
            </button>
            {showDiag && <div className="mcp-card mcp-fade" style={{marginTop: 6, padding: '10px', maxHeight: 300, overflowY: 'auto'}}>
                <div style={{fontSize: 10.5, color: palette.dim, marginBottom: 6}}>Local bridge — run <code style={{color: palette.accent}}>npm run bridge</code> in the project folder, then set the base URL here to unlock CORS-blocked servers (Tavily MCP, ComfyUI without flags, Qdrant, Ollama…):</div>
                <div style={{display: 'flex', gap: 6, marginBottom: 4}}>
                    <input className="mcp-input" style={{flex: 1}} value={bridgeUrl}
                           onChange={e => setBridgeUrl(e.target.value)}
                           placeholder="http://127.0.0.1:7360"/>
                    <button className="mcp-btn mcp-btn-ghost" onClick={async () => {
                        const r = await hub.setBridgeBase(bridgeUrl);
                        setBridgeMsg(r.ok ? (hub.bridgeBase ? '✓ bridge connected' : '✓ bridge cleared') : `✗ ${r.detail}`);
                    }}>Save</button>
                </div>
                <div style={{fontSize: 11, marginBottom: 8, color: bridgeMsg.startsWith('✗') ? palette.bad : palette.good}}>
                    {bridgeMsg || (hub.bridgeBase ? `active: ${hub.bridgeBase}` : 'inactive')}
                </div>
                {hub.diagnosticBotContent && (
                    <div style={{fontSize: 10.5, color: palette.dim, marginBottom: 8, borderBottom: `1px solid ${palette.border}`, paddingBottom: 6}}>
                        tool-card probe: last bot message {hub.diagnosticBotContent.toolish
                            ? <b style={{color: palette.warn}}>contains tool markup → strippable</b>
                            : <b style={{color: palette.good}}>clean (cards are renderer-side)</b>}
                    </div>
                )}
                <div style={{display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap'}}>
                    <button className="mcp-btn mcp-btn-ghost" style={{fontSize: 11}}
                            onClick={async () => { setProbeNote(''); await hub.probeMarkdownImage(); setProbeNote('sent — check chat log for a rendered image'); }}>
                        Test: markdown image in chat
                    </button>
                    {probeNote && <span style={{fontSize: 11, color: palette.accent}}>{probeNote}</span>}
                </div>
                <div style={{fontSize: 10.5, color: palette.dim, marginBottom: 4}}>Host traffic into iframe:</div>
                {hub.traffic.length === 0 && <div style={{fontSize: 11, color: palette.dim}}>none observed</div>}
                {[...hub.traffic].reverse().map((t, i) => (
                    <div key={i} style={{fontSize: 10.5, color: palette.dim, fontFamily: 'ui-monospace, monospace'}}>
                        {t.at.slice(11, 19)} <b style={{color: palette.accent}}>{t.kind}</b> {t.detail}
                    </div>
                ))}
                <div style={{fontSize: 10.5, color: palette.dim, margin: '8px 0 4px'}}>Full event log:</div>
                {[...hub.events].reverse().map((e, i) => (
                    <div key={i} style={{fontSize: 10.5, display: 'flex', gap: 6, color: palette.dim}}>
                        <span style={dot(kindColor[e.kind])}/>
                        <span style={{fontFamily: 'ui-monospace, monospace'}}>{e.at.slice(11, 19)}</span>
                        <span style={{flex: 1}}>{e.text}</span>
                    </div>
                ))}
            </div>}
        </div>

        {showAdd && <AddServerModal hub={hub} onClose={() => setShowAdd(false)}/>}
    </div>;
}
