// Finds tracking numbers in a message.
//
// Each carrier module lists its number formats with a strength:
// - strong: specific enough (prefix plus check digit, or a distinctive
//   shape) to count wherever it appears;
// - medium: counts when the carrier is named anywhere in the message, or a
//   tracking word is right next to it;
// - weak: plain digit runs (10-15 digits) that look like order, customer or
//   phone numbers just as well. They count only when the carrier is named
//   AND a tracking word comes before the number, and never when the label
//   says order, invoice, phone, IBAN and the like.
// A check digit, where the carrier defines one, must always fit.

import { CARRIERS, carrierById, carrierByName } from './carriers/index.js';
import { structuredParcels, htmlFromSource } from './structured.js';

const TRACKING_WORDS = /track|sendung|paket|parcel|package|shipment|shipping|shipped|dispatch|versand|verfolg|lieferung|zustellung|delivery|colis|suivi|livraison|env[ií]o|seguimiento|entrega|spedizion|pacco|tracciamento|consegna|zending|pakket|bezorg|przesy[lł]k|z[aá]silk|waybill|\bawb\b|consignment|barcode/i;

const NEGATIVE_WORDS = /order|bestell|auftrag|invoice|rechnung|customer|kunden|phone|telefon|hotline|\btel\b|\bfax\b|mobil|handy|iban|\bbic\b|konto|account|referen|\bref\b|\bvat\b|\bust\b|steuer|\btax\b|\bzip\b|\bplz\b|postcode|postleitzahl|\bsku\b|article|artikel|ticket|voucher|gutschein|coupon|\bpin\b|\btan\b|commande|pedido|ordine|bestelling|factur|fattura|contract|vertrag|policy|police|mitglied|member|\bbank|card\b|karte|serial|seriennummer|imei|meeting|konferenz|zoom|webex|passcode|kennwort/i;

const RANK = { strong: 3, medium: 2, weak: 1 };
const MAX_RESULTS = 10;

function lastMatchIndex(re, text) {
  const g = new RegExp(re.source, 'gi');
  let last = -1;
  let m;
  while ((m = g.exec(text))) {
    last = m.index;
    if (m[0].length === 0) g.lastIndex++;
  }
  return last;
}

/** The label right before a number: from the last line or sentence break. */
function labelBefore(before) {
  const cut = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('. '), before.lastIndexOf('|'),
    before.lastIndexOf(';'), before.lastIndexOf('•'));
  return before.slice(cut + 1).slice(-60);
}

function judge(candidate, haystack, wholeMessage) {
  const { carrier, strength, index, end } = candidate;
  if (strength === 'strong') return { ok: true, distance: 0 };

  const before = haystack.slice(Math.max(0, index - 100), index);
  const after = haystack.slice(end, end + 40).split('\n')[0];
  // Part of a longer compound: a phone number, a date, an order id with dashes.
  if (/[+#]\s?$/.test(before) || /\d[-/.,]$/.test(before) || /^[-/.,]\d/.test(after)) return { ok: false };

  const label = labelBefore(before);
  const labelTracking = TRACKING_WORDS.test(label);
  const labelNegative = NEGATIVE_WORDS.test(label);
  if (labelNegative && !labelTracking) return { ok: false };

  const trackingAt = lastMatchIndex(TRACKING_WORDS, before);
  const negativeAt = lastMatchIndex(NEGATIVE_WORDS, before);
  if (!labelTracking && negativeAt >= 0 && negativeAt > trackingAt) return { ok: false };
  const trackingBefore = labelTracking || trackingAt >= 0;
  const nearTracking = trackingBefore || TRACKING_WORDS.test(after);

  const carrierAt = lastMatchIndex(carrier.keywords, before);
  const nearby = carrierAt >= 0 || carrier.keywords.test(after);
  const anywhere = nearby || carrier.keywords.test(wholeMessage);
  const distance = carrierAt >= 0 ? before.length - carrierAt : (nearby ? 50 : 1000);

  if (strength === 'medium') return { ok: anywhere || nearTracking, distance };
  // A weak number must be labelled: the tracking word comes before it.
  return { ok: anywhere && trackingBefore, distance };
}

function textCandidates(haystack) {
  const out = [];
  CARRIERS.forEach((carrier, order) => {
    for (const format of carrier.formats) {
      const re = new RegExp(format.re.source, format.re.flags.includes('g') ? format.re.flags : `${format.re.flags}g`);
      let m;
      while ((m = re.exec(haystack))) {
        const number = format.normalize ? format.normalize(m[0]) : m[0];
        if (format.check && !format.check(number)) continue;
        out.push({ carrier, number, strength: format.strength, index: m.index, end: m.index + m[0].length, order });
      }
    }
  });
  return out;
}

/** Carrier of a number someone else vouched for (schema.org data, the user). */
export function identifyNumber(number, { minStrength = 'weak' } = {}) {
  const n = String(number || '').replace(/\s+/g, '').toUpperCase();
  let best = null;
  CARRIERS.forEach((carrier, order) => {
    for (const format of carrier.formats) {
      const re = new RegExp(`^(?:${format.re.source.replace(/\\b/g, '')})$`);
      if (RANK[format.strength] < RANK[minStrength] || !re.test(n)) continue;
      const number = format.normalize ? format.normalize(n) : n;
      if (format.check && !format.check(number)) continue;
      const score = RANK[format.strength] * 100 - order;
      if (!best || score > best.score) best = { carrier, number, score };
    }
  });
  return best ? { carrier: best.carrier, number: best.number } : null;
}

function describe(carrier, number, extra = {}) {
  return {
    number,
    carrier: carrier ? carrier.id : 'other',
    carrierName: carrier ? carrier.name : (extra.carrierName || ''),
    trackingUrl: extra.trackingUrl || (carrier ? carrier.trackingUrl(number) : `https://t.17track.net/en#nums=${encodeURIComponent(number)}`),
    source: extra.source || 'text',
  };
}

/**
 * Tracking numbers in a message. `message` is the plugin's EmailReadView
 * (subject, from, text, source) or any object with those fields; `html` may
 * be passed directly instead of `source`.
 *
 * Returns [{ number, carrier, carrierName, trackingUrl, source }], at most 10.
 */
export function detectParcels(message) {
  const subject = typeof message?.subject === 'string' ? message.subject : '';
  const text = typeof message?.text === 'string' ? message.text : '';
  const html = typeof message?.html === 'string' ? message.html : htmlFromSource(message?.source);
  const sender = (Array.isArray(message?.from) ? message.from : [])
    .map((a) => `${a?.name ?? ''} ${a?.email ?? ''}`).join(' ');

  const results = [];
  const seen = new Set();
  const push = (entry) => {
    if (seen.has(entry.number) || results.length >= MAX_RESULTS) return;
    seen.add(entry.number);
    results.push(entry);
  };

  for (const s of structuredParcels(html)) {
    const known = identifyNumber(s.number);
    const carrier = carrierByName(s.carrierName) ?? known?.carrier ?? null;
    push(describe(carrier, known && known.carrier === carrier ? known.number : s.number, {
      carrierName: s.carrierName, trackingUrl: s.trackingUrl, source: 'schema',
    }));
  }

  const haystack = `${subject}\n${text}`;
  const wholeMessage = `${sender}\n${haystack}`;
  const accepted = [];
  for (const c of textCandidates(haystack)) {
    const verdict = judge(c, haystack, wholeMessage);
    if (verdict.ok) accepted.push({ ...c, distance: verdict.distance });
  }
  // One carrier per number: the strongest format, then the carrier named
  // closest to it, then the module order.
  accepted.sort((a, b) => (RANK[b.strength] - RANK[a.strength]) || (a.distance - b.distance) || (a.order - b.order) || (a.index - b.index));
  const chosen = new Map();
  for (const c of accepted) if (!chosen.has(c.number)) chosen.set(c.number, c);
  [...chosen.values()]
    .sort((a, b) => a.index - b.index)
    .forEach((c) => push(describe(c.carrier, c.number)));
  return results;
}

/** For a number the user typed: the carrier when we know the format, else 'other'. */
export function parcelFromInput(input) {
  const n = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[0-9A-Z-]{6,40}$/.test(n)) return null;
  // Bare digit runs fit several carriers; without a message around them we
  // can't tell which, so those stay "other" and 17TRACK works it out.
  const known = identifyNumber(n, { minStrength: 'medium' });
  return describe(known?.carrier ?? null, known?.number ?? n, { source: 'manual' });
}

export { carrierById };
