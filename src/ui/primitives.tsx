import {ReactNode} from "react";
import {palette} from "./styles";

export function StatusPill({status}: { status: 'offline' | 'connecting' | 'online' | 'error' }) {
    const map = {
        online: {c: palette.good, label: 'live'},
        connecting: {c: palette.warn, label: 'connecting', pulse: true},
        error: {c: palette.bad, label: 'error'},
        offline: {c: palette.off, label: 'off'},
    } as const;
    const s = map[status];
    return <span className="mcp-pill" style={{
        color: s.c, borderColor: `${s.c}55`, background: `${s.c}14`,
    }}>
        <span className={('pulse' in s && (s as any).pulse) ? 'mcp-pulse' : ''} style={{
            width: 6, height: 6, borderRadius: '50%', background: s.c, display: 'inline-block',
        }}/> {s.label}
    </span>;
}

export function Toggle({on, onClick}: { on: boolean; onClick: () => void }) {
    return <div className={`mcp-toggle ${on ? 'on' : 'off'}`} onClick={onClick} role="switch" aria-checked={on} tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}/>;
}

export function Btn({children, onClick, variant = 'primary', disabled, title}: {
    children: ReactNode;
    onClick?: () => void;
    variant?: 'primary' | 'ghost' | 'danger';
    disabled?: boolean;
    title?: string;
}) {
    const cls = variant === 'ghost' ? 'mcp-btn mcp-btn-ghost' : variant === 'danger' ? 'mcp-btn mcp-btn-danger' : 'mcp-btn';
    return <button className={cls} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}

export function Field({label, children, hint}: { label: string; children: ReactNode; hint?: string }) {
    return <label style={{display: 'block', marginBottom: 10}}>
        <div style={{fontSize: 10.5, color: palette.dim, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4}}>{label}</div>
        {children}
        {hint && <div style={{fontSize: 10.5, color: palette.dim, marginTop: 3}}>{hint}</div>}
    </label>;
}

export const dot = (color: string) => ({
    width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flex: 'none',
} as const);
