// In the composer: an entry in the Options menu opens a dialog to write one
// time in several zones ("15:00 Berlin / 09:00 New York") and insert it
// where the cursor is. Copying is there too, for when inserting fails.

import { useMemo, useRef, useState } from 'react';
import { Alert, Checkbox, DialogButtons, Field, Input, LinkButton, Row, Stack, Text, Textarea } from '@plugin-host/ui';
import { getApi, t, locale } from '../host.js';
import { composeLine, nextFullHour } from '../lib/compose.js';
import { zoneCity } from '../lib/zones.js';
import { ZoneField, useSettings } from './common.jsx';

export const OPTIONS_SURFACE = 'composer-options-menu';
export const INSERT_ACTION = 'insert-zone-times';

/** The Options menu entry (api.ui.setActions). */
export function composerActions() {
  return [{ id: INSERT_ACTION, label: t('compose.menu'), icon: 'clock' }];
}

/** A click on the Options entry: the dialog, for that composer. */
export function openComposeDialog(api, composerId) {
  return api.ui.openDialog({
    title: t('compose.dialogTitle'),
    slot: 'plugin-dialog',
    width: 520,
    extraProps: { composerId },
  });
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

const STATUS = {
  copied: { tone: 'success', key: 'compose.copied' },
  blocked: { tone: 'warning', key: 'compose.copyFailed' },
  insertFailed: { tone: 'danger', key: 'compose.insertFailed' },
};

/**
 * plugin-dialog. With a composerId (from the Options entry) Insert writes
 * the line at the caret with api.composer.replaceSelection and closes the
 * dialog with it. Copy is offered without a composer, or once inserting
 * failed.
 */
export function ComposeDialog({ onResult, composerId }) {
  const settings = useSettings();
  const loc = locale();
  const start = useMemo(() => nextFullHour(Date.now(), settings.home), [settings.home]);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [extra, setExtra] = useState([]);
  const [off, setOff] = useState([]);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef(null);

  const all = [settings.home, ...settings.favourites, ...extra].filter((z, i, list) => list.indexOf(z) === i);
  const picked = all.filter((z) => !off.includes(z));
  const text = composeLine({ date, time, fromZone: settings.home, zones: picked, locale: loc });
  const canInsert = typeof composerId === 'string' && composerId !== '';

  const toggle = (zone) => setOff((list) => (list.includes(zone) ? list.filter((z) => z !== zone) : [...list, zone]));
  const copy = async () => {
    const ok = await copyText(text, fieldRef.current);
    setStatus(ok ? 'copied' : 'blocked');
  };
  const insert = async () => {
    setBusy(true);
    let ok = false;
    try { ok = (await getApi()?.composer.replaceSelection(composerId, { text })) !== false; } catch { ok = false; }
    setBusy(false);
    if (ok) onResult?.(text);
    else setStatus('insertFailed');
  };

  const showCopy = !canInsert || status !== null;
  const buttons = [
    { id: 'cancel', label: t('zone.cancel'), variant: 'secondary' },
    ...(showCopy ? [{ id: 'copy', label: t('compose.copy'), variant: canInsert ? 'secondary' : 'primary', disabled: !text }] : []),
    ...(canInsert ? [{ id: 'insert', label: t('compose.insert'), variant: 'primary', disabled: !text, busy }] : []),
  ];
  const onButton = (id) => {
    if (id === 'cancel') onResult?.(null);
    else if (id === 'copy') void copy();
    else if (id === 'insert') void insert();
  };
  const shown = status ? STATUS[status] : null;

  return (
    <Stack gap={4}>
      <Row gap={4} align="start">
        <Field label={t('compose.date')}>
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setStatus(null); }} />
        </Field>
        <Field label={t('compose.time', { city: zoneCity(settings.home) })}>
          <Input type="time" value={time} onChange={(e) => { setTime(e.target.value); setStatus(null); }} />
        </Field>
      </Row>

      <Stack gap={2}>
        <Text weight="medium">{t('compose.zones')}</Text>
        {all.map((zone) => (
          <Checkbox
            key={zone}
            checked={!off.includes(zone)}
            onChange={() => { toggle(zone); setStatus(null); }}
            label={zoneCity(zone)}
            hint={zone}
          />
        ))}
        {adding ? (
          <ZoneField
            label={t('compose.addZone')}
            submitLabel={t('compose.add')}
            onCancel={() => setAdding(false)}
            onSubmit={(zone) => { setExtra((list) => [...list, zone]); setOff((list) => list.filter((z) => z !== zone)); setAdding(false); setStatus(null); }}
          />
        ) : (
          <Row><LinkButton icon="plus" onClick={() => setAdding(true)}>{t('compose.addZone')}</LinkButton></Row>
        )}
      </Stack>

      <Field label={t('compose.preview')}>
        <Textarea ref={fieldRef} readOnly rows={2} value={text} />
      </Field>
      {!text && <Alert tone="warning" icon="alert-triangle">{t('compose.noZones')}</Alert>}
      {shown && <Alert tone={shown.tone}>{t(shown.key)}</Alert>}

      <DialogButtons buttons={buttons} onClick={onButton} />
    </Stack>
  );
}
