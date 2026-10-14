import { describe, it, expect } from 'vitest';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { uploadFile, discardUpload, resumeKey, chunkName, UPLOADS_KEY } from '../src/lib/chunked.js';

const conn = { origin: 'https://c.example', userId: 'alice' };
const DEST = 'https://c.example/remote.php/dav/files/alice/Up/big.bin';
const UP = 'https://c.example/remote.php/dav/uploads/alice/';

function file(size, name = 'big.bin') {
  const blob = new Blob([new Uint8Array(size)]);
  return Object.assign(blob, { name, lastModified: 1 });
}

/** A Nextcloud that keeps chunks in memory. `failOn(method, url)` can make one request fail. */
function server({ failOn } = {}) {
  const uploads = new Map(); // id -> Map(name -> size)
  const files = new Map();
  const log = [];
  const handler = async (cred, url, init) => {
    const method = init.method;
    log.push(`${method} ${url.replace(UP, 'UP/').replace('https://c.example/remote.php/dav/files/alice', 'F')}`);
    if (failOn) {
      const fail = failOn(method, url);
      if (fail) return fail;
    }
    if (url.startsWith(UP)) {
      const [id, part] = url.slice(UP.length).split('/');
      if (method === 'MKCOL') { expect(init.headers?.Destination).toBe(DEST); uploads.set(id, new Map()); return proxyResponse('', { status: 201 }); }
      if (method === 'PUT') {
        expect(init.headers.Destination).toBe(DEST);
        uploads.get(id).set(part, init.body.size);
        init.onProgress?.(init.body.size, init.body.size);
        return proxyResponse('', { status: 201 });
      }
      if (method === 'PROPFIND') {
        if (!uploads.has(id)) return proxyResponse('', { status: 404 });
        const rows = [...uploads.get(id)].map(([n, s]) => `<d:response><d:href>/remote.php/dav/uploads/alice/${id}/${n}</d:href><d:propstat><d:prop><d:getcontentlength>${s}</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('');
        return proxyResponse(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/uploads/alice/${id}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>${rows}</d:multistatus>`, { status: 207 });
      }
      if (method === 'MOVE') {
        expect(part).toBe('.file');
        const total = [...uploads.get(id).values()].reduce((a, b) => a + b, 0);
        expect(String(total)).toBe(init.headers['OC-Total-Length']);
        files.set(init.headers.Destination, total);
        uploads.delete(id);
        return proxyResponse('', { status: 201 });
      }
      if (method === 'DELETE') { uploads.delete(id); return proxyResponse('', { status: 204 }); }
    }
    if (method === 'PUT') { files.set(url, init.body.size); return proxyResponse('', { status: 201 }); }
    return proxyResponse('', { status: 500 });
  };
  return { handler, uploads, files, log };
}

describe('uploading to Nextcloud', () => {
  it('sends a small file in one PUT', async () => {
    const s = server();
    const api = fakeApi({ handlers: { 'proxy.fetch': s.handler } });
    const res = await uploadFile(api, conn, file(5), '/Up/big.bin', { chunkSize: 10 });
    expect(res).toEqual({ path: '/Up/big.bin', chunked: false, resumed: false });
    expect(s.log).toEqual(['PUT F/Up/big.bin']);
  });

  it('sends a large file in numbered chunks and assembles it with MOVE', async () => {
    const s = server();
    const api = fakeApi({ handlers: { 'proxy.fetch': s.handler } });
    const progress = [];
    const res = await uploadFile(api, conn, file(25), '/Up/big.bin', { chunkSize: 10, onProgress: (l, t) => progress.push(`${l}/${t}`) });
    expect(res.chunked).toBe(true);
    expect(s.log.map((l) => l.replace(/bulwark-\w+/, 'ID'))).toEqual([
      'MKCOL UP/ID', 'PUT UP/ID/00001', 'PUT UP/ID/00002', 'PUT UP/ID/00003', 'MOVE UP/ID/.file',
    ]);
    expect(s.files.get(DEST)).toBe(25);
    expect(progress.at(-1)).toBe('25/25');
    expect(progress).toContain('20/25');
    const loaded = progress.map((p) => Number(p.split('/')[0]));
    expect(loaded).toEqual([...loaded].sort((a, b) => a - b));
    expect(await api.storage.get(UPLOADS_KEY)).toEqual({});
  });

  it('resumes after a failure with the chunks the server already has', async () => {
    let failing = true;
    const s = server({ failOn: (method, url) => (failing && method === 'PUT' && url.endsWith('/00002') ? proxyResponse('', { status: 507 }) : null) });
    const api = fakeApi({ handlers: { 'proxy.fetch': s.handler } });
    const f = file(25);
    await expect(uploadFile(api, conn, f, '/Up/big.bin', { chunkSize: 10 })).rejects.toMatchObject({ code: 'quota' });
    expect(Object.keys(await api.storage.get(UPLOADS_KEY))).toEqual([resumeKey('/Up/big.bin', f)]);

    failing = false;
    s.log.length = 0;
    const res = await uploadFile(api, conn, f, '/Up/big.bin', { chunkSize: 10 });
    expect(res.resumed).toBe(true);
    expect(s.log.map((l) => l.replace(/bulwark-\w+/, 'ID'))).toEqual([
      'PROPFIND UP/ID', 'PUT UP/ID/00002', 'PUT UP/ID/00003', 'MOVE UP/ID/.file',
    ]);
    expect(s.files.get(DEST)).toBe(25);
  });

  it('starts over when the server already threw the chunks away', async () => {
    const s = server();
    const api = fakeApi({ handlers: { 'proxy.fetch': s.handler } });
    const f = file(25);
    await api.storage.set(UPLOADS_KEY, { [resumeKey('/Up/big.bin', f)]: { id: 'bulwark-gone' } });
    const res = await uploadFile(api, conn, f, '/Up/big.bin', { chunkSize: 10 });
    expect(res.resumed).toBe(false);
    expect(s.log[0]).toBe('PROPFIND UP/bulwark-gone');
    expect(s.log[1]).toMatch(/^MKCOL UP\/bulwark-/);
  });

  it('retries a chunk after a network hiccup, but not after a full quota', async () => {
    let fails = 1;
    const s = server({ failOn: (method, url) => (method === 'PUT' && url.endsWith('/00001') && fails-- > 0 ? proxyResponse('', { status: 502, proxyError: 'unreachable' }) : null) });
    const api = fakeApi({ handlers: { 'proxy.fetch': s.handler } });
    await uploadFile(api, conn, file(15), '/Up/big.bin', { chunkSize: 10, wait: async () => {} });
    expect(s.log.filter((l) => l.endsWith('/00001'))).toHaveLength(2);
  });

  it('stops between chunks when cancelled and keeps what was sent', async () => {
    const ctrl = new AbortController();
    const s = server();
    const api = fakeApi({ handlers: { 'proxy.fetch': s.handler } });
    // Cancel right after chunk 1 finished (its own progress, then the total).
    let seen = 0;
    const onProgress = (loaded) => { if (loaded >= 10 && ++seen === 2) ctrl.abort(); };
    await expect(uploadFile(api, conn, file(25), '/Up/big.bin', { chunkSize: 10, signal: ctrl.signal, onProgress })).rejects.toMatchObject({ code: 'cancelled' });
    expect(s.log.some((l) => l.includes('/00002'))).toBe(false);
    expect([...s.uploads.values()][0].get('00001')).toBe(10);
  });

  it('can throw an unfinished upload away', async () => {
    const s = server();
    const api = fakeApi({ handlers: { 'proxy.fetch': s.handler } });
    const f = file(25);
    await api.storage.set(UPLOADS_KEY, { [resumeKey('/Up/big.bin', f)]: { id: 'bulwark-x' } });
    expect(await discardUpload(api, conn, f, '/Up/big.bin')).toBe(true);
    expect(s.log).toEqual(['DELETE UP/bulwark-x']);
    expect(await api.storage.get(UPLOADS_KEY)).toEqual({});
  });

  it('numbers chunks the way Nextcloud sorts them', () => {
    expect(chunkName(0)).toBe('00001');
    expect(chunkName(9999)).toBe('10000');
  });
});
