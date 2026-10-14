// Deliveries widget (sidebar-widget slot): the parcels on their way, with
// "mark received" and a field to follow a number by hand.

import * as React from 'react';
import host from '@plugin-host';
import { parcelFromInput } from '../lib/detect.js';
import { applyOutcome, getParcel, listParcels, rememberParcels, saveParcel, visibleParcels } from '../lib/parcels.js';
import { createTracker } from '../lib/tracking.js';
import { statusTone } from '../lib/status.js';
import { carrierLabel, errorText, shortNumber, statusLabel } from '../lib/view.js';
import { CSS } from './styles.js';

const h = React.createElement;
const t = (key, vars) => host.i18n.t(key, vars);
const RELOAD_MS = 15_000;
const COLLAPSED = 5;
let tracker = null;
const getTracker = () => (tracker ??= createTracker(host));

const svg = (d) => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  ...d.map((p, i) => h('path', { key: i, d: p })));
const ICON_OPEN = ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'];
const ICON_CHECK = ['M5 12l5 5L20 7'];

function Item({ parcel, onOpen, onReceived }) {
  const carrier = carrierLabel(t, parcel);
  const status = parcel.error && !parcel.status ? null : parcel.status;
  const sub = [
    `${carrier} ${shortNumber(parcel.number)}`,
    parcel.stopped ? t('widget.stopped') : (status ? statusLabel(t, status) : (parcel.error ? errorText(t, parcel.error) : statusLabel(t, 'pending'))),
  ].join(' · ');
  return h('li', { className: 'pt-witem', 'data-parcel': parcel.number, 'data-status': status || '' },
    h('span', { className: 'pt-dot', style: { marginTop: 6, background: statusTone(status || 'pending') }, 'aria-hidden': true }),
    h('div', { className: 'pt-wbody' },
      h('div', { className: 'pt-wlabel', title: parcel.subject || parcel.number }, parcel.subject || `${carrier} ${parcel.number}`),
      h('div', { className: 'pt-wsub' }, sub)),
    h('button', { type: 'button', className: 'pt-icon', onClick: onOpen, 'aria-label': t('widget.open', { number: parcel.number }), title: t('card.track', { carrier }) }, svg(ICON_OPEN)),
    h('button', { type: 'button', className: 'pt-icon', onClick: onReceived, 'aria-label': t('widget.markReceived', { number: parcel.number }), title: t('card.markReceived') }, svg(ICON_CHECK)));
}

export function DeliveriesWidget() {
  const [parcels, setParcels] = React.useState(null);
  const [expanded, setExpanded] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [message, setMessage] = React.useState('');
  const inputRef = React.useRef(null);

  const reload = React.useCallback(async () => {
    try {
      setParcels(visibleParcels(await listParcels(host.storage)));
    } catch (err) {
      host.log.warn('parcels: could not read parcels', err);
      setParcels([]);
    }
  }, []);

  React.useEffect(() => {
    void reload();
    const timer = setInterval(() => { void reload(); }, RELOAD_MS);
    const onFocus = () => { void reload(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [reload]);

  React.useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const markReceived = (p) => async () => {
    const current = (await getParcel(host.storage, p.number)) ?? p;
    await saveParcel(host.storage, { ...current, received: true });
    await reload();
  };

  const add = async (ev) => {
    ev.preventDefault();
    const found = parcelFromInput(input);
    if (!found) { setMessage(t('widget.addInvalid')); return; }
    setMessage('');
    const [stored] = await rememberParcels(host.storage, [found], { now: Date.now() });
    if (stored.received) await saveParcel(host.storage, { ...stored, received: false });
    setInput('');
    setAdding(false);
    await reload();
    // The user asked for it: look it up right away.
    try {
      const outcome = await getTracker().track(stored);
      const current = (await getParcel(host.storage, stored.number)) ?? stored;
      await saveParcel(host.storage, applyOutcome({ ...current, received: false }, outcome, Date.now()).parcel);
    } catch (err) {
      host.log.warn('parcels: lookup failed', err);
    }
    await reload();
  };

  const list = parcels ?? [];
  const shown = expanded ? list : list.slice(0, COLLAPSED);
  return h('div', { className: 'pt-root pt-widget' },
    h('style', null, CSS),
    h('section', { 'aria-label': t('widget.title') },
      h('div', { className: 'pt-wtitle' },
        h('span', null, list.length ? `${t('widget.title')} (${list.length})` : t('widget.title'))),
      parcels && !list.length ? h('div', { className: 'pt-empty' }, t('widget.empty')) : null,
      list.length ? h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } },
        shown.map((p) => h(Item, {
          key: p.number, parcel: p,
          onOpen: () => { void host.ui.openExternalUrl(p.trackingUrl); },
          onReceived: markReceived(p),
        }))) : null,
      list.length > COLLAPSED
        ? h('button', { type: 'button', className: 'pt-link', onClick: () => setExpanded(!expanded) },
          expanded ? t('widget.showLess') : t('widget.showAll', { count: list.length }))
        : null,
      adding
        ? h('form', { className: 'pt-form', onSubmit: add },
          h('input', {
            ref: inputRef, className: 'pt-input', value: input, maxLength: 40,
            onChange: (e) => setInput(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Escape') { setAdding(false); setMessage(''); } },
            placeholder: t('widget.addPlaceholder'), 'aria-label': t('widget.addPlaceholder'),
            autoComplete: 'off', spellCheck: false,
          }),
          h('button', { type: 'submit', className: 'pt-btn' }, t('widget.addButton')))
        : h('button', { type: 'button', className: 'pt-link', onClick: () => setAdding(true) }, t('widget.add')),
      message ? h('div', { className: 'pt-error', role: 'alert' }, message) : null));
}
