// Share links in the message: the block that lists them. The picker puts it
// into the message at the caret; the large-file offer hands it to the
// composer in place of the attachment.

import { formatSize } from './format.js';

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(url) {
  const s = String(url ?? '');
  return /^https?:\/\//i.test(s) ? s : '';
}

function details(t, link, locale) {
  const parts = [];
  if (link.size) parts.push(formatSize(link.size, locale));
  if (link.password && link.includePassword) parts.push(t('links.password', { password: link.password }));
  if (link.expireDate) parts.push(t('links.until', { date: link.expireDate }));
  return parts;
}

/** HTML and plain text listing the links, in the sender's language. */
export function linkBlock(t, links, locale) {
  const usable = (links ?? []).filter((l) => safeUrl(l.url));
  if (usable.length === 0) return { html: '', text: '' };
  const title = t('links.title');
  const items = usable.map((l) => {
    const extra = details(t, l, locale);
    return `<li><a href="${escapeHtml(safeUrl(l.url))}">${escapeHtml(l.name || l.url)}</a>${extra.length ? ` (${escapeHtml(extra.join(', '))})` : ''}</li>`;
  }).join('');
  const html = `<div class="nextcloud-links"><p><strong>${escapeHtml(title)}</strong></p><ul>${items}</ul></div>`;
  const lines = usable.map((l) => {
    const extra = details(t, l, locale);
    return `- ${l.name || l.url}: ${safeUrl(l.url)}${extra.length ? ` (${extra.join(', ')})` : ''}`;
  });
  return { html, text: `\n\n${title}\n${lines.join('\n')}\n` };
}
