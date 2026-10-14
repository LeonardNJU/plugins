// Reader card (email-banner slot): one info bar per parcel the message
// mentions, like the reader's own bars (external content, invitations):
// carrier as the small caps label, the status as the line, the latest scan
// below, then Track, Refresh and Mark received.

import * as React from 'react';
import host from '@plugin-host';
import { BarButton, InfoBar, Row, Text } from '@plugin-host/ui';
import { detectParcels } from '../lib/detect.js';
import { applyOutcome, getParcel, rememberParcels, saveParcel, CARD_REFRESH_MS, MANUAL_REFRESH_MS } from '../lib/parcels.js';
import { createTracker } from '../lib/tracking.js';
import { carrierLabel, errorText, eventLine, formatDate, shownStatus, statusBarTone, statusIcon, statusLabel } from '../lib/view.js';

const h = React.createElement;
let tracker = null;
const getTracker = () => (tracker ??= createTracker(host));

const t = (key, vars) => host.i18n.t(key, vars);

function ParcelBar({ parcel, busy, onRefresh, onReceived, onOpen }) {
  const locale = host.i18n.getLocale();
  const status = shownStatus(parcel);
  const detail = eventLine(parcel, locale);
  const eta = parcel.eta && status !== 'delivered' ? formatDate(parcel.eta.to || parcel.eta.from, locale) : '';
  const carrier = carrierLabel(t, parcel);
  // The status is the line; until there is one, the number is.
  const title = status ? h('span', { 'data-status': status }, statusLabel(t, status)) : parcel.number;
  const numberLine = [status ? parcel.number : '', eta ? t('card.eta', { date: eta }) : ''].filter(Boolean).join(' · ');
  // A plain wrapper for the e2e tests and to tell the bars apart; no styling.
  return h('div', { 'data-parcel': parcel.number },
    h(InfoBar, { tone: statusBarTone(parcel), icon: statusIcon(parcel), eyebrow: carrier, title },
      detail ? h(Text, { tone: 'muted' }, detail) : null,
      numberLine ? h(Text, { tone: 'muted' }, numberLine) : null,
      parcel.stopped ? h(Text, { tone: 'muted' }, t('widget.stopped')) : null,
      parcel.error ? h('div', { role: 'status' }, h(Text, { tone: 'danger' }, errorText(t, parcel.error))) : null,
      h(Row, { gap: 2 },
        h(BarButton, { icon: 'external-link', onClick: onOpen }, t('card.track', { carrier })),
        h(BarButton, { icon: 'refresh', onClick: onRefresh, busy }, busy ? t('card.refreshing') : (status ? t('card.refresh') : t('card.lookup'))),
        parcel.received
          // Pressed while received; pressing it again follows the parcel again.
          ? h(BarButton, { icon: 'check', active: true, onClick: () => onReceived(false) }, t('card.received'))
          : h(BarButton, { icon: 'check', onClick: () => onReceived(true) }, t('card.markReceived')))));
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

  return h(React.Fragment, null,
    parcels.map((p) => h(ParcelBar, {
      key: p.number, parcel: p, busy: !!busy[p.number],
      onRefresh: onRefresh(p), onReceived: onReceived(p), onOpen: onOpen(p),
    })));
}
