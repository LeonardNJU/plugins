// Share links in the message: the block that lists them, and the links the
// user picked in the composer, which are added when the message is sent.

import { formatSize } from './format.js';

export const PENDING_KEY = 'pendingLinks';
export const MAX_PENDING = 50;

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

/** Add the link block to an outgoing message (htmlBody and/or textBody). */
export function appendLinks(outgoing, block) {
  if (!block.html && !block.text) return outgoing;
  const next = { ...outgoing };
  if (outgoing.htmlBody) next.htmlBody = outgoing.htmlBody + block.html;
  if (outgoing.textBody || !outgoing.htmlBody) next.textBody = (outgoing.textBody || '') + block.text;
  return next;
}

export async function getPending(storage) {
  const value = await storage.get(PENDING_KEY);
  return Array.isArray(value) ? value : [];
}

export async function addPending(storage, links) {
  const current = await getPending(storage);
  const next = [...current, ...links].slice(-MAX_PENDING);
  await storage.set(PENDING_KEY, next);
  return next;
}

export async function removePending(storage, id) {
  const next = (await getPending(storage)).filter((l) => l.id !== id);
  await storage.set(PENDING_KEY, next);
  return next;
}

export async function clearPending(storage) {
  await storage.set(PENDING_KEY, []);
}
