// Shared bits of the slot UIs: the zone picker field and the per-person
// zone store. Everything is drawn with the app's UI kit.

import { useCallback, useEffect, useId, useState } from 'react';
import { Button, Field, Input, Row, Stack } from '@plugin-host/ui';
import { getApi, t } from '../host.js';
import { loadAddressZones, setAddressZone } from '../lib/address-zones.js';
import { readMirroredSettings, readSettings } from '../lib/settings.js';
import { knownZones, resolveZone, zoneCity } from '../lib/zones.js';

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

/**
 * How often a slot re-reads the zones set for people. Another slot of the
 * plugin (the message details, the settings page) may set one, and frames
 * hear nothing of each other's storage writes; this keeps the reader's bar
 * and the event form current.
 */
export const ADDRESS_ZONES_REFRESH_MS = 3000;

/** The zones set for people, with a setter that saves them. */
export function useAddressZones() {
  const [zones, setZones] = useState({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    const api = getApi();
    if (!api) { setLoaded(true); return undefined; }
    let last = null;
    const load = () => loadAddressZones(api.storage).then((map) => {
      if (!live) return;
      const key = JSON.stringify(map);
      if (key !== last) { last = key; setZones(map); }
      setLoaded(true);
    }, () => { if (live) setLoaded(true); });
    void load();
    const id = setInterval(() => { void load(); }, ADDRESS_ZONES_REFRESH_MS);
    return () => { live = false; clearInterval(id); };
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
    <Stack gap={2}>
      <Field label={label} error={error || undefined}>
        <Input
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
        />
      </Field>
      <datalist id={listId}>
        {options().map((o) => <option key={o.zone} value={o.zone}>{o.city}</option>)}
      </datalist>
      <Row gap={2}>
        <Button size="sm" busy={busy} disabled={!value.trim()} onClick={() => void submit()}>{submitLabel ?? t('zone.save')}</Button>
        {onCancel && <Button size="sm" variant="secondary" onClick={onCancel}>{t('zone.cancel')}</Button>}
      </Row>
    </Stack>
  );
}
