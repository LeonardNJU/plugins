// Shared bits of the slot UIs: theme-aware styles, the zone picker field and
// the per-person zone store.

import { useCallback, useEffect, useId, useState } from 'react';
import { getApi, t } from '../host.js';
import { loadAddressZones, setAddressZone } from '../lib/address-zones.js';
import { readMirroredSettings, readSettings } from '../lib/settings.js';
import { knownZones, resolveZone, zoneCity } from '../lib/zones.js';

// Slot iframes get the host theme as CSS variables; everything here reads
// them, so light, dark and custom themes all work.
const CSS = `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-size: 13px; line-height: 1.45; }
.tz-muted { color: var(--color-muted-foreground); }
.tz-warn { color: var(--color-warning, #b45309); }
.tz-error { color: var(--color-destructive); }
.tz-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
  border: 1px solid var(--color-border); border-radius: var(--radius-md, 6px);
  background: var(--color-background); color: var(--color-foreground);
  font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.tz-btn:hover { background: var(--color-muted); }
.tz-btn:disabled { opacity: .5; cursor: default; }
.tz-btn-primary { background: var(--color-primary); color: var(--color-primary-foreground); border-color: var(--color-primary); }
.tz-btn-primary:hover { background: var(--color-primary); opacity: .9; }
.tz-btn-ghost { border-color: transparent; background: transparent; color: var(--color-muted-foreground); padding: 0 6px; }
.tz-btn-ghost:hover { color: var(--color-foreground); }
.tz-link { border: 0; background: none; padding: 0; font: inherit; font-size: 12px; color: var(--color-primary); cursor: pointer; text-decoration: underline; }
.tz-input {
  height: 28px; padding: 0 8px; min-width: 0;
  border: 1px solid var(--color-input, var(--color-border)); border-radius: var(--radius-md, 6px);
  background: var(--color-background); color: var(--color-foreground); font: inherit; font-size: 12px;
}
.tz-btn:focus-visible, .tz-input:focus-visible, .tz-link:focus-visible, input[type=checkbox]:focus-visible {
  outline: 2px solid var(--color-ring, var(--color-primary)); outline-offset: 1px;
}
.tz-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.tz-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--color-muted-foreground); }
.tz-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

export function Styles() {
  return <style>{CSS}</style>;
}

export function ClockIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

export function WarnIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" /><path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

/**
 * The user's settings. Starts from the copy the background keeps (see
 * mirrorSettings), then follows live changes; the slot re-renders on those.
 */
export function useSettings() {
  const api = getApi();
  const [mirror, setMirror] = useState(null);
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    void readMirroredSettings(api).then((value) => { if (live && value) setMirror(value); });
    const off = api.plugin?.onSettingsChange?.(() => { if (live) setMirror(null); });
    return () => { live = false; if (typeof off === 'function') off(); };
  }, [api]);
  return readSettings(mirror ?? api?.plugin?.settings ?? {});
}

/** The zones set for people, with a setter that saves them. */
export function useAddressZones() {
  const [zones, setZones] = useState({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    const api = getApi();
    if (!api) { setLoaded(true); return undefined; }
    void loadAddressZones(api.storage).then((map) => {
      if (live) { setZones(map); setLoaded(true); }
    });
    return () => { live = false; };
  }, []);
  const save = useCallback(async (address, zone) => {
    const map = await setAddressZone(getApi().storage, address, zone);
    setZones(map);
    return map;
  }, []);
  return { zones, loaded, save };
}

let zoneOptions = null;
function options() {
  if (!zoneOptions) zoneOptions = knownZones().map((z) => ({ zone: z, city: zoneCity(z) }));
  return zoneOptions;
}

/**
 * A text field for a time zone with suggestions. Takes a city or a zone id;
 * calls onSubmit(zone) with a resolved IANA id, or shows what was wrong.
 */
export function ZoneField({ label, onSubmit, onCancel, submitLabel, autoFocus = true }) {
  const listId = useId();
  const inputId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const zone = resolveZone(value);
    if (!zone) {
      setError(t('zone.unknown'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onSubmit(zone);
    } catch {
      setError(t('zone.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    // No <form>: the slot iframe's sandbox has no allow-forms, so a submit
    // would be blocked before any handler ran. Enter is handled by hand.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label htmlFor={inputId} className="tz-muted" style={{ fontSize: 12 }}>{label}</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          id={inputId}
          className="tz-input"
          list={listId}
          value={value}
          autoFocus={autoFocus}
          placeholder={t('zone.placeholder')}
          aria-invalid={error ? 'true' : undefined}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submit(); }
            if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
          }}
          style={{ flex: '1 1 160px' }}
        />
        <datalist id={listId}>
          {options().map((o) => <option key={o.zone} value={o.zone}>{o.city}</option>)}
        </datalist>
        <button type="button" className="tz-btn tz-btn-primary" disabled={busy || !value.trim()} onClick={() => void submit()}>{submitLabel ?? t('zone.save')}</button>
        {onCancel && <button type="button" className="tz-btn" onClick={onCancel}>{t('zone.cancel')}</button>}
      </div>
      {error && <div role="alert" className="tz-error" style={{ fontSize: 12 }}>{error}</div>}
    </div>
  );
}
