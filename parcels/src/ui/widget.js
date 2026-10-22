// Deliveries (sidebar-section slot): the parcels on their way, one row each
// like a folder row. The host draws the section header ("Deliveries", set
// with api.ui.setSectionTitle). A row opens the parcel in a dialog (status,
// Track, Mark received); the last row adds a tracking number by hand.

import * as React from 'react';
import host from '@plugin-host';
import { SidebarEmpty, SidebarRow, Stack } from '@plugin-host/ui';
import { applyOutcome, getParcel, listParcels, saveParcel, visibleParcels } from '../lib/parcels.js';
import { createTracker } from '../lib/tracking.js';
import { getBackground } from '../lib/runtime.js';
import { carrierLabel, shortNumber, shortStatus, shownStatus, statusIcon, statusLabel } from '../lib/view.js';

const h = React.createElement;
const t = (key, vars) => host.i18n.t(key, vars);
const RELOAD_MS = 15_000;
const COLLAPSED = 5;
const DIALOG_WIDTH = 440;
let tracker = null;
const getTracker = () => (tracker ??= createTracker(host));

/** Title of the parcel's dialog and label of its row. */
export function parcelName(parcel) {
  return parcel.subject || `${carrierLabel(t, parcel)} ${parcel.number}`;
}

/** Row labels; parcels from the same mail share a subject, so those get the carrier in front. */
export function rowLabels(parcels) {
  const count = new Map();
  for (const p of parcels) if (p.subject) count.set(p.subject, (count.get(p.subject) ?? 0) + 1);
  return parcels.map((p) => (p.subject && count.get(p.subject) > 1 ? `${carrierLabel(t, p)} · ${p.subject}` : parcelName(p)));
}

function Item({ parcel, label, onOpen }) {
  const carrier = carrierLabel(t, parcel);
  const status = shownStatus(parcel);
  const tooltip = [parcel.subject, `${carrier} ${shortNumber(parcel.number)}`, status ? statusLabel(t, status) : ''].filter(Boolean).join('\n');
  // The wrapper only carries data for the e2e tests; it has no styling.
  return h('div', { 'data-parcel': parcel.number, 'data-status': status || '' },
    h(SidebarRow, { icon: statusIcon(parcel), label, detail: shortStatus(t, parcel), title: tooltip, onClick: onOpen }));
}

export function DeliveriesWidget() {
  const [parcels, setParcels] = React.useState(null);
  const [expanded, setExpanded] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      setParcels(visibleParcels(await listParcels(host.storage)));
    } catch (err) {
      host.log.warn('parcels: could not read parcels', err);
      setParcels([]);
    }
  }, []);

  const refreshAll = React.useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      if (manual) await getBackground(host).refresh();
      else await getBackground(host).visit();
    } catch (err) {
      host.log.warn('parcels: could not refresh deliveries', err);
    } finally {
      await reload();
      if (manual) setRefreshing(false);
    }
  }, [reload]);

  React.useEffect(() => {
    void reload();
    void refreshAll(); // One check when entering webmail (five-minute floor).
    const timer = setInterval(() => { void reload(); }, RELOAD_MS);
    const onFocus = () => { void refreshAll(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [reload, refreshAll]);

  const openParcel = (p) => async () => {
    try {
      await host.ui.openDialog({ title: parcelName(p), slot: 'plugin-dialog', extraProps: { mode: 'parcel', number: p.number }, width: DIALOG_WIDTH });
    } catch (err) {
      host.log.warn('parcels: could not open the parcel', err);
    }
    await reload();
  };

  const add = async () => {
    let result = null;
    try {
      result = await host.ui.openDialog({ title: t('widget.add'), slot: 'plugin-dialog', extraProps: { mode: 'add' }, width: DIALOG_WIDTH });
    } catch (err) {
      host.log.warn('parcels: could not open the add dialog', err);
    }
    await reload();
    const number = result && typeof result.added === 'string' ? result.added : null;
    if (!number) return;
    // The user asked for it: look it up right away.
    try {
      const stored = await getParcel(host.storage, number);
      if (!stored) return;
      const outcome = await getTracker().track(stored);
      const current = (await getParcel(host.storage, number)) ?? stored;
      await saveParcel(host.storage, applyOutcome({ ...current, received: false }, outcome, Date.now()).parcel);
    } catch (err) {
      host.log.warn('parcels: lookup failed', err);
    }
    await reload();
  };

  if (!parcels) return null;
  const shown = expanded ? parcels : parcels.slice(0, COLLAPSED);
  const labels = rowLabels(shown);
  const lastCheck = Math.max(0, ...parcels.map((p) => p.lastPolledAt || 0));
  const lastTime = lastCheck ? new Date(lastCheck).toLocaleTimeString(host.i18n.getLocale(), { hour: 'numeric', minute: '2-digit' }) : '';
  const refreshLabel = refreshing ? t('card.refreshing') : t('card.refresh');
  // Stack: the kit's reset reaches the rows' buttons only inside a kit element.
  return h(Stack, { gap: 0 },
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
      padding: '0 12px 4px', color: 'inherit' } },
      lastTime ? h('span', { style: { fontSize: 11, opacity: 0.6 }, title: lastTime }, lastTime) : null,
      h('button', {
        type: 'button', title: refreshLabel, 'aria-label': refreshLabel, 'aria-busy': refreshing,
        disabled: refreshing, onClick: () => { void refreshAll(true); },
        style: { display: 'inline-flex', justifyContent: 'center', alignItems: 'center',
          width: 28, height: 26, border: 'none', background: 'transparent',
          borderRadius: 5, color: 'inherit', opacity: refreshing ? 0.5 : 0.8,
          cursor: refreshing ? 'wait' : 'pointer' },
      }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true },
        h('path', { d: 'M20 11a8 8 0 0 0-14.6-4.6L3 9' }),
        h('path', { d: 'M3 4v5h5' }),
        h('path', { d: 'M4 13a8 8 0 0 0 14.6 4.6L21 15' }),
        h('path', { d: 'M21 20v-5h-5' }))),
    ),
    parcels.length ? null : h(SidebarEmpty, null, t('widget.empty')),
    shown.map((p, i) => h(Item, { key: p.number, parcel: p, label: labels[i], onOpen: openParcel(p) })),
    parcels.length > COLLAPSED
      ? h(SidebarRow, {
        icon: 'dots',
        label: expanded ? t('widget.showLess') : t('widget.showAll', { count: parcels.length }),
        onClick: () => setExpanded(!expanded),
      })
      : null,
    h(SidebarRow, { icon: 'plus', label: t('widget.add'), onClick: () => { void add(); } }));
}
