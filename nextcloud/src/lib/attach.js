// Files picked in Nextcloud end up in the message either as real
// attachments (downloaded, uploaded to the mail server, handed to the
// composer) or as share links.

import { NcError, errorFromException } from './errors.js';

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Download each file and attach it. `onAttach` is the composer's callback
 * (resolves false when the composer refuses, e.g. the message would get too
 * big). Resolves to the names attached; stops at the first problem.
 */
export async function attachEntries(api, client, entries, { onAttach, onProgress, signal } = {}) {
  const attached = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (signal?.aborted) throw new NcError('cancelled');
    const report = (loaded, total) => onProgress?.({ index: i, count: entries.length, name: entry.name, loaded, total: total || entry.size || 0 });
    report(0, entry.size);
    const bytes = await client.download(entry, { signal, onProgress: report });
    if (signal?.aborted) throw new NcError('cancelled');
    const type = entry.type || 'application/octet-stream';
    let blob;
    try {
      blob = await api.jmap.uploadBlob(bytes, entry.name, type);
    } catch (err) {
      throw errorFromException(err, signal);
    }
    const ok = await onAttach({ blobId: blob.blobId, name: entry.name, type: blob.type || type, size: blob.size ?? bytes.byteLength });
    if (ok === false) throw new NcError('attach_refused', { detail: entry.name });
    attached.push(entry.name);
  }
  return attached;
}

/** Share each file with a public, read-only link. */
export async function shareEntries(client, entries, { password = '', expireDate = '', includePassword = false } = {}) {
  const links = [];
  for (const entry of entries) {
    const share = await client.share(entry.path, { password, expireDate });
    links.push({
      id: randomId(),
      name: entry.name,
      size: entry.isFolder ? 0 : entry.size,
      url: share.url,
      password: password || '',
      includePassword: !!(password && includePassword),
      expireDate: expireDate || '',
    });
  }
  return links;
}
