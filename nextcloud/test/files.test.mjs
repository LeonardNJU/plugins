import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { canDownload, downloadToComputer, attachToNewMessage } from '../src/lib/files.js';
import { registerActions, slots } from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };

const pdf = { path: '/Docs/a.pdf', name: 'a.pdf', size: 3, type: 'application/pdf' };
const client = { download: async (entry) => new Uint8Array(entry.size) };

describe('the Files page', () => {
  it('only offers downloads the webmail will hand out', () => {
    expect(canDownload(pdf)).toBe(true);
    expect(canDownload({ name: 'page.html', type: 'text/html' })).toBe(false);
    expect(canDownload({ name: 'logo.SVG', type: '' })).toBe(false);
    expect(canDownload({ name: 'notes', type: 'text/xml' })).toBe(false);
    expect(canDownload({ name: 'setup.exe', type: 'application/octet-stream' })).toBe(false);
  });

  it('downloads the bytes and hands them to the browser', async () => {
    const api = fakeApi();
    await downloadToComputer(api, client, pdf);
    const [opts] = api.calls('ui.downloadFile')[0].args;
    expect(opts.filename).toBe('a.pdf');
    expect(opts.contentType).toBe('application/pdf');
    expect(opts.content).toBeInstanceOf(Uint8Array);
    expect(opts.content.byteLength).toBe(3);
  });

  it('refuses a blocked type before downloading it', async () => {
    const api = fakeApi();
    let downloaded = false;
    await expect(downloadToComputer(api, { download: async () => { downloaded = true; return new Uint8Array(1); } }, { name: 'x.html', type: 'text/html' }))
      .rejects.toMatchObject({ code: 'forbidden' });
    expect(downloaded).toBe(false);
  });

  it('opens a new message with the file attached', async () => {
    const api = fakeApi({ handlers: {
      'jmap.uploadBlob': async (bytes, name, type) => ({ blobId: 'B1', size: bytes.byteLength, type }),
      'compose.open': async () => 'navigating',
    } });
    expect(await attachToNewMessage(api, client, pdf)).toBe('navigating');
    expect(api.calls('compose.open')[0].args[0]).toEqual({ attachments: [{ blobId: 'B1', name: 'a.pdf', type: 'application/pdf', size: 3 }] });
  });

  it('is a page in the navigation', async () => {
    const api = fakeApi({ translations: manifest.locales });
    await registerActions(api);
    expect(api.calls('ui.setPages')[0].args[0]).toEqual([{ id: 'files', title: 'Nextcloud', icon: 'cloud' }]);
    expect(typeof slots['app-page'].component).toBe('function');
    expect(manifest.permissions).toEqual(expect.arrayContaining(['ui:app-page', 'compose:open', 'ui:download-file']));
  });
});
