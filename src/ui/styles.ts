/***
 Design system: single injected stylesheet (classes for interactive states)
 + a palette for inline styles. Dark glass, cyan/lime accents.
 ***/

export const palette = {
    bg: 'rgba(10, 12, 18, 0.92)',
    card: 'rgba(20, 26, 40, 0.55)',
    cardHover: 'rgba(30, 38, 58, 0.65)',
    border: 'rgba(120, 180, 255, 0.14)',
    borderBright: 'rgba(120, 200, 255, 0.38)',
    text: '#dce7ff',
    dim: 'rgba(190, 205, 235, 0.55)',
    accent: '#38e0ff',
    accent2: '#a6ff6e',
    good: '#5be49b',
    warn: '#ffc860',
    bad: '#ff7a7a',
    off: 'rgba(150, 165, 195, 0.5)',
};

let injected = false;
export function injectCss() {
    if (injected || typeof document === 'undefined') return;
    injected = true;
    const style = document.createElement('style');
    style.textContent = `
.mcp-root * { box-sizing: border-box; }
.mcp-root { color: ${palette.text}; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 13px; }
.mcp-root ::-webkit-scrollbar { width: 7px; height: 7px; }
.mcp-root ::-webkit-scrollbar-thumb { background: rgba(120,180,255,0.18); border-radius: 4px; }
.mcp-root ::-webkit-scrollbar-track { background: transparent; }

.mcp-card {
  background: ${palette.card};
  border: 1px solid ${palette.border};
  border-radius: 12px;
  backdrop-filter: blur(10px);
  transition: background .15s ease, border-color .15s ease, transform .12s ease;
}
.mcp-card:hover { background: ${palette.cardHover}; border-color: ${palette.borderBright}; }

.mcp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 9px; cursor: pointer; user-select: none;
  background: linear-gradient(135deg, rgba(56,224,255,0.16), rgba(166,255,110,0.10));
  border: 1px solid ${palette.borderBright};
  color: ${palette.text}; font-size: 12px; font-weight: 600;
  transition: all .15s ease;
}
.mcp-btn:hover { box-shadow: 0 0 18px rgba(56,224,255,0.25); transform: translateY(-1px); }
.mcp-btn:active { transform: translateY(0px); }
.mcp-btn:disabled { opacity: .45; cursor: default; box-shadow: none; }

.mcp-btn-ghost {
  background: transparent; border: 1px solid ${palette.border};
}
.mcp-btn-ghost:hover { border-color: ${palette.borderBright}; box-shadow: none; background: rgba(120,180,255,0.07); }

.mcp-btn-danger { border-color: rgba(255,122,122,0.4); color: ${palette.bad}; background: rgba(255,80,80,0.07); }
.mcp-btn-danger:hover { box-shadow: 0 0 14px rgba(255,80,80,0.25); }

.mcp-input {
  width: 100%; background: rgba(5, 8, 14, 0.6); border: 1px solid ${palette.border};
  border-radius: 8px; padding: 7px 10px; color: ${palette.text}; font-size: 12px;
  font-family: ui-monospace, Consolas, monospace;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.mcp-input:focus { outline: none; border-color: ${palette.accent}; box-shadow: 0 0 0 3px rgba(56,224,255,0.12); }

.mcp-pill {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  padding: 2px 8px; border-radius: 999px; border: 1px solid transparent;
}

.mcp-iconbtn {
  cursor: pointer; border-radius: 7px; padding: 4px 7px; font-size: 12px;
  color: ${palette.dim}; border: 1px solid transparent; background: transparent;
  transition: all .12s ease;
}
.mcp-iconbtn:hover { color: ${palette.text}; background: rgba(120,180,255,0.1); }

@keyframes mcp-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.mcp-pulse { animation: mcp-pulse 1.1s ease-in-out infinite; }

@keyframes mcp-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.mcp-fade { animation: mcp-fade-in .22s ease both; }

@keyframes mcp-modal-in { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }

.mcp-toggle { position: relative; width: 34px; height: 19px; border-radius: 999px; cursor: pointer; transition: background .18s ease; flex: none; }
.mcp-toggle::after {
  content: ''; position: absolute; top: 2px; width: 15px; height: 15px; border-radius: 50%;
  background: #fff; transition: left .18s ease;
}
.mcp-toggle.on  { background: linear-gradient(135deg, ${palette.accent}, ${palette.accent2}); }
.mcp-toggle.on::after  { left: 17px; }
.mcp-toggle.off { background: rgba(140,160,200,0.25); }
.mcp-toggle.off::after { left: 2px; }

.mcp-chip {
  font-family: ui-monospace, Consolas, monospace; font-size: 10.5px;
  padding: 2px 7px; border-radius: 6px; background: rgba(56,224,255,0.08);
  border: 1px solid rgba(56,224,255,0.2); color: ${palette.accent};
}

.mcp-gradient-text {
  background: linear-gradient(90deg, ${palette.accent}, ${palette.accent2});
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
`;
    document.head.appendChild(style);
}
