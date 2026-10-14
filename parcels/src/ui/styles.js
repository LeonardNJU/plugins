// Shared styles for the slots. Only host theme variables, so light, dark and
// custom themes all work.
export const CSS = `
.pt-root { display: flow-root; font-size: 13px; line-height: 1.4; color: var(--color-foreground); }
.pt-card { margin: 6px 16px; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-muted); }
@media (max-width: 640px) { .pt-card { margin: 6px 8px; } }
.pt-row { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 6px 12px; padding: 6px 0; }
.pt-row + .pt-row { border-top: 1px solid var(--color-border); }
.pt-main { min-width: 0; flex: 1 1 220px; }
.pt-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.pt-carrier { font-weight: 600; }
.pt-number { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--color-muted-foreground); word-break: break-all; user-select: all; }
.pt-status { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-weight: 500; }
.pt-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.pt-detail { color: var(--color-muted-foreground); margin-top: 1px; overflow-wrap: anywhere; }
.pt-error { color: var(--color-destructive); margin-top: 2px; }
.pt-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pt-btn { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-background); color: var(--color-foreground); cursor: pointer; white-space: nowrap; }
.pt-btn:hover { background: var(--color-accent); color: var(--color-accent-foreground); }
.pt-btn:disabled { opacity: .6; cursor: default; }
.pt-btn:focus-visible, .pt-icon:focus-visible, .pt-input:focus-visible, .pt-link:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 1px; }
.pt-btn-primary { background: var(--color-primary); color: var(--color-primary-foreground); border-color: var(--color-primary); }
.pt-btn-primary:hover { background: var(--color-primary); color: var(--color-primary-foreground); opacity: .9; }
.pt-done { color: var(--color-success); font-weight: 500; font-size: 12px; }
.pt-widget { padding: 8px 12px; }
.pt-wtitle { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; color: var(--color-muted-foreground); margin-bottom: 4px; }
.pt-witem { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; }
.pt-witem + .pt-witem { border-top: 1px solid var(--color-border); }
.pt-wbody { flex: 1; min-width: 0; }
.pt-wlabel { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pt-wsub { font-size: 12px; color: var(--color-muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pt-icon { flex: none; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--color-muted-foreground); cursor: pointer; padding: 0; }
.pt-icon:hover { background: var(--color-accent); color: var(--color-accent-foreground); }
.pt-icon svg { width: 15px; height: 15px; }
.pt-empty { color: var(--color-muted-foreground); padding: 4px 0; }
.pt-link { font: inherit; font-size: 12px; background: none; border: 0; padding: 2px 0; color: var(--color-primary); cursor: pointer; }
.pt-form { display: flex; gap: 6px; margin-top: 6px; }
.pt-input { flex: 1; min-width: 0; font: inherit; font-size: 12px; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--color-input, var(--color-border)); background: var(--color-background); color: var(--color-foreground); }
`;
