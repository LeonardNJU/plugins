import { describe, it, expect } from 'vitest';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { createClient, localPassword, BUFFERED_LIMIT } from '../src/lib/client.js';

const conn = { origin: 'https://c.example', userId: 'alice' };
const LIST = `<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
<d:response><d:href>/remote.php/dav/files/alice/Docs/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/alice/Docs/b.txt</d:href><d:propstat><d:prop><d:getcontentlength>2</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/alice/Docs/Sub/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

function api(handler) {
  return fakeApi({ handlers: { 'proxy.fetch': handler } });
}

describe('the Nextcloud client', () => {
  it('lists a folder with PROPFIND depth 1, without the folder itself, folders first', async () => {
    const a = api(async () => proxyResponse(LIST, { status: 207 }));
    const entries = await createClient(a, conn).list('/Docs');
    expect(entries.map((e) => e.name)).toEqual(['Sub', 'b.txt']);
    const [cred, url, init] = a.calls('proxy.fetch')[0].args;
    expect(cred).toBe('nextcloud');
    expect(url).toBe('https://c.example/remote.php/dav/files/alice/Docs');
    expect(init.method).toBe('PROPFIND');
    expect(init.headers.Depth).toBe('1');
  });

  it('searches by name and lists recent files with SEARCH', async () => {
    const a = api(async () => proxyResponse(LIST, { status: 207 }));
    const client = createClient(a, conn);
    expect(await client.search('  ')).toEqual([]);
    expect(a.calls('proxy.fetch')).toHaveLength(0);
    await client.search('rep');
    await client.recent();
    const [first, second] = a.calls('proxy.fetch').map((c) => c.args);
    expect(first[1]).toBe('https://c.example/remote.php/dav/');
    expect(first[2].method).toBe('SEARCH');
    expect(first[2].body).toContain('%rep%');
    expect(second[2].body).toContain('<d:is-collection/>');
  });

  it('creates a public read-only link with password and expiry', async () => {
    const a = api(async () => proxyResponse(JSON.stringify({ ocs: { meta: { statuscode: 200 }, data: { id: 7, url: 'https://c.example/s/xyz' } } })));
    const share = await createClient(a, conn).share('/Docs/b.txt', { password: 'pw', expireDate: '2026-11-01' });
    expect(share).toMatchObject({ id: '7', url: 'https://c.example/s/xyz', password: 'pw', expireDate: '2026-11-01', name: 'b.txt' });
    const [, url, init] = a.calls('proxy.fetch')[0].args;
    expect(url).toBe('https://c.example/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json');
    expect(init.headers['OCS-APIRequest']).toBe('true');
    const form = new URLSearchParams(init.body);
    expect(Object.fromEntries(form)).toEqual({ path: '/Docs/b.txt', shareType: '3', permissions: '1', password: 'pw', expireDate: '2026-11-01' });
  });

  it('says plainly when sharing is not allowed', async () => {
    const a = api(async () => proxyResponse(JSON.stringify({ ocs: { meta: { statuscode: 403, message: 'Public link sharing is disabled by the administrator' } } }), { status: 403 }));
    await expect(createClient(a, conn).share('/x')).rejects.toMatchObject({ code: 'share_forbidden', detail: 'Public link sharing is disabled by the administrator' });
  });

  it('downloads small files in one piece and large ones as a stream', async () => {
    const small = api(async () => proxyResponse(new Uint8Array([1, 2, 3]).buffer));
    expect([...await createClient(small, conn).download({ path: '/a', size: 3 })]).toEqual([1, 2, 3]);
    expect(small.calls('proxy.fetch')[0].args[2].responseType).toBe('arraybuffer');

    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
    const big = api(async () => proxyResponse(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } })));
    const progress = [];
    const bytes = await createClient(big, conn).download({ path: '/big', size: BUFFERED_LIMIT + 1 }, { onProgress: (l) => progress.push(l) });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(progress).toEqual([2, 3]);
    expect(big.calls('proxy.fetch')[0].args[2].responseType).toBe('stream');
  });

  it('makes missing parent folders and accepts existing ones', async () => {
    const existing = new Set(['/A']);
    const a = api(async (cred, url, init) => {
      const path = decodeURIComponent(url.replace('https://c.example/remote.php/dav/files/alice', ''));
      if (init.method === 'PROPFIND') return existing.has(path) ? proxyResponse(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/alice${path}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, { status: 207 }) : proxyResponse('', { status: 404 });
      if (init.method === 'MKCOL') { existing.add(path); return proxyResponse('', { status: 201 }); }
      return proxyResponse('', { status: 500 });
    });
    await createClient(a, conn).mkdirp('/A/B c/D');
    expect(a.calls('proxy.fetch').filter((c) => c.args[2].method === 'MKCOL').map((c) => c.args[1])).toEqual([
      'https://c.example/remote.php/dav/files/alice/A/B%20c',
      'https://c.example/remote.php/dav/files/alice/A/B%20c/D',
    ]);
  });

  it('uses the server password generator, or makes a strong one itself', async () => {
    const a = api(async () => proxyResponse(JSON.stringify({ ocs: { data: { password: 'Server-Made-1!' } } })));
    expect(await createClient(a, conn).generatePassword()).toBe('Server-Made-1!');
    const off = api(async () => proxyResponse('', { status: 404 }));
    const pw = await createClient(off, conn).generatePassword();
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[-_+!#]/);
    expect(localPassword(() => 0)).toHaveLength(20);
  });

  it('turns a full quota into a plain error', async () => {
    const a = api(async () => proxyResponse('<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns"><s:message>Insufficient space</s:message></d:error>', { status: 507 }));
    await expect(createClient(a, conn).put('/x', new Uint8Array(1))).rejects.toMatchObject({ code: 'quota' });
  });
});
