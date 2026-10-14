import { describe, it, expect } from 'vitest';
import {
  cleanTaskError, createClient, documentQuery, filenameFromDisposition, normalizeBase, normalizeTask,
} from '../src/lib/client.js';
import { PaperlessError } from '../src/lib/errors.js';

const BASE = 'https://dms.example.com';

/** A proxy.fetch stand-in answering by path; records the calls. */
function fakeProxy(routes) {
  const calls = [];
  const fetch = async (credentialId, url, init) => {
    calls.push({ credentialId, url, init });
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.pathname}`;
    const handler = routes[key] ?? routes[u.pathname];
    if (!handler) return { status: 404, ok: false, headers: {}, body: '{"detail":"Not found."}' };
    const out = typeof handler === 'function' ? handler(u, init) : handler;
    const status = out.status ?? 200;
    const body = out.body !== undefined ? out.body : JSON.stringify(out.json);
    return { status, ok: status >= 200 && status < 300, headers: out.headers ?? {}, body, ...(out.proxyError ? { proxyError: out.proxyError } : {}) };
  };
  return { fetch, calls };
}

describe('normalizeBase', () => {
  it('keeps a path, drops a trailing slash and /api, adds https', () => {
    expect(normalizeBase('https://x.org/paperless/')).toBe('https://x.org/paperless');
    expect(normalizeBase('x.org/api/')).toBe('https://x.org');
    expect(normalizeBase('http://localhost:18010')).toBe('http://localhost:18010');
    expect(normalizeBase('')).toBe('');
    expect(normalizeBase('ftp://x.org')).toBe('');
  });
});

describe('documentQuery', () => {
  it('turns filters into Paperless query parameters', () => {
    const q = new URLSearchParams(documentQuery({ text: ' acme ', tags: [1, 4], correspondent: 2, documentType: 3, from: '2026-01-01', to: '2026-12-31' }, 2, 10));
    expect(q.get('title_content')).toBe('acme');
    expect(q.get('tags__id__all')).toBe('1,4');
    expect(q.get('correspondent__id__in')).toBe('2');
    expect(q.get('document_type__id__in')).toBe('3');
    expect(q.get('created__date__gte')).toBe('2026-01-01');
    expect(q.get('created__date__lte')).toBe('2026-12-31');
    expect(q.get('page')).toBe('2');
    expect(q.get('page_size')).toBe('10');
  });

  it('leaves out empty and malformed filters', () => {
    const q = new URLSearchParams(documentQuery({ text: '', tags: [], correspondent: null, from: '1.1.2026' }));
    for (const k of ['title_content', 'tags__id__all', 'correspondent__id__in', 'created__date__gte']) expect(q.has(k)).toBe(false);
  });
});

describe('normalizeTask', () => {
  it('reads a Paperless 3 success', () => {
    expect(normalizeTask({ results: [{ status: 'success', result_data: { document_id: 7 }, related_document_ids: [7] }] }))
      .toEqual({ state: 'success', documentId: 7, error: '', duplicateOf: null });
  });

  it('reads a Paperless 2 success from the result text', () => {
    expect(normalizeTask([{ status: 'SUCCESS', result: 'Success. New document id 12 created' }]).documentId).toBe(12);
    expect(normalizeTask([{ status: 'SUCCESS', related_document: '13' }]).documentId).toBe(13);
  });

  it('reads failures with a short error and spots duplicates', () => {
    const failed = normalizeTask({ results: [{ status: 'failure', result_data: { error_message: 't.eml: Error occurred while consuming document t.eml: Error while converting email to PDF: [Errno 111] Connection refused' } }] });
    expect(failed.state).toBe('failure');
    expect(failed.error).toBe('Error while converting email to PDF: Connection refused');
    const dup = normalizeTask([{ status: 'FAILURE', result: 'a.pdf: Not consuming a.pdf: It is a duplicate of ACME invoice (#2)' }]);
    expect(dup.duplicateOf).toBe(2);
  });

  it('is pending while queued or running, unknown when absent', () => {
    expect(normalizeTask([{ status: 'STARTED' }]).state).toBe('pending');
    expect(normalizeTask({ results: [{ status: 'pending' }] }).state).toBe('pending');
    expect(normalizeTask({ results: [] }).state).toBe('unknown');
  });

  it('cleanTaskError keeps one line', () => {
    expect(cleanTaskError('first line\nTraceback ...')).toBe('first line');
  });
});

describe('filenameFromDisposition', () => {
  it('prefers filename* and decodes it', () => {
    expect(filenameFromDisposition(`attachment; filename="a b.pdf"; filename*=utf-8''R%C3%BCckfrage%20x.pdf`)).toBe('Rückfrage x.pdf');
    expect(filenameFromDisposition('attachment; filename="plain.pdf"')).toBe('plain.pdf');
    expect(filenameFromDisposition(undefined)).toBe('');
  });
});

describe('createClient', () => {
  it('uploads a multipart body with the metadata and returns the task id', async () => {
    const proxy = fakeProxy({ 'POST /api/documents/post_document/': { body: '"0b1c2d3e-aaaa-bbbb-cccc-0123456789ab"' } });
    const client = createClient({ proxyFetch: proxy.fetch, credentialId: 'shared', base: BASE });
    const taskId = await client.upload({
      data: new TextEncoder().encode('%PDF-1.4'), name: 'Rechnung.pdf', type: 'application/pdf',
      title: 'Rechnung Oktober', correspondent: 1, documentType: 2, storagePath: 3, tags: [4, 5],
    });
    expect(taskId).toBe('0b1c2d3e-aaaa-bbbb-cccc-0123456789ab');
    const { credentialId, init } = proxy.calls[0];
    expect(credentialId).toBe('shared');
    expect(init.method).toBe('POST');
    const boundary = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1];
    const text = new TextDecoder().decode(init.body);
    expect(text).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="Rechnung.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n`);
    expect(text).toContain('name="title"\r\n\r\nRechnung Oktober\r\n');
    expect(text).toContain('name="correspondent"\r\n\r\n1\r\n');
    expect(text).toContain('name="document_type"\r\n\r\n2\r\n');
    expect(text).toContain('name="storage_path"\r\n\r\n3\r\n');
    expect(text.match(/name="tags"/g)).toHaveLength(2);
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('leaves out metadata the user did not pick', async () => {
    const proxy = fakeProxy({ 'POST /api/documents/post_document/': { body: '"0b1c2d3e-aaaa-bbbb-cccc-0123456789ab"' } });
    const client = createClient({ proxyFetch: proxy.fetch, credentialId: 'shared', base: BASE });
    await client.upload({ data: new Uint8Array([1]), name: 'x.pdf', correspondent: null, tags: [] });
    const text = new TextDecoder().decode(proxy.calls[0].init.body);
    expect(text).not.toContain('name="correspondent"');
    expect(text).not.toContain('name="tags"');
  });

  it('turns a refused upload into a readable error', async () => {
    const proxy = fakeProxy({ 'POST /api/documents/post_document/': { status: 400, body: '{"document":["No file was submitted."]}' } });
    const client = createClient({ proxyFetch: proxy.fetch, credentialId: 'shared', base: BASE });
    await expect(client.upload({ data: new Uint8Array([1]), name: 'x.pdf' })).rejects.toMatchObject({ key: 'error.rejected', vars: { detail: 'document: No file was submitted.' } });
  });

  it('looks a file up by SHA-256 first, then MD5', async () => {
    const seen = [];
    const proxy = fakeProxy({
      '/api/documents/': (u) => {
        const sum = u.searchParams.get('checksum__iexact');
        seen.push(sum);
        return { json: { results: sum === 'md5sum' ? [{ id: 9, title: 'Old scan' }] : [] } };
      },
    });
    const client = createClient({ proxyFetch: proxy.fetch, credentialId: 'personal', base: BASE });
    expect(await client.findByChecksum({ sha256: 'shasum', md5: 'md5sum' })).toEqual({ id: 9, title: 'Old scan' });
    expect(seen).toEqual(['shasum', 'md5sum']);
    expect(await client.findByChecksum({ sha256: 'none', md5: 'neither' })).toBeNull();
  });

  it('pages through lists by page number', async () => {
    const proxy = fakeProxy({
      '/api/tags/': (u) => (u.searchParams.get('page') === '1'
        ? { json: { next: 'http://internal/next', results: [{ id: 2, name: 'b' }] } }
        : { json: { next: null, results: [{ id: 1, name: 'a' }] } }),
      '/api/correspondents/': { json: { results: [] } },
      '/api/document_types/': { json: { results: [] } },
      '/api/storage_paths/': { status: 403, body: '{"detail":"no"}' },
    });
    const client = createClient({ proxyFetch: proxy.fetch, credentialId: 'shared', base: BASE });
    const tax = await client.taxonomies();
    expect(tax.tags.map((t) => t.name)).toEqual(['a', 'b']);
    expect(tax.storagePaths).toEqual([]);
    expect(proxy.calls.every((c) => c.url.startsWith(BASE))).toBe(true);
  });

  it('says so when the server is not Paperless', async () => {
    const proxy = fakeProxy({ '/api/ui_settings/': { body: '<html>login</html>' } });
    const client = createClient({ proxyFetch: proxy.fetch, credentialId: 'shared', base: BASE });
    await expect(client.whoAmI()).rejects.toMatchObject({ key: 'error.not_paperless' });
  });

  it('downloads the original with its file name', async () => {
    const proxy = fakeProxy({
      '/api/documents/5/download/': { body: new Uint8Array([1, 2]).buffer, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="scan.pdf"' } },
    });
    const client = createClient({ proxyFetch: proxy.fetch, credentialId: 'shared', base: BASE });
    const file = await client.download(5);
    expect(file.name).toBe('scan.pdf');
    expect(file.type).toBe('application/pdf');
    expect(proxy.calls[0].url).toBe(`${BASE}/api/documents/5/download/?original=true`);
    expect(client.documentUrl(5)).toBe(`${BASE}/documents/5/details`);
  });

  it('needs a base URL', () => {
    expect(() => createClient({ proxyFetch: () => {}, credentialId: 'x', base: '' })).toThrow(PaperlessError);
  });
});
