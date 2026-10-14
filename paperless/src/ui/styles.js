// One stylesheet for every Paperless view, built on the host theme's CSS
// variables so light, dark and custom themes all apply.

export const CSS = `
.pl { color: var(--color-foreground); background: var(--color-background); font-size: 14px; line-height: 1.45; box-sizing: border-box; }
.pl *, .pl *::before, .pl *::after { box-sizing: border-box; }
.pl-page { padding: 16px; max-width: 1100px; margin: 0 auto; }
.pl h2 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
.pl h3 { font-size: 15px; font-weight: 600; margin: 16px 0 8px; }
.pl p { margin: 4px 0 8px; }
.pl-muted { color: var(--color-muted-foreground); font-size: 13px; }
.pl-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pl-grow { flex: 1 1 auto; min-width: 0; }
.pl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.pl .pl-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 500; }
.pl input[type=text], .pl input[type=search], .pl input[type=date], .pl select {
  height: 34px; padding: 0 10px; border: 1px solid var(--color-input); border-radius: 6px;
  background: var(--color-background); color: var(--color-foreground); font: inherit; font-size: 14px; width: 100%; min-width: 0;
}
.pl input:focus-visible, .pl select:focus-visible, .pl button:focus-visible, .pl a:focus-visible, .pl [tabindex]:focus-visible {
  outline: 2px solid var(--color-ring); outline-offset: 1px;
}
.pl button { font: inherit; font-size: 14px; cursor: pointer; border-radius: 6px; height: 34px; padding: 0 12px;
  border: 1px solid var(--color-border); background: var(--color-background); color: var(--color-foreground); white-space: nowrap; }
.pl button:hover:not(:disabled) { background: var(--color-muted); }
.pl button:disabled { opacity: .55; cursor: default; }
.pl button.pl-primary { background: var(--color-primary); color: var(--color-primary-foreground); border-color: var(--color-primary); }
.pl button.pl-primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--color-primary); }
.pl button.pl-danger { color: var(--color-destructive); }
.pl button.pl-link { border: none; background: none; padding: 0 4px; height: auto; color: var(--color-primary); text-decoration: underline; }
.pl-card { border: 1px solid var(--color-border); border-radius: 8px; padding: 12px; background: var(--color-card); color: var(--color-card-foreground); }
.pl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pl-item { display: flex; gap: 10px; align-items: flex-start; padding: 8px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-card); }
.pl-item.pl-active { border-color: var(--color-primary); }
.pl-item input[type=checkbox] { margin-top: 3px; width: 16px; height: 16px; flex: none; accent-color: var(--color-primary); }
.pl-name { font-weight: 500; overflow-wrap: anywhere; }
.pl-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 1px 8px; border-radius: 999px;
  background: var(--color-muted); color: var(--color-muted-foreground); }
.pl-badge.pl-type { background: transparent; border: 1px solid var(--color-border); }
.pl-badge.pl-warn { background: color-mix(in srgb, var(--color-warning) 18%, transparent); color: var(--color-foreground); }
.pl-badge.pl-ok { background: color-mix(in srgb, var(--color-success) 18%, transparent); color: var(--color-foreground); }
.pl-chips { display: flex; flex-wrap: wrap; gap: 6px; max-height: 132px; overflow: auto; padding: 2px; }
.pl-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--color-border);
  font-size: 13px; cursor: pointer; user-select: none; }
.pl-chip input { margin: 0; accent-color: var(--color-primary); }
.pl-chip.pl-on { background: var(--color-accent); color: var(--color-accent-foreground); border-color: transparent; }
.pl-error { border: 1px solid var(--color-destructive); color: var(--color-foreground); background: color-mix(in srgb, var(--color-destructive) 10%, transparent);
  border-radius: 8px; padding: 8px 12px; }
.pl-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.pl-thumb { width: 64px; height: 84px; flex: none; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-muted);
  object-fit: cover; object-position: top; }
.pl-docs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.pl-detail img.pl-big { width: 100%; max-height: 300px; object-fit: contain; background: var(--color-muted); border-radius: 6px; border: 1px solid var(--color-border); }
.pl-content { white-space: pre-wrap; font-size: 13px; max-height: 220px; overflow: auto; background: var(--color-muted); padding: 8px; border-radius: 6px; }
.pl-dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; font-size: 13px; margin: 8px 0; }
.pl-dl dt { color: var(--color-muted-foreground); }
.pl-dl dd { margin: 0; overflow-wrap: anywhere; }
.pl-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.pl-bar { position: sticky; bottom: 0; background: var(--color-background); border-top: 1px solid var(--color-border); padding: 8px 0; margin-top: 8px; }
@media (max-width: 520px) {
  .pl-docs { grid-template-columns: minmax(0, 1fr); }
  .pl-page { padding: 12px; }
  .pl-actions button { flex: 1 1 auto; }
}
`;
