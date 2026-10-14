import { useCallback, useEffect, useMemo, useState } from 'react';
import { CSS } from './styles.js';
import { getApi, t, hostOf } from './host.js';
import { clientFor, connectPersonal, resolveConnection } from '../lib/connection.js';
import { errorText } from '../lib/errors.js';

export function Styles() {
  return <style>{CSS}</style>;
}

/** The connection, resolved once per mount; `refresh` re-checks it. */
export function useConnection(initial) {
  const [connection, setConnection] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setConnection(await resolveConnection(getApi()));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (!initial) void refresh(); }, [initial, refresh]);
  const client = useMemo(() => (connection?.state === 'connected' ? clientFor(getApi(), connection) : null), [connection]);
  return { connection, client, loading, refresh };
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="pl-error" role="alert">
      <span>{errorText(t, error)}</span>
      {onRetry && <> <button type="button" className="pl-link" onClick={onRetry}>{t('common.retry')}</button></>}
    </div>
  );
}

/** "Connect Paperless" for a user without a connection. */
export function ConnectPanel({ connection, onConnected }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await connectPersonal(getApi(), connection?.suggestedServer || '');
      if (result.connected) onConnected?.(result.connection);
      else if (result.error) setError(result.error);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pl-card">
      <p>{connection?.suggestedServer
        ? t('connect.intro_server', { host: hostOf(connection.suggestedServer) })
        : t('connect.intro')}</p>
      <p className="pl-muted">{t('connect.token_hint')}</p>
      <ErrorBox error={error} />
      <div className="pl-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="pl-primary" onClick={connect} disabled={busy}>
          {busy ? t('common.working') : t('connect.button')}
        </button>
      </div>
    </div>
  );
}

/**
 * A labelled control. The label sits beside the control rather than around
 * it, so the control's accessible name is the label alone.
 */
export function Field({ id, label, note, children, style }) {
  return (
    <div className="pl-field" style={style}>
      <span className="pl-row" style={{ gap: 6 }}>
        <label htmlFor={id}>{label}</label>
        {note}
      </span>
      {children}
    </div>
  );
}

/** A select over Paperless objects, with an empty "none" entry. */
export function PickOne({ id, label, items, value, onChange, noneLabel, suggested }) {
  return (
    <Field id={id} label={label} note={suggested ? <span className="pl-badge pl-ok">{t('send.suggested')}</span> : null}>
      <select id={id} value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">{noneLabel || t('common.none')}</option>
        {(items || []).map((it) => <option key={it.id} value={String(it.id)}>{it.name}</option>)}
      </select>
    </Field>
  );
}

/** Tags as toggle chips. */
export function TagPicker({ tags, value, onChange, label }) {
  const on = new Set(value || []);
  if (!tags?.length) return null;
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{label || t('field.tags')}</legend>
      <div className="pl-chips">
        {tags.map((tag) => (
          <label key={tag.id} className={`pl-chip${on.has(tag.id) ? ' pl-on' : ''}`}>
            <input
              type="checkbox"
              checked={on.has(tag.id)}
              onChange={() => {
                const next = new Set(on);
                if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id);
                onChange([...next]);
              }}
            />
            {tag.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The taxonomies of a client, loaded once. */
export function useTaxonomies(client) {
  const [tax, setTax] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      setTax(await client.taxonomies());
    } catch (err) {
      setError(err);
    }
  }, [client?.base, client?.credentialId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  return { tax, error, reload: load };
}
