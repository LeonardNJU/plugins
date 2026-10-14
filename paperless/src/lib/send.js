// What "Send to Paperless" sends: one attachment, a message's attachments,
// the message itself as .eml, or all of that for several selected messages.
// The bytes are read once here and kept until the dialog closes.

import { parseMessage } from './mime.js';

/** At most this many messages in one bulk send. */
export const MAX_BULK_MESSAGES = 25;

/** Types Paperless consumes without Tika (PDF, images, plain text). */
const CONSUMABLE = [/^application\/pdf$/, /^image\/(png|jpe?g|tiff|webp|gif|bmp)$/, /^text\/(plain|csv)$/];
/** Types it consumes when the admin enabled Tika and Gotenberg. */
const WITH_TIKA = [
  /^message\/rfc822$/, /^text\/html$/,
  /^application\/(msword|rtf|vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)|vnd\.ms-(excel|powerpoint))$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
];
const BY_EXTENSION = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv', eml: 'message/rfc822' };

/** The real type, from the extension when the mailer said application/octet-stream. */
export function effectiveType(name, type) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (t && t !== 'application/octet-stream') return t;
  const ext = String(name || '').toLowerCase().split('.').pop();
  return BY_EXTENSION[ext] || t || 'application/octet-stream';
}

/** 'yes' (always), 'tika' (needs Tika on the server), 'no'. */
export function consumability(type) {
  const t = String(type || '').toLowerCase();
  if (CONSUMABLE.some((re) => re.test(t))) return 'yes';
  if (WITH_TIKA.some((re) => re.test(t))) return 'tika';
  return 'no';
}

/** A file name for a message saved as .eml. */
export function emlName(subject) {
  const base = String(subject || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || 'message'}.eml`;
}

/** "invoice-2026-10.pdf" → "invoice-2026-10". */
export function titleFromName(name) {
  const n = String(name || '').trim();
  const i = n.lastIndexOf('.');
  return (i > 0 ? n.slice(0, i) : n).slice(0, 128);
}

function itemFor({ key, kind, name, type, data, emailId, subject, hasFiles }) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const realType = kind === 'eml' ? 'message/rfc822' : effectiveType(name, type);
  const support = consumability(realType);
  return {
    key,
    kind,
    emailId,
    name,
    type: realType,
    size: bytes.byteLength,
    data: bytes,
    support,
    title: kind === 'eml' ? String(subject || '').slice(0, 128) || titleFromName(name) : titleFromName(name),
    // Attachments are what people file; the message itself when it has none.
    selected: kind === 'eml' ? !hasFiles : support === 'yes',
  };
}

const senderOf = (view) => ({ name: view?.from?.[0]?.name || '', email: view?.from?.[0]?.email || '' });

/** One attachment from the attachment menu. */
export async function collectAttachment(api, { emailId, blobId, name, type }) {
  const [view, file] = await Promise.all([
    api.email.get(emailId).catch(() => null),
    api.email.getAttachment(emailId, blobId),
  ]);
  const item = itemFor({ key: `a:${blobId}`, kind: 'file', name: file.name || name, type: file.type || type, data: file.data, emailId, subject: view?.subject, hasFiles: true });
  item.selected = true;
  return [{ emailId, subject: view?.subject || '', sender: senderOf(view), receivedAt: view?.receivedAt || '', items: [item] }];
}

/** A message: its attachments and the message as .eml. */
export async function collectMessage(api, emailId) {
  const [view, raw] = await Promise.all([api.email.get(emailId).catch(() => null), api.email.getRaw(emailId)]);
  const parsed = parseMessage(raw);
  const subject = view?.subject || parsed.subject || '';
  const files = parsed.attachments.map((a, i) => itemFor({ key: `${emailId}:${i}`, kind: 'file', name: a.name, type: a.type, data: a.data, emailId, subject, hasFiles: true }));
  const hasFiles = files.some((f) => f.support === 'yes');
  const eml = itemFor({ key: `${emailId}:eml`, kind: 'eml', name: emlName(subject), type: 'message/rfc822', data: new Uint8Array(raw), emailId, subject, hasFiles });
  return { emailId, subject, sender: senderOf(view), receivedAt: view?.receivedAt || '', items: [...files, eml] };
}

/** Several selected messages, one after the other (each can be 25 MB). */
export async function collectMessages(api, emailIds, onProgress) {
  const ids = emailIds.slice(0, MAX_BULK_MESSAGES);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    onProgress?.(i, ids.length);
    out.push(await collectMessage(api, ids[i]));
  }
  return out;
}

/** What goes to the dialog: everything but the bytes (they stay in the background). */
export function forDialog(groups) {
  return groups.map((g) => ({
    emailId: g.emailId, subject: g.subject, sender: g.sender,
    items: g.items.map(({ data: _data, ...rest }) => rest),
  }));
}

/**
 * The uploads for the user's choice.
 * @param {Array} groups  from collect*
 * @param {{ selected: string[], title?: string, correspondent?: number|null, documentType?: number|null, storagePath?: number|null, tags?: number[] }} choice
 */
export function plannedUploads(groups, choice) {
  const selected = new Set(choice.selected || []);
  const items = groups.flatMap((g) => g.items).filter((item) => selected.has(item.key));
  const single = items.length === 1;
  return items.map((item) => ({
    item,
    doc: {
      data: item.data,
      name: item.name,
      type: item.type,
      title: single && choice.title?.trim() ? choice.title.trim() : item.title,
      correspondent: Number.isInteger(choice.correspondent) ? choice.correspondent : null,
      documentType: Number.isInteger(choice.documentType) ? choice.documentType : null,
      storagePath: Number.isInteger(choice.storagePath) ? choice.storagePath : null,
      tags: (choice.tags || []).filter(Number.isInteger),
    },
  }));
}
