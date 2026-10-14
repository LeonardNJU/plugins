// Text the UI and the notifications show, built from a parcel. `t` is
// api.i18n.t.

import { STATUSES } from './status.js';

const ERROR_CODES = new Set([
  'not_configured', 'auth', 'rate_limit', 'quota', 'timeout', 'unreachable', 'blocked', 'unknown_number', 'service',
]);

export function statusLabel(t, status) {
  return t(`status.${STATUSES.includes(status) ? status : 'pending'}`);
}

export function errorText(t, code) {
  return t(`error.${ERROR_CODES.has(code) ? code : 'service'}`);
}

/** The status a parcel shows: none while an error is all there is. */
export function shownStatus(parcel) {
  return parcel.error && !parcel.status ? null : (parcel.status || null);
}

/** A few words for the sidebar row, next to the parcel's name. */
export function shortStatus(t, parcel) {
  if (parcel.stopped) return t('short.stopped');
  const status = shownStatus(parcel);
  if (!status && parcel.error) return t('short.error');
  return t(`short.${STATUSES.includes(status) ? status : 'pending'}`);
}

const ICONS = {
  pending: 'package', info_received: 'package', in_transit: 'truck', out_for_delivery: 'truck-delivery',
  available_for_pickup: 'building-store', delivered: 'circle-check', failed: 'alert-triangle',
  exception: 'alert-triangle', expired: 'clock', not_found: 'help-circle', unknown: 'help-circle',
};

/** App icon name (UI kit Icon) for a parcel's state. */
export function statusIcon(parcel) {
  const status = shownStatus(parcel);
  if (!status && parcel.error) return 'alert-triangle';
  return ICONS[status] ?? 'package';
}

/** Tone of the reader's info bar (UI kit InfoBar) for a parcel's state. */
export function statusBarTone(parcel) {
  const status = shownStatus(parcel);
  if (!status) return parcel.error ? 'warning' : 'neutral';
  switch (status) {
    case 'delivered': return 'success';
    case 'out_for_delivery':
    case 'available_for_pickup': return 'primary';
    case 'failed':
    case 'exception': return 'danger';
    case 'info_received':
    case 'in_transit': return 'info';
    default: return 'neutral';
  }
}

export function carrierLabel(t, parcel) {
  return parcel.carrierName || t('carrier.other');
}

/** "0034…2557" for long numbers, the number itself for short ones. */
export function shortNumber(number) {
  const n = String(number || '');
  return n.length > 14 ? `${n.slice(0, 4)}…${n.slice(-4)}` : n;
}

/** A tracking-service time ("2026-10-12T07:55:00+02:00") in the user's language. */
export function formatTime(value, locale) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function formatDate(value, locale) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale || 'en', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "The shipment has been picked up · Bonn, DE · 10 Oct 2026, 18:40" */
export function eventLine(parcel, locale) {
  return [parcel.text, parcel.location, formatTime(parcel.time, locale)].filter(Boolean).join(' · ');
}

const oneLine = (s, max) => {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** The notification for a status change (title ≤ 120, body ≤ 300, one line each). */
export function notificationFor(t, parcel) {
  const title = oneLine(t('notify.title', { status: statusLabel(t, parcel.status) }), 120);
  const what = `${carrierLabel(t, parcel)} ${parcel.number}`;
  const body = oneLine([what, parcel.subject, parcel.text].filter(Boolean).join(' · '), 300);
  const tag = `parcel-${String(parcel.number).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 50)}`;
  return { title, body, tag };
}
