// What the plugin does without a window of its own: pick up tracking
// numbers from new mail, poll the followed parcels and notify on changes.

import { detectParcels } from './detect.js';
import { CARRIERS } from './carriers/index.js';
import { pollDue, rememberParcels } from './parcels.js';
import { createTracker } from './tracking.js';
import { notificationFor } from './view.js';

const HINT_WORDS = /track|sendung|paket|parcel|package|shipment|shipped|versand|lieferung|delivery|colis|envío|envio|spedizion|zending|verzonden|przesyłk|zásilk|\b1Z[0-9A-Z]{6}|\bJJD\d|\b00340\d/i;

/**
 * Cheap test on a new message's summary (subject, preview, sender) before
 * reading its whole text: only shipping-like mail is opened.
 */
export function mightContainParcel(summary) {
  const from = (summary?.from ?? []).map((a) => `${a?.name ?? ''} ${a?.email ?? ''}`).join(' ');
  const text = `${summary?.subject ?? ''}\n${summary?.preview ?? ''}\n${from}`;
  return HINT_WORDS.test(text) || CARRIERS.some((c) => c.id !== 'post' && c.keywords.test(text));
}

export function createBackground(api, { tracker = createTracker(api), now = () => Date.now() } = {}) {
  let backoffUntil = 0;
  let running = false;

  const setting = (key, fallback) => {
    const v = api.plugin?.settings?.[key];
    return typeof v === 'boolean' ? v : fallback;
  };

  async function notifyChange(parcel) {
    if (!setting('notify', true)) return;
    try {
      await api.notifications.show(notificationFor(api.i18n.t.bind(api.i18n), parcel));
    } catch (err) {
      api.log?.warn?.('parcels: notification failed', err);
    }
  }

  /** One polling round; skipped while another runs or a service asked us to wait. */
  async function tick() {
    if (running || now() < backoffUntil) return null;
    running = true;
    try {
      const result = await pollDue(api.storage, tracker, { now: now(), onChange: notifyChange });
      if (result.retryAfter) backoffUntil = now() + result.retryAfter * 1000;
      return result;
    } catch (err) {
      api.log?.warn?.('parcels: polling failed', err);
      return null;
    } finally {
      running = false;
    }
  }

  /** onNewEmailReceived: follow the parcels a new shipping mail mentions. */
  async function onNewEmail(summary) {
    if (!setting('trackNewMail', true) || !summary?.id || !mightContainParcel(summary)) return [];
    let mail;
    try {
      mail = await api.email.get(summary.id);
    } catch {
      return [];
    }
    if (!mail) return [];
    const found = detectParcels(mail);
    if (!found.length) return [];
    return rememberParcels(api.storage, found, { emailId: mail.id, subject: mail.subject, now: now() });
  }

  return { tick, onNewEmail, notifyChange };
}

/** email-banner shouldShow: only messages with a tracking number get a card. */
export function bannerShouldShow(context) {
  const email = context?.email;
  if (!email) return false;
  try {
    return detectParcels(email).length > 0;
  } catch {
    return false;
  }
}
