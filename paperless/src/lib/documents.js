// Paperless documents into mail: attach to a new message, or download.

import { PaperlessError } from './errors.js';

/** The mail server and the host read attachments up to this size. */
export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

/**
 * Download each document from Paperless, upload it to the mail server and
 * open the composer with them attached.
 * @param {Array<{ id: number, title?: string, original_file_name?: string }>} docs
 */
export async function attachDocuments(api, client, docs, onProgress) {
  if (!docs.length) return null;
  const attachments = [];
  for (let i = 0; i < docs.length; i++) {
    onProgress?.(i, docs.length);
    const doc = docs[i];
    const file = await client.download(doc.id, doc.original_file_name || `${doc.title || 'document'}.pdf`);
    const size = file.data?.byteLength ?? 0;
    if (size > MAX_ATTACH_BYTES) throw new PaperlessError('error.attach_too_large', { name: file.name });
    const blob = await api.jmap.uploadBlob(new Uint8Array(file.data), file.name, file.type);
    attachments.push({ blobId: blob.blobId, name: file.name, type: blob.type || file.type, size: blob.size ?? size });
  }
  const message = { attachments };
  if (docs.length === 1 && docs[0].title) message.subject = String(docs[0].title).slice(0, 200);
  return api.compose.open(message);
}

export async function downloadDocument(api, client, doc) {
  const file = await client.download(doc.id, doc.original_file_name || `${doc.title || 'document'}.pdf`);
  await api.ui.downloadFile({ content: new Uint8Array(file.data), filename: file.name, contentType: file.type });
  return file.name;
}
