// Rules like "always send invoices from billing@acme.com to Paperless with
// the tag Invoice". A rule only runs on mail that arrives after the user
// switched it on: never on the messages already in the mailbox.

export const RULES_KEY = 'rules';
export const PROCESSED_KEY = 'processed';
const MAX_RULES = 50;
const MAX_PROCESSED = 500;

const intOrNull = (v) => (Number.isInteger(v) ? v : null);

/** A clean rule, or null when it can't run (no sender). */
export function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const from = String(raw.from ?? '').trim().slice(0, 200);
  if (!from) return null;
  return {
    id: String(raw.id || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`).slice(0, 40),
    from,
    subject: String(raw.subject ?? '').trim().slice(0, 200),
    what: raw.what === 'message' ? 'message' : 'attachments',
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Number.isInteger).slice(0, 20) : [],
    correspondent: intOrNull(raw.correspondent),
    documentType: intOrNull(raw.documentType),
    storagePath: intOrNull(raw.storagePath),
    // Off until the user turns it on: the opt-in.
    enabled: raw.enabled === true,
    enabledAt: raw.enabled === true ? (Number.isFinite(raw.enabledAt) ? raw.enabledAt : Date.now()) : null,
  };
}

export function normalizeRules(list) {
  return (Array.isArray(list) ? list : []).map(normalizeRule).filter(Boolean).slice(0, MAX_RULES);
}

/** Does a sender pattern fit an address? "bob@x.org" exact, "@x.org" / "x.org" the domain and its subdomains, else part of name or address. */
export function senderMatches(pattern, sender) {
  const p = String(pattern || '').trim().toLowerCase();
  if (!p) return false;
  const email = String(sender?.email || '').trim().toLowerCase();
  const name = String(sender?.name || '').trim().toLowerCase();
  const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : '';
  if (/^[^@\s]+@[^@\s]+$/.test(p)) return email === p;
  const bareDomain = p.startsWith('@') ? p.slice(1) : (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(p) ? p : '');
  if (bareDomain) return !!domain && (domain === bareDomain || domain.endsWith(`.${bareDomain}`));
  return email.includes(p) || name.includes(p);
}

/**
 * Does a rule apply to a newly arrived message?
 * @param {object} rule  normalized
 * @param {{ from?: Array<{ name?: string, email?: string }>, subject?: string, hasAttachment?: boolean, receivedAt?: string }} email
 */
export function ruleMatches(rule, email) {
  if (!rule?.enabled) return false;
  // Only mail that arrived after the rule was switched on.
  if (rule.enabledAt && email.receivedAt) {
    const received = Date.parse(email.receivedAt);
    if (Number.isFinite(received) && received < rule.enabledAt - 60_000) return false;
  }
  const senders = Array.isArray(email.from) ? email.from : [];
  if (!senders.some((s) => senderMatches(rule.from, s))) return false;
  if (rule.subject && !String(email.subject || '').toLowerCase().includes(rule.subject.toLowerCase())) return false;
  if (rule.what === 'attachments' && email.hasAttachment === false) return false;
  return true;
}

export function findRule(rules, email) {
  return normalizeRules(rules).find((r) => ruleMatches(r, email)) || null;
}

/** Add an id to the processed list; false when it was there already. */
export function markProcessed(list, emailId, max = MAX_PROCESSED) {
  const ids = Array.isArray(list) ? list : [];
  if (ids.includes(emailId)) return { added: false, list: ids };
  return { added: true, list: [...ids, emailId].slice(-max) };
}
