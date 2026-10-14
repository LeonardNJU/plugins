// Saving mail to Nextcloud: one attachment, or the whole message as .eml.

import { uploadFile } from './chunked.js';
import { joinPath, sanitizeFileName, uniqueName } from './paths.js';

export const SAVE_FOLDER_KEY = 'saveFolder';

/** Where an upload goes: the folder (made if missing) and a free name in it. */
export async function planUpload(client, folder, name) {
  await client.mkdirp(folder);
  const taken = await client.names(folder);
  return joinPath(folder, uniqueName(sanitizeFileName(name), taken));
}

/** A file name for a message: its subject, or "message", plus .eml. */
export function emlName(subject) {
  const base = sanitizeFileName(String(subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), 'message');
  return `${base}.eml`;
}

/** Save one attachment of a message. Resolves to the path in Nextcloud. */
export async function saveAttachment(api, client, { emailId, blobId, name }, folder, { onProgress, signal } = {}) {
  const data = await api.email.getAttachment(emailId, blobId);
  const blob = new Blob([data.data], { type: data.type || 'application/octet-stream' });
  const path = await planUpload(client, folder, name || data.name || 'attachment');
  await uploadFile(api, client, Object.assign(blob, { name: data.name }), path, { onProgress, signal });
  return path;
}

/** Save the message's source as an .eml file. Resolves to the path in Nextcloud. */
export async function saveMessage(api, client, { emailId, name }, folder, { onProgress, signal } = {}) {
  const raw = await api.email.getRaw(emailId);
  const blob = new Blob([raw], { type: 'message/rfc822' });
  const path = await planUpload(client, folder, name || 'message.eml');
  await uploadFile(api, client, blob, path, { onProgress, signal });
  return path;
}
