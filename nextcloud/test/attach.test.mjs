import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { attachEntries, shareEntries } from '../src/lib/attach.js';
import { applyPickerResult } from '../src/ui/composer-source.js';
import { getPending } from '../src/lib/links.js';
import manifest from '../manifest.json' with { type: 'json' };

const entries = [
  { path: '/a.pdf', name: 'a.pdf', size: 3, type: 'application/pdf' },
  { path: '/b.png', name: 'b.png', size: 2, type: '' },
];

function fakeClient() {
  return {
    download: async (entry, { onProgress }) => { onProgress?.(entry.size, entry.size); return new Uint8Array(entry.size); },
    share: async (path, opts) => ({ url: `https://c.example/s${path}`, ...opts }),
  };
}

describe('attaching files from Nextcloud', () => {
  it('downloads each file, uploads it to the mail server and hands it to the composer', async () => {
    const api = fakeApi({ handlers: { 'jmap.uploadBlob': async (bytes, name, type) => ({ blobId: `blob-${name}`, size: bytes.byteLength, type }) } });
    const attached = [];
    const progress = [];
    await attachEntries(api, fakeClient(), entries, {
      onAttach: async (b) => { attached.push(b); return true; },
      onProgress: (p) => progress.push(`${p.index}:${p.loaded}/${p.total}`),
    });
    expect(attached).toEqual([
      { blobId: 'blob-a.pdf', name: 'a.pdf', type: 'application/pdf', size: 3 },
      { blobId: 'blob-b.png', name: 'b.png', type: 'application/octet-stream', size: 2 },
    ]);
    expect(api.calls('jmap.uploadBlob')[0].args[0]).toBeInstanceOf(Uint8Array);
    expect(progress).toContain('1:2/2');
  });

  it('stops when the composer refuses a file', async () => {
    const api = fakeApi({ handlers: { 'jmap.uploadBlob': async () => ({ blobId: 'x', size: 1, type: 't' }) } });
    await expect(attachEntries(api, fakeClient(), entries, { onAttach: async () => false })).rejects.toMatchObject({ code: 'attach_refused' });
    expect(api.calls('jmap.uploadBlob')).toHaveLength(1);
  });

  it('stops when cancelled', async () => {
    const api = fakeApi({ handlers: { 'jmap.uploadBlob': async () => ({ blobId: 'x' }) } });
    const ctrl = new AbortController();
    ctrl.abort();
    const client = fakeClient();
    let downloads = 0;
    const download = client.download;
    client.download = (...args) => { downloads++; return download(...args); };
    await expect(attachEntries(api, client, entries, { onAttach: async () => true, signal: ctrl.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(downloads).toBe(0);
    expect(api.calls('jmap.uploadBlob')).toHaveLength(0);
  });

  it('creates one link per file and keeps the password out of the message unless asked', async () => {
    const links = await shareEntries(fakeClient(), entries, { password: 'pw', expireDate: '2026-12-01', includePassword: false });
    expect(links.map((l) => [l.name, l.url, l.password, l.includePassword, l.expireDate])).toEqual([
      ['a.pdf', 'https://c.example/s/a.pdf', 'pw', false, '2026-12-01'],
      ['b.png', 'https://c.example/s/b.png', 'pw', false, '2026-12-01'],
    ]);
    expect(new Set(links.map((l) => l.id)).size).toBe(2);
  });

  it('blames the mail server, not Nextcloud, when it refuses the upload', async () => {
    const limited = fakeApi({ handlers: { 'jmap.uploadBlob': async () => { throw new Error('Rate limited by server'); } } });
    await expect(attachEntries(limited, fakeClient(), entries, { onAttach: async () => true })).rejects.toMatchObject({ code: 'mail_rate_limited' });
    const broken = fakeApi({ handlers: { 'jmap.uploadBlob': async () => { throw new Error('Upload failed: 500'); } } });
    await expect(attachEntries(broken, fakeClient(), entries, { onAttach: async () => true })).rejects.toMatchObject({ code: 'mail_upload', detail: 'Upload failed: 500' });
  });
});

describe('the composer button', () => {
  it('hands attached files to the composer and reports a refusal', async () => {
    const api = fakeApi({ translations: manifest.locales });
    const seen = [];
    const res = await applyPickerResult(api, { action: 'attach', blobs: [{ blobId: '1', name: 'a' }, { blobId: '2', name: 'b' }, { blobId: '3', name: 'c' }] },
      async (b) => { seen.push(b.blobId); return b.blobId !== '2'; });
    expect(res.attached).toBe(1);
    expect(seen).toEqual(['1', '2']);
    expect(api.calls('toast.error')[0].args[0]).toContain('b');
  });

  it('keeps chosen links for the send', async () => {
    const api = fakeApi({ translations: manifest.locales });
    await applyPickerResult(api, { action: 'links', links: [{ id: 'x', name: 'n', url: 'https://c/s/1' }] }, null);
    expect(await getPending(api.storage)).toHaveLength(1);
  });

  it('does nothing when the dialog was closed', async () => {
    const api = fakeApi();
    expect(await applyPickerResult(api, null, async () => true)).toEqual({ attached: 0, links: 0 });
  });
});
