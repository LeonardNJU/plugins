// One stylesheet per slot iframe, built on the host theme's CSS variables
// (the runtime replays them and sets .dark on <html>).

const CSS = `
.nc { font-size: 13px; color: var(--color-foreground); line-height: 1.4; }
.nc * { box-sizing: border-box; }
.nc-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nc-col { display: flex; flex-direction: column; gap: 8px; }
.nc-grow { flex: 1 1 auto; min-width: 0; }
.nc-muted { color: var(--color-muted-foreground); }
.nc-small { font-size: 12px; }
.nc-error { color: var(--color-destructive); }
.nc-ok { color: var(--color-success, var(--color-foreground)); }
.nc-btn { font: inherit; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 12px; min-height: 32px;
  border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-background); color: var(--color-foreground); cursor: pointer; white-space: nowrap; }
.nc-btn:hover:not(:disabled) { background: var(--color-accent); color: var(--color-accent-foreground); }
.nc-btn:disabled { opacity: .55; cursor: default; }
.nc-btn:focus-visible, .nc-input:focus-visible, .nc-item:focus-visible, .nc-tab:focus-visible, .nc-crumb:focus-visible, .nc-check:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 1px; }
.nc-primary { background: var(--color-primary); color: var(--color-primary-foreground); border-color: var(--color-primary); }
.nc-primary:hover:not(:disabled) { background: var(--color-primary); color: var(--color-primary-foreground); filter: brightness(1.08); }
.nc-danger { color: var(--color-destructive); }
.nc-link { font: inherit; background: none; border: 0; padding: 0; color: var(--color-primary); cursor: pointer; text-decoration: underline; }
.nc-input { font: inherit; padding: 6px 8px; min-height: 32px; border-radius: 6px; border: 1px solid var(--color-input); background: var(--color-background); color: var(--color-foreground); }
.nc-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.nc-check { width: 16px; height: 16px; accent-color: var(--color-primary); margin: 0; }
.nc-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-border); }
.nc-tab { font: inherit; background: none; border: 0; border-bottom: 2px solid transparent; padding: 6px 10px; color: var(--color-muted-foreground); cursor: pointer; }
.nc-tab[aria-selected="true"] { color: var(--color-foreground); border-bottom-color: var(--color-primary); }
.nc-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; font-size: 12px; }
.nc-crumb { font: inherit; background: none; border: 0; padding: 2px 4px; border-radius: 4px; color: var(--color-muted-foreground); cursor: pointer; }
.nc-crumb:hover { background: var(--color-muted); color: var(--color-foreground); }
.nc-crumb[aria-current="page"] { color: var(--color-foreground); font-weight: 600; }
.nc-list { border: 1px solid var(--color-border); border-radius: 8px; overflow: auto; background: var(--color-background); }
.nc-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-bottom: 1px solid var(--color-border);
  background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; min-height: 40px; }
.nc-item:last-child { border-bottom: 0; }
.nc-item:hover { background: var(--color-muted); }
.nc-item[aria-selected="true"], .nc-item[data-checked="true"] { background: var(--color-selection, var(--color-accent)); color: var(--color-selection-foreground, var(--color-accent-foreground)); }
.nc-icon { width: 18px; height: 18px; flex: 0 0 18px; color: var(--color-muted-foreground); }
.nc-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nc-meta { flex: 0 0 auto; font-size: 12px; color: var(--color-muted-foreground); white-space: nowrap; }
.nc-empty { padding: 24px 12px; text-align: center; color: var(--color-muted-foreground); }
.nc-bar { height: 6px; border-radius: 3px; background: var(--color-muted); overflow: hidden; }
.nc-bar > span { display: block; height: 100%; background: var(--color-primary); transition: width .2s; }
.nc-card { border: 1px solid var(--color-border); border-radius: 8px; padding: 12px; background: var(--color-card, var(--color-background)); color: var(--color-card-foreground, var(--color-foreground)); }
.nc-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 4px 2px 8px; border-radius: 999px; background: var(--color-muted); font-size: 12px; }
.nc-chip button { font: inherit; border: 0; background: none; color: inherit; cursor: pointer; padding: 2px 6px; border-radius: 999px; }
.nc-chip button:hover { background: var(--color-accent); }
.nc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 520px) {
  .nc-meta.nc-hide-narrow { display: none; }
  .nc-footer { flex-direction: column; align-items: stretch; }
  .nc-footer .nc-btn { width: 100%; }
}
`;

export function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('nc-styles')) return;
  const el = document.createElement('style');
  el.id = 'nc-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}
