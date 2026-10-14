// In the composer: a button that opens a dialog to write one time in several
// zones ("15:00 Berlin / 09:00 New York") and insert it where the cursor is.
// Copying is there too, for when the composer can't take the text.

import { useId, useMemo, useRef, useState } from 'react';
import { getApi, t, locale } from '../host.js';
import { composeLine, nextFullHour } from '../lib/compose.js';
import { zoneCity } from '../lib/zones.js';
import { ClockIcon, Styles, ZoneField, useSettings } from './common.jsx';

/**
 * composer-toolbar. The dialog answers with the line to insert (or null);
 * the button then writes it into the message with the composer's
 * insertText, which only this slot gets.
 */
export function ComposeButton({ insertText }) {
  const [failed, setFailed] = useState(false);
  const open = async () => {
    setFailed(false);
    let text = null;
    try {
      text = await getApi()?.ui.openDialog({
        title: t('compose.dialogTitle'),
        slot: 'plugin-dialog',
        width: 520,
        extraProps: { canInsert: typeof insertText === 'function' },
      });
    } catch {
      return;
    }
    if (typeof text !== 'string' || !text || typeof insertText !== 'function') return;
    let ok = false;
    try { ok = (await insertText(text)) !== false; } catch { ok = false; }
    if (!ok) setFailed(true);
  };
  return (
    <>
      <Styles />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button type="button" className="tz-btn tz-btn-ghost" onClick={() => void open()} data-tz="compose-button" style={{ height: 32 }}>
          <ClockIcon size={16} />
          <span>{t('compose.button')}</span>
        </button>
        {failed && <span role="alert" className="tz-warn" style={{ fontSize: 12 }}>{t('compose.insertFailed')}</span>}
      </span>
    </>
  );
}

/**
 * Copy text: the async clipboard first, then the old copy command on the
 * selected field. Returns false when the browser allowed neither (an
 * isolated plugin frame may not), and leaves the text selected.
 */
export async function copyText(text, field) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* try the next way */ }
  try {
    field?.focus();
    field?.select();
    if (document.execCommand?.('copy')) return true;
  } catch { /* blocked; the text stays selected */ }
  return false;
}

/** plugin-dialog */
export function ComposeDialog({ onResult, canInsert }) {
  const settings = useSettings();
  const loc = locale();
  const start = useMemo(() => nextFullHour(Date.now(), settings.home), [settings.home]);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [extra, setExtra] = useState([]);
  const [off, setOff] = useState([]);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState(null);
  const fieldRef = useRef(null);
  const ids = { date: useId(), time: useId(), text: useId() };

  const all = [settings.home, ...settings.favourites, ...extra].filter((z, i, list) => list.indexOf(z) === i);
  const picked = all.filter((z) => !off.includes(z));
  const text = composeLine({ date, time, fromZone: settings.home, zones: picked, locale: loc });

  const toggle = (zone) => setOff((list) => (list.includes(zone) ? list.filter((z) => z !== zone) : [...list, zone]));
  const copy = async () => {
    const ok = await copyText(text, fieldRef.current);
    setStatus(ok ? 'copied' : 'blocked');
  };

  return (
    <div data-tz="compose-dialog" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 4, fontSize: 13 }}>
      <Styles />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label htmlFor={ids.date} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="tz-muted" style={{ fontSize: 12 }}>{t('compose.date')}</span>
          <input id={ids.date} className="tz-input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setStatus(null); }} />
        </label>
        <label htmlFor={ids.time} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="tz-muted" style={{ fontSize: 12 }}>{t('compose.time', { city: zoneCity(settings.home) })}</span>
          <input id={ids.time} className="tz-input" type="time" value={time} onChange={(e) => { setTime(e.target.value); setStatus(null); }} />
        </label>
      </div>

      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <legend className="tz-muted" style={{ fontSize: 12, marginBottom: 4 }}>{t('compose.zones')}</legend>
        {all.map((zone) => (
          <label key={zone} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={!off.includes(zone)} onChange={() => { toggle(zone); setStatus(null); }} />
            <span>{zoneCity(zone)} <span className="tz-muted">{zone}</span></span>
          </label>
        ))}
        {adding ? (
          <ZoneField
            label={t('compose.addZone')}
            submitLabel={t('compose.add')}
            onCancel={() => setAdding(false)}
            onSubmit={(zone) => { setExtra((list) => [...list, zone]); setOff((list) => list.filter((z) => z !== zone)); setAdding(false); setStatus(null); }}
          />
        ) : (
          <div><button type="button" className="tz-link" onClick={() => setAdding(true)}>{t('compose.addZone')}</button></div>
        )}
      </fieldset>

      <label htmlFor={ids.text} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="tz-muted" style={{ fontSize: 12 }}>{t('compose.preview')}</span>
        <textarea
          id={ids.text}
          ref={fieldRef}
          readOnly
          rows={2}
          value={text}
          data-tz="compose-text"
          className="tz-input"
          style={{ height: 'auto', padding: 8, resize: 'vertical', fontSize: 13 }}
        />
      </label>
      {!text && <div role="alert" className="tz-warn">{t('compose.noZones')}</div>}
      {status && (
        <div role="status" className={status === 'copied' ? 'tz-muted' : 'tz-warn'}>
          {t(status === 'copied' ? 'compose.copied' : 'compose.copyFailed')}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="tz-btn" onClick={() => onResult?.(null)}>{t('compose.close')}</button>
        <button type="button" className={canInsert ? 'tz-btn' : 'tz-btn tz-btn-primary'} disabled={!text} onClick={() => void copy()}>{t('compose.copy')}</button>
        {canInsert && (
          <button type="button" className="tz-btn tz-btn-primary" disabled={!text} onClick={() => onResult?.(text)}>{t('compose.insert')}</button>
        )}
      </div>
    </div>
  );
}
