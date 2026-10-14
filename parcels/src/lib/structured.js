// schema.org ParcelDelivery in a message's HTML: JSON-LD
// (<script type="application/ld+json">) and microdata (itemtype=".../ParcelDelivery").
// Shops that send these mark up the tracking number and carrier
// themselves, so no guessing is needed.

const MAX_HTML = 2_000_000;

const decodeEntities = (s) => s
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

const isType = (node, type) => {
  const t = node?.['@type'];
  const match = (v) => typeof v === 'string' && v.replace(/^https?:\/\/schema\.org\//, '') === type;
  return Array.isArray(t) ? t.some(match) : match(t);
};

const nameOf = (v) => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return typeof v.name === 'string' ? v.name : (typeof v.legalName === 'string' ? v.legalName : '');
  return '';
};

const cleanNumber = (v) => (typeof v === 'string' || typeof v === 'number')
  ? String(v).replace(/\s+/g, '').toUpperCase()
  : '';

const httpUrl = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : '');

function collectJsonLd(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLd(item, out, depth + 1);
    return;
  }
  if (isType(node, 'ParcelDelivery') || (node.trackingNumber && (node.carrier || node.provider || node.trackingUrl))) {
    const number = cleanNumber(node.trackingNumber);
    if (number) {
      out.push({
        number,
        carrierName: nameOf(node.carrier) || nameOf(node.provider),
        trackingUrl: httpUrl(node.trackingUrl),
      });
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectJsonLd(value, out, depth + 1);
  }
}

function fromJsonLd(html, out) {
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, ''));
    } catch {
      try { data = JSON.parse(decodeEntities(m[1].trim())); } catch { continue; }
    }
    collectJsonLd(data, out);
  }
}

/** The value of an element carrying `itemprop="<prop>"`: its content/href attribute or its text. */
function itemprops(fragment, prop) {
  const values = [];
  const re = new RegExp(`<([a-z0-9]+)\\b([^>]*\\bitemprop\\s*=\\s*["']?${prop}["']?[^>]*)>([^<]*)`, 'gi');
  let m;
  while ((m = re.exec(fragment))) {
    const attrs = m[2];
    const attr = /\b(?:content|href)\s*=\s*"([^"]*)"|\b(?:content|href)\s*=\s*'([^']*)'/i.exec(attrs);
    const raw = attr ? (attr[1] ?? attr[2]) : m[3];
    values.push(decodeEntities(raw).trim());
  }
  return values;
}

function fromMicrodata(html, out) {
  const re = /itemtype\s*=\s*["']?https?:\/\/schema\.org\/ParcelDelivery["']?/gi;
  let m;
  while ((m = re.exec(html))) {
    // The ParcelDelivery's own properties follow its itemtype attribute,
    // up to the next ParcelDelivery (or a sane length).
    const rest = html.slice(m.index);
    const next = rest.slice(1).search(/itemtype\s*=\s*["']?https?:\/\/schema\.org\/ParcelDelivery/i);
    const fragment = rest.slice(0, next < 0 ? 20_000 : next + 1);
    const numbers = itemprops(fragment, 'trackingNumber').map(cleanNumber).filter(Boolean);
    if (!numbers.length) continue;
    let carrierName = '';
    const carrierAt = fragment.search(/itemprop\s*=\s*["']?(?:carrier|provider)["']?/i);
    if (carrierAt >= 0) {
      const tail = fragment.slice(carrierAt);
      const direct = /itemprop\s*=\s*["']?(?:carrier|provider)["']?[^>]*\bcontent\s*=\s*["']([^"']+)["']/i.exec(tail);
      carrierName = direct ? decodeEntities(direct[1]) : (itemprops(tail, 'name')[0] ?? '');
    }
    const trackingUrl = httpUrl(itemprops(fragment, 'trackingUrl')[0]);
    for (const number of numbers) out.push({ number, carrierName, trackingUrl });
  }
}

/**
 * Tracking numbers a message's HTML declares with schema.org, as
 * [{ number, carrierName, trackingUrl }], without duplicates.
 */
export function structuredParcels(html) {
  if (typeof html !== 'string' || !html) return [];
  const doc = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;
  const out = [];
  if (/application\/ld\+json/i.test(doc)) fromJsonLd(doc, out);
  if (/schema\.org\/ParcelDelivery/i.test(doc)) fromMicrodata(doc, out);
  const seen = new Set();
  return out.filter((p) => p.number.length >= 6 && p.number.length <= 40 && /^[0-9A-Z-]+$/.test(p.number)
    && !seen.has(p.number) && seen.add(p.number));
}

/**
 * The HTML part of a message from the plugin view's `source` (the "View
 * source" text: headers, metadata, then the bodies). Empty when the message
 * has no HTML body.
 */
export function htmlFromSource(source) {
  if (typeof source !== 'string') return '';
  const marker = '--- HTML Version ---';
  const at = source.indexOf(marker);
  return at < 0 ? '' : source.slice(at + marker.length);
}
