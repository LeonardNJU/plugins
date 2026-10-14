// Dialogs the deliveries section opens (plugin-dialog slot). The host draws
// the title, the close button and the footer; the buttons go there through
// DialogButtons.
//   mode 'add':    a tracking number to follow by hand. Resolves { added }.
//   mode 'parcel': one parcel's status, Track and Mark received.

import * as React from 'react';
import host from '@plugin-host';
import { Alert, DialogButtons, Field, Input, Loading, Stack, Text } from '@plugin-host/ui';
import { parcelFromInput } from '../lib/detect.js';
import { getParcel, rememberParcels, saveParcel } from '../lib/parcels.js';
import { carrierLabel, errorText, eventLine, formatDate, shownStatus, statusLabel } from '../lib/view.js';

const h = React.createElement;
const t = (key, vars) => host.i18n.t(key, vars);

function AddDialog({ onResult }) {
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (busy || !input.trim()) return;
    const found = parcelFromInput(input);
    if (!found) { setError(t('widget.addInvalid')); return; }
    setBusy(true);
    try {
      const [stored] = await rememberParcels(host.storage, [found], { now: Date.now() });
      if (stored.received) await saveParcel(host.storage, { ...stored, received: false });
      onResult?.({ added: stored.number });
    } catch (err) {
      host.log.warn('parcels: could not add the number', err);
      setBusy(false);
    }
  };

  return h(Stack, { gap: 4 },
    h(Field, { label: t('widget.addPlaceholder'), error: error || undefined },
      h(Input, {
        value: input, maxLength: 40, autoFocus: true, autoComplete: 'off', spellCheck: false,
        onChange: (e) => { setInput(e.target.value); setError(''); },
        onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } },
      })),
    h(DialogButtons, {
      buttons: [
        { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
        { id: 'add', label: t('widget.addButton'), variant: 'primary', busy, disabled: !input.trim() },
      ],
      onClick: (id) => { if (id === 'cancel') onResult?.(null); else void submit(); },
    }));
}

function ParcelDialog({ number, onResult }) {
  const [parcel, setParcel] = React.useState(undefined);

  React.useEffect(() => {
    let cancelled = false;
    getParcel(host.storage, number)
      .then((p) => { if (!cancelled) setParcel(p ?? null); })
      .catch((err) => { host.log.warn('parcels: could not read the parcel', err); if (!cancelled) setParcel(null); });
    return () => { cancelled = true; };
  }, [number]);

  if (parcel === undefined) return h(Loading);
  if (parcel === null) return h(Text, { tone: 'muted' }, t('widget.empty'));

  const locale = host.i18n.getLocale();
  const status = shownStatus(parcel);
  const carrier = carrierLabel(t, parcel);
  const detail = eventLine(parcel, locale);
  const eta = parcel.eta && status !== 'delivered' ? formatDate(parcel.eta.to || parcel.eta.from, locale) : '';

  const markReceived = async () => {
    const current = (await getParcel(host.storage, parcel.number)) ?? parcel;
    await saveParcel(host.storage, { ...current, received: true });
    onResult?.({ received: parcel.number });
  };

  return h(Stack, { gap: 4 },
    h(Stack, { gap: 1 },
      h('div', { 'data-status': status || '' }, h(Text, { weight: 'medium' }, status ? statusLabel(t, status) : statusLabel(t, 'pending'))),
      detail ? h(Text, { tone: 'muted' }, detail) : null,
      // Without a subject the dialog's title is already carrier and number.
      parcel.subject ? h(Text, { tone: 'muted' }, `${carrier} ${parcel.number}`) : null,
      eta ? h(Text, { tone: 'muted' }, t('card.eta', { date: eta })) : null,
      parcel.stopped ? h(Text, { tone: 'muted' }, t('widget.stopped')) : null),
    parcel.error ? h(Alert, { tone: 'warning', icon: 'alert-triangle' }, errorText(t, parcel.error)) : null,
    h(DialogButtons, {
      buttons: [
        { id: 'received', label: t('card.markReceived'), variant: 'secondary', icon: 'check' },
        { id: 'track', label: t('card.track', { carrier }), variant: 'primary', icon: 'external-link' },
      ],
      onClick: (id) => {
        if (id === 'track') void host.ui.openExternalUrl(parcel.trackingUrl);
        else void markReceived();
      },
    }));
}

export function PluginDialog(props) {
  if (props?.mode === 'add') return h(AddDialog, { onResult: props.onResult });
  if (props?.mode === 'parcel' && typeof props.number === 'string') return h(ParcelDialog, { number: props.number, onResult: props.onResult });
  return null;
}
