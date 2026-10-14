// Reader card (email-banner slot): the parcels a message mentions, with
// carrier, number, live status and a link to the carrier's tracking page.

import * as React from 'react';
import host from '@plugin-host';
import { detectParcels } from '../lib/detect.js';
import { applyOutcome, getParcel, rememberParcels, saveParcel, CARD_REFRESH_MS, MANUAL_REFRESH_MS } from '../lib/parcels.js';
import { createTracker } from '../lib/tracking.js';
import { statusTone } from '../lib/status.js';
import { carrierLabel, errorText, eventLine, formatDate, statusLabel } from '../lib/view.js';
import { CSS } from './styles.js';

const h = React.createElement;
let tracker = null;
const getTracker = () => (tracker ??= createTracker(host));

const t = (key, vars) => host.i18n.t(key, vars);

function ParcelRow({ parcel, busy, onRefresh, onReceived, onOpen }) {
  const locale = host.i18n.getLocale();
  const status = parcel.status;
  const detail = eventLine(parcel, locale);
  const eta = parcel.eta && status !== 'delivered' ? formatDate(parcel.eta.to || parcel.eta.from, locale) : '';
  const carrier = carrierLabel(t, parcel);
  return h('div', { className: 'pt-row', 'data-parcel': parcel.number },
    h('div', { className: 'pt-main' },
      h('div', { className: 'pt-head' },
        h('span', { className: 'pt-carrier' }, carrier),
        h('span', { className: 'pt-number', 'aria-label': t('card.number', { number: parcel.number }) }, parcel.number)),
      status
        ? h('div', { className: 'pt-status', 'data-status': status },
          h('span', { className: 'pt-dot', style: { background: statusTone(status) }, 'aria-hidden': true }),
          statusLabel(t, status))
        : null,
      detail ? h('div', { className: 'pt-detail' }, detail) : null,
      eta ? h('div', { className: 'pt-detail' }, t('card.eta', { date: eta })) : null,
      parcel.stopped ? h('div', { className: 'pt-detail' }, t('widget.stopped')) : null,
      parcel.error ? h('div', { className: 'pt-error', role: 'status' }, errorText(t, parcel.error)) : null),
    h('div', { className: 'pt-actions' },
      h('button', { type: 'button', className: 'pt-btn pt-btn-primary', onClick: onOpen }, t('card.track', { carrier })),
      h('button', { type: 'button', className: 'pt-btn', onClick: onRefresh, disabled: busy, 'aria-busy': busy || undefined },
        busy ? t('card.refreshing') : (status ? t('card.refresh') : t('card.lookup'))),
      parcel.received
        ? h(React.Fragment, null,
          h('span', { className: 'pt-done' }, t('card.received')),
          h('button', { type: 'button', className: 'pt-btn', onClick: () => onReceived(false) }, t('card.followAgain')))
        : h('button', { type: 'button', className: 'pt-btn', onClick: () => onReceived(true) }, t('card.markReceived'))));
}

export function ParcelCard(props) {
  const email = props?.email ?? null;
  const found = React.useMemo(() => (email ? detectParcels(email) : []), [email?.id, email?.text, email?.source]);
  const [parcels, setParcels] = React.useState([]);
  const [busy, setBusy] = React.useState({});
  const lastManual = React.useRef({});

  const store = React.useCallback((p) => {
    setParcels((list) => list.map((x) => (x.number === p.number ? p : x)));
  }, []);

  const refresh = React.useCallback(async (p) => {
    setBusy((b) => ({ ...b, [p.number]: true }));
    try {
      const outcome = await getTracker().track(p);
      const current = (await getParcel(host.storage, p.number)) ?? p;
      const { parcel } = applyOutcome(current, outcome, Date.now());
      await saveParcel(host.storage, parcel);
      store(parcel);
    } catch (err) {
      host.log.warn('parcels: lookup failed', err);
    } finally {
      setBusy((b) => ({ ...b, [p.number]: false }));
    }
  }, [store]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!found.length) { setParcels([]); return; }
      const stored = await rememberParcels(host.storage, found, { emailId: email?.id ?? null, subject: email?.subject ?? '', now: Date.now() });
      if (cancelled) return;
      setParcels(stored);
      const auto = host.plugin.settings?.autoLookup !== false;
      if (!auto) return;
      const now = Date.now();
      for (const p of stored) {
        if (p.received || p.stopped || p.status === 'delivered') continue;
        if (!p.lastPolledAt || now - p.lastPolledAt > CARD_REFRESH_MS) void refresh(p);
      }
    })().catch((err) => host.log.warn('parcels: could not load parcels', err));
    return () => { cancelled = true; };
  }, [found, refresh]);

  if (!parcels.length) return null;

  const onRefresh = (p) => () => {
    const now = Date.now();
    if (now - (lastManual.current[p.number] ?? 0) < MANUAL_REFRESH_MS) return;
    lastManual.current[p.number] = now;
    void refresh(p);
  };
  const onReceived = (p) => async (received) => {
    const current = (await getParcel(host.storage, p.number)) ?? p;
    const next = { ...current, received };
    await saveParcel(host.storage, next);
    store(next);
  };
  const onOpen = (p) => () => { void host.ui.openExternalUrl(p.trackingUrl); };

  return h('div', { className: 'pt-root' },
    h('style', null, CSS),
    h('section', { className: 'pt-card', 'aria-label': t('card.title') },
      parcels.map((p) => h(ParcelRow, {
        key: p.number, parcel: p, busy: !!busy[p.number],
        onRefresh: onRefresh(p), onReceived: onReceived(p), onOpen: onOpen(p),
      }))));
}
