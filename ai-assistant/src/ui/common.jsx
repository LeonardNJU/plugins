// Shared pieces of the assistant's UI. Colours come from the host theme's
// CSS variables, so light, dark and custom themes all work.

import { useCallback, useEffect, useRef, useState } from 'react';
import { runTask } from '../lib/assistant.js';
import { AiError, messageFor } from '../lib/errors.js';

export const host = () => require('@plugin-host');
export const t = (key, vars) => host().i18n.t(key, vars);

export const CSS = `
* { box-sizing: border-box; }
body { margin: 0; }
.ai { font-size: 13px; line-height: 1.45; color: var(--color-foreground); }
.ai-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ai-btn {
  font: inherit; font-size: 12px; line-height: 1.2; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 6px;
  border: 1px solid var(--color-border); background: var(--color-background); color: var(--color-foreground);
}
.ai-btn:hover:not(:disabled) { background: var(--color-accent); color: var(--color-accent-foreground); }
.ai-btn:focus-visible, .ai-input:focus-visible, .ai-select:focus-visible, .ai-text:focus-visible {
  outline: 2px solid var(--color-ring); outline-offset: 1px;
}
.ai-btn:disabled { opacity: .55; cursor: default; }
.ai-btn.primary { background: var(--color-primary); color: var(--color-primary-foreground); border-color: var(--color-primary); }
.ai-btn.primary:hover:not(:disabled) { opacity: .9; background: var(--color-primary); color: var(--color-primary-foreground); }
.ai-btn.ghost { border-color: transparent; background: transparent; }
.ai-btn.small { padding: 3px 8px; font-size: 11.5px; }
.ai-input, .ai-select, .ai-text {
  font: inherit; font-size: 13px; color: var(--color-foreground); background: var(--color-background);
  border: 1px solid var(--color-input); border-radius: 6px; padding: 6px 8px; min-width: 0;
}
.ai-text { width: 100%; resize: vertical; min-height: 120px; line-height: 1.5; }
.ai-muted { color: var(--color-muted-foreground); font-size: 12px; }
.ai-card { border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-card, var(--color-background)); color: var(--color-card-foreground, var(--color-foreground)); }
.ai-out { white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px 12px; }
.ai-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--color-border); }
.ai-title { font-weight: 600; font-size: 12.5px; }
.ai-error { color: var(--color-destructive); padding: 10px 12px; }
.ai-cursor::after { content: '▍'; opacity: .6; margin-left: 1px; }
.ai-label { font-size: 12px; font-weight: 500; display: block; margin-bottom: 4px; }
.ai-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
ul.ai-list { margin: 0; padding: 0 12px 10px 28px; }
ul.ai-list li { margin: 3px 0; }
.ai-section { padding: 8px 12px 0; font-weight: 600; font-size: 12px; }
del.ai-from { color: var(--color-destructive); text-decoration: line-through; }
ins.ai-to { color: var(--color-success, var(--color-primary)); text-decoration: none; font-weight: 600; }
.ai-change { background: var(--color-muted); border-radius: 4px; padding: 0 2px; }
.ai-change-actions { display: inline-flex; gap: 2px; margin: 0 4px; vertical-align: middle; }
`;

export function Styles() {
  return <style>{CSS}</style>;
}

/** Copy text from inside the sandbox. The async clipboard API needs a
 *  permission the plugin frame doesn't have, so fall back to a selection. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function copyWithToast(text, okKey = 'common.copied') {
  const ok = await copyText(text);
  if (ok) host().toast.success(t(okKey));
  else host().toast.error(t('common.copy_failed'));
  return ok;
}

/**
 * Run tasks one at a time, with streaming text, Stop and errors.
 * status: idle | running | done | stopped | error
 */
export function useTask() {
  const [state, setState] = useState({ status: 'idle', text: '', error: null, task: null });
  const current = useRef(null);

  const run = useCallback(async (task, input) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setState({ status: 'running', text: '', error: null, task });
    try {
      const text = await runTask(host(), task, input, {
        signal: controller.signal,
        onText: (full) => { if (current.current === controller) setState((s) => ({ ...s, text: full })); },
      });
      if (current.current === controller) setState({ status: 'done', text, error: null, task });
      return text;
    } catch (err) {
      if (current.current !== controller) return null;
      const error = err instanceof AiError ? err : new AiError('unreachable', { detail: err?.message });
      if (error.code === 'cancelled') setState((s) => ({ status: 'stopped', text: error.partial || s.text, error: null, task }));
      else if (error.code === 'declined') setState({ status: 'idle', text: '', error: null, task: null });
      else setState({ status: 'error', text: error.partial || '', error, task });
      return null;
    }
  }, []);

  const cancel = useCallback(() => current.current?.abort(), []);
  const reset = useCallback(() => {
    current.current?.abort();
    current.current = null;
    setState({ status: 'idle', text: '', error: null, task: null });
  }, []);

  useEffect(() => () => current.current?.abort(), []);
  return { ...state, run, cancel, reset };
}

/** The error in plain words, with a retry button that waits out a rate limit. */
export function ErrorMessage({ error, onRetry }) {
  const [wait, setWait] = useState(error?.retryAfter ?? 0);
  useEffect(() => {
    setWait(error?.retryAfter ?? 0);
  }, [error]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);
  if (!error) return null;
  const shown = error.code === 'rate_limit' && error.retryAfter
    ? (wait > 0 ? t('error.rate_limit_wait', { seconds: wait }) : t('error.rate_limit_now'))
    : messageFor(t, error);
  return (
    <div className="ai-error" role="alert">
      <div>{shown}</div>
      {onRetry && (
        <div className="ai-row" style={{ marginTop: 6 }}>
          <button type="button" className="ai-btn small" onClick={onRetry} disabled={wait > 0}>{t('common.retry')}</button>
        </div>
      )}
    </div>
  );
}

/** Streaming text with a blinking cursor while it runs; announced politely. */
export function StreamText({ text, running }) {
  return (
    <div className={`ai-out${running ? ' ai-cursor' : ''}`} aria-live="polite" aria-busy={running}>
      {text || (running ? t('common.thinking') : '')}
    </div>
  );
}

export function Spark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}
