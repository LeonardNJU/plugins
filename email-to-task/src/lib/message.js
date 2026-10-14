// What a task made from a message says: title, description, link back.


const REPLY_PREFIX = /^\s*((re|fwd?|aw|wg|sv|vs|antw|tr|rv|r|fw|ref|réf|rif|odp|pd|ynt|отв|ha|回复|转发|答复)\s*(\[\d+\])?\s*[:：]\s*)+/iu;

/** The subject without Re:/Fwd:/AW:/WG: prefixes, at most 250 characters. */
export function taskTitle(subject) {
  const clean = String(subject ?? '').replace(REPLY_PREFIX, '').replace(/\s+/g, ' ').trim();
  return clean.length > 250 ? `${clean.slice(0, 249)}…` : clean;
}

/**
 * The webmail's address, from the sandbox page this code runs in: the
 * sandbox is served from the webmail itself at `<base>/plugin-sandbox`.
 */
export function webmailBase(location) {
  if (!location?.origin || location.origin === 'null') return '';
  const path = String(location.pathname ?? '');
  const i = path.search(/\/plugin-sandbox(-privileged)?(\/|$)/);
  const base = i >= 0 ? path.slice(0, i) : '';
  return `${location.origin}${base}`;
}

/** A link that opens the message in the webmail, as "Copy link" makes it. */
export function messageLink(base, emailId) {
  return `${base}/mail/message/${encodeURIComponent(emailId)}`;
}

function sender(email) {
  const from = email?.from?.[0];
  if (!from) return '';
  return from.name && from.name !== from.email ? `${from.name} <${from.email}>` : from.email;
}

/** The first `max` characters of the message's own text, without quoted replies. */
export function excerpt(text, max = 600) {
  const own = String(text ?? '').replace(/\n{3,}/g, '\n\n').trim();
  if (own.length <= max) return own;
  const cut = own.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`;
}

/**
 * The description as plain text: sender, date, a link back to the message
 * and, if wanted, the start of the message's text. `t` translates labels.
 */
export function taskDescription(email, { link, t, withExcerpt = true, formatDate = (iso) => iso }) {
  const lines = [];
  const from = sender(email);
  if (from) lines.push(t('description.from', { sender: from }));
  if (email?.receivedAt) lines.push(t('description.date', { date: formatDate(email.receivedAt) }));
  if (link) lines.push(t('description.link', { link }));
  const body = withExcerpt ? excerpt(email?.text ?? email?.preview ?? '') : '';
  return body ? `${lines.join('\n')}\n\n${body}` : lines.join('\n');
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Plain text as HTML paragraphs with clickable http(s) links (Vikunja's description is HTML). */
export function textToHtml(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((para) => {
      const html = escapeHtml(para)
        .replace(/https?:\/\/[^\s<>"']+/g, (url) => `<a href="${url}">${url}</a>`)
        .replace(/\n/g, '<br>');
      return `<p>${html}</p>`;
    })
    .join('');
}
