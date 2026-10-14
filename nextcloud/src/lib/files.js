// Actions of the Files page that don't need React: download a file to the
// computer, attach it to a new message, upload with resume.

import { NcError, errorFromException, mailError } from './errors.js';
import { joinPath, sanitizeFileName } from './paths.js';

// What the host refuses to hand out from a plugin (see ui.downloadFile).
const BLOCKED_EXT = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'jar',
  'lnk', 'app', 'dmg', 'pkg', 'sh', 'command', 'html', 'htm', 'xhtml', 'shtml', 'svg', 'mhtml', 'xml']);
const BLOCKED_TYPE = /^(text\/html|application\/xhtml|image\/svg|application\/(x-)?javascript|text\/javascript|application\/x-msdownload|application\/xml|text\/xml)/i;

/** Whether the webmail lets a plugin hand this file to the user as a download. */
export function canDownload(entry) {
  const name = String(entry?.name ?? '');
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return !BLOCKED_EXT.has(ext) && !BLOCKED_TYPE.test(entry?.type ?? '');
}

/** Download a file from Nextcloud to the user's computer. */
export async function downloadToComputer(api, client, entry, { onProgress, signal } = {}) {
  if (!canDownload(entry)) throw new NcError('forbidden', { detail: 'file type' });
  const bytes = await client.download(entry, { onProgress, signal });
  try {
    await api.ui.downloadFile({ content: bytes, filename: entry.name, contentType: entry.type || 'application/octet-stream' });
  } catch (err) {
    throw errorFromException(err, signal);
  }
}

/** Open the composer with the file attached. */
export async function attachToNewMessage(api, client, entry, { onProgress, signal } = {}) {
  const bytes = await client.download(entry, { onProgress, signal });
  const type = entry.type || 'application/octet-stream';
  let blob;
  try {
    blob = await api.jmap.uploadBlob(bytes, entry.name, type);
  } catch (err) {
    throw mailError(err, signal);
  }
  return api.compose.open({
    attachments: [{ blobId: blob.blobId, name: entry.name, type: blob.type || type, size: blob.size ?? bytes.byteLength }],
  });
}

/**
 * Ask for a name in the host's prompt and make that folder in `path`.
 * Resolves to the new folder's path, or null when the user cancelled.
 */
export async function createFolder(api, client, path) {
  const t = api.i18n.t;
  const answer = await api.ui.prompt({
    title: t('save.newFolder'),
    confirmLabel: t('save.create'),
    cancelLabel: t('common.cancel'),
    fields: [{ name: 'name', label: t('save.folderName'), placeholder: t('save.folderName'), required: true }],
  });
  const clean = sanitizeFileName(answer?.name ?? '', '');
  if (!clean) return null;
  const target = joinPath(path, clean);
  await client.mkdir(target);
  return target;
}
