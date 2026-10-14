// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { linkBlock, escapeHtml } from '../src/lib/links.js';
import { hooks } from '../src/index.js';
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

  it('makes real links, so the composer shows them as links', () => {
    const { html } = linkBlock(t, [link()], 'en');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect([...doc.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent])).toEqual([['https://c.example/s/abc', 'Report 2026.pdf']]);
  });
});

describe('the send', () => {
  it('is left alone: links are already in the body, nothing is added on send or kept for later', () => {
    expect(hooks.onTransformOutgoingEmail).toBeUndefined();
    expect(hooks.onComposerClose).toBeUndefined();
    expect(manifest.permissions).not.toContain('email:send');
  });
});
