import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { linkBlock, appendLinks, addPending, getPending, removePending, escapeHtml } from '../src/lib/links.js';
import { addLinksToMessage, hooks, activate } from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };

const en = manifest.locales.en;
const t = (key, vars) => (en[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));

const link = (over = {}) => ({ id: 'l1', name: 'Report 2026.pdf', size: 2048, url: 'https://c.example/s/abc', password: '', includePassword: false, expireDate: '', ...over });

describe('the link block', () => {
  it('lists each link with size, password only when wanted, and expiry', () => {
    const block = linkBlock(t, [
      link(),
      link({ id: 'l2', name: 'a<b>.txt', size: 0, password: 'pw1', includePassword: true, expireDate: '2026-11-01' }),
      link({ id: 'l3', name: 'secret.zip', password: 'pw2', includePassword: false }),
    ], 'en');
    expect(block.html).toContain('<strong>Files shared with Nextcloud</strong>');
    expect(block.html).toContain('<a href="https://c.example/s/abc">Report 2026.pdf</a> (2 KB)');
    expect(block.html).toContain('a&lt;b&gt;.txt</a> (password: pw1, available until 2026-11-01)');
    expect(block.html).not.toContain('pw2');
    expect(block.text).toContain('- Report 2026.pdf: https://c.example/s/abc (2 KB)');
    expect(block.text).not.toContain('pw2');
  });

  it('drops links that are not http(s)', () => {
    expect(linkBlock(t, [link({ url: 'javascript:alert(1)' })], 'en')).toEqual({ html: '', text: '' });
  });

  it('escapes quotes in attributes', () => {
    expect(escapeHtml('"x\'')).toBe('&quot;x&#39;');
  });

  it('appends to the HTML and to the plain text, without creating an HTML part for plain mail', () => {
    const block = { html: '<p>L</p>', text: '\nL' };
    expect(appendLinks({ htmlBody: '<p>Hi</p>', textBody: 'Hi' }, block)).toMatchObject({ htmlBody: '<p>Hi</p><p>L</p>', textBody: 'Hi\nL' });
    expect(appendLinks({ htmlBody: '', textBody: 'Hi' }, block)).toMatchObject({ htmlBody: '', textBody: 'Hi\nL' });
    expect(appendLinks({ htmlBody: '<p>Hi</p>', textBody: '' }, block)).toMatchObject({ htmlBody: '<p>Hi</p><p>L</p>', textBody: '' });
  });
});

describe('links picked in the composer', () => {
  it('are kept until removed', async () => {
    const api = fakeApi();
    await addPending(api.storage, [link(), link({ id: 'l2' })]);
    expect((await getPending(api.storage)).map((l) => l.id)).toEqual(['l1', 'l2']);
    await removePending(api.storage, 'l1');
    expect((await getPending(api.storage)).map((l) => l.id)).toEqual(['l2']);
  });

  it('go into the message once, when it is sent', async () => {
    const api = fakeApi({ translations: manifest.locales });
    await addPending(api.storage, [link()]);
    const out = await addLinksToMessage(api, { htmlBody: '<p>Hi</p>', textBody: 'Hi', subject: 's' });
    expect(out.htmlBody).toContain('https://c.example/s/abc');
    expect(out.subject).toBe('s');
    expect(await getPending(api.storage)).toEqual([]);
    expect(await addLinksToMessage(api, { htmlBody: '<p>Hi</p>', textBody: 'Hi' })).toBeUndefined();
  });

  it('are wired to the send and close hooks', async () => {
    const api = fakeApi({ translations: manifest.locales, handlers: { 'proxy.accounts': async () => [] } });
    await activate(api);
    await addPending(api.storage, [link()]);
    const out = await hooks.onTransformOutgoingEmail({ htmlBody: '<p>x</p>', textBody: 'x' });
    expect(out.textBody).toContain('Report 2026.pdf');
    await addPending(api.storage, [link()]);
    await hooks.onComposerClose({ draftId: 'd', sent: false });
    expect(await getPending(api.storage)).toEqual([]);
  });
});
