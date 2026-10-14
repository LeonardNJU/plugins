// Suggest Paperless metadata for a message from its sender and subject:
// what the user picked for this sender before, else a correspondent whose
// name or match pattern fits the sender, and a document type and tags named
// in the subject or file name.

const SYNONYMS = {
  invoice: ['invoice', 'rechnung', 'facture', 'factura', 'fattura', 'faktura', 'factuur', 'fatura', 'bill'],
  receipt: ['receipt', 'quittung', 'beleg', 'kassenbon', 'reçu', 'recibo', 'ricevuta', 'kvittering', 'bon'],
  contract: ['contract', 'vertrag', 'contrat', 'contrato', 'contratto', 'kontrakt', 'overeenkomst', 'umowa'],
  letter: ['letter', 'brief', 'schreiben', 'lettre', 'carta', 'lettera'],
  tax: ['tax', 'steuer', 'steuerbescheid', 'impôt', 'impuesto', 'tasse'],
};

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim();
}

function words(text) {
  return normalize(text).split(/[\s.@]+/).filter((w) => w.length >= 3);
}

const GENERIC = new Set(['www', 'mail', 'email', 'noreply', 'reply', 'info', 'service', 'billing', 'invoice', 'support',
  'com', 'org', 'net', 'gmbh', 'inc', 'ltd', 'llc', 'the', 'and', 'news', 'newsletter', 'team', 'online', 'kunden', 'rechnung']);

/** The domain of an address, lower case, or ''. */
export function domainOf(email) {
  const m = /@([^@\s>]+)$/.exec(String(email || '').trim().toLowerCase());
  return m ? m[1] : '';
}

/** Keys under which a choice for this sender is remembered: the address, then the domain. */
export function senderKeys(email) {
  const address = String(email || '').trim().toLowerCase();
  const domain = domainOf(address);
  return [address, domain ? `@${domain}` : ''].filter(Boolean);
}

/** Does a Paperless match pattern (any/all/literal/regex/fuzzy) name this sender? */
function matchFits(entry, sender) {
  const pattern = (entry.match || '').trim();
  if (!pattern) return false;
  const hay = `${sender.name || ''} ${sender.email || ''}`.toLowerCase();
  switch (entry.matchingAlgorithm) {
    case 1: // any word
      return pattern.toLowerCase().split(/\s+/).some((w) => w.length >= 3 && hay.includes(w));
    case 2: // all words
      return pattern.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
    case 3: // literal
    case 5: // fuzzy, treated as literal
      return hay.includes(pattern.toLowerCase());
    case 4:
      try { return new RegExp(pattern, 'i').test(hay); } catch { return false; }
    default:
      return false;
  }
}

/**
 * Score a correspondent against the sender. 0 means no fit.
 * @param {{ name: string, match?: string, matchingAlgorithm?: number }} entry
 * @param {{ name?: string, email?: string }} sender
 */
export function correspondentScore(entry, sender) {
  const cName = normalize(entry.name);
  if (!cName) return 0;
  const sName = normalize(sender.name);
  const email = String(sender.email || '').toLowerCase();
  if (sName && sName === cName) return 100;
  if (email && cName === email) return 100;
  if (matchFits(entry, sender)) return 90;
  if (sName.length >= 3 && cName.length >= 3 && (sName.includes(cName) || cName.includes(sName))) return 80;
  // billing@acme-hosting.com fits "ACME Hosting"
  const domain = domainOf(email);
  if (domain) {
    const host = domain.split('.').slice(0, -1).join(' ');
    const domainWords = words(host).filter((w) => !GENERIC.has(w));
    const nameWords = words(entry.name).filter((w) => !GENERIC.has(w));
    if (domainWords.length && nameWords.length) {
      const joinedHost = normalize(host).replace(/[\s.]+/g, '');
      const joinedName = nameWords.join('');
      if (joinedHost === joinedName || joinedHost.includes(joinedName)) return 75;
      if (nameWords.some((w) => domainWords.includes(w))) return 60;
    }
  }
  return 0;
}

export function bestCorrespondent(correspondents, sender) {
  let best = null;
  let bestScore = 0;
  for (const c of correspondents || []) {
    const score = correspondentScore(c, sender);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return bestScore >= 60 ? best : null;
}

function mentions(text, name) {
  const needle = normalize(name);
  if (needle.length < 3) return false;
  const hay = normalize(text);
  if (` ${hay} `.includes(` ${needle} `)) return true;
  // "Stromrechnung" mentions "Rechnung", and "Rechnung" mentions "Invoice".
  const hayWords = hay.split(/[^a-z0-9]+/).filter(Boolean);
  const group = Object.values(SYNONYMS).find((list) => list.map(normalize).includes(needle)) || [needle];
  return group.map(normalize).some((w) => hayWords.some((h) => h === w || (w.length >= 5 && h.endsWith(w))));
}

/** Document type named in the text (subject, file name), synonyms included. */
export function bestDocumentType(types, text) {
  return (types || []).find((t) => mentions(text, t.name)) || null;
}

/** Tags whose name appears in the text. */
export function matchingTags(tags, text) {
  return (tags || []).filter((t) => mentions(text, t.name)).map((t) => t.id);
}

/**
 * @param {{ sender: { name?: string, email?: string }, text: string }} input  text: subject and file names
 * @param {{ tags: any[], correspondents: any[], documentTypes: any[], storagePaths: any[] }} tax
 * @param {Record<string, { correspondent?: number|null, documentType?: number|null, tags?: number[], storagePath?: number|null }>} remembered
 */
export function suggestMetadata({ sender = {}, text = '' }, tax, remembered = {}) {
  const ids = (list) => new Set((list || []).map((x) => x.id));
  const known = { c: ids(tax.correspondents), d: ids(tax.documentTypes), t: ids(tax.tags), s: ids(tax.storagePaths) };
  for (const key of senderKeys(sender.email)) {
    const r = remembered?.[key];
    if (!r) continue;
    return {
      correspondent: known.c.has(r.correspondent) ? r.correspondent : null,
      documentType: known.d.has(r.documentType) ? r.documentType : null,
      tags: (r.tags || []).filter((id) => known.t.has(id)),
      storagePath: known.s.has(r.storagePath) ? r.storagePath : null,
      source: 'remembered',
    };
  }
  const correspondent = bestCorrespondent(tax.correspondents, sender);
  const documentType = bestDocumentType(tax.documentTypes, text);
  return {
    correspondent: correspondent ? correspondent.id : null,
    documentType: documentType ? documentType.id : null,
    tags: matchingTags(tax.tags, text),
    storagePath: null,
    source: correspondent || documentType ? 'matched' : 'none',
  };
}

/** Remember a choice for a sender (address key); keeps at most `max` senders. */
export function rememberChoice(remembered, email, choice, max = 200) {
  const [key] = senderKeys(email);
  if (!key) return remembered || {};
  const next = { ...(remembered || {}) };
  delete next[key];
  next[key] = {
    correspondent: Number.isInteger(choice.correspondent) ? choice.correspondent : null,
    documentType: Number.isInteger(choice.documentType) ? choice.documentType : null,
    tags: (choice.tags || []).filter(Number.isInteger),
    storagePath: Number.isInteger(choice.storagePath) ? choice.storagePath : null,
  };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete next[k];
  return next;
}
