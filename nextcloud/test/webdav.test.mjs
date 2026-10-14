import { describe, it, expect } from 'vitest';
import { parseMultistatus, toEntry, searchBody, likePattern, sortEntries, decodeXml } from '../src/lib/webdav.js';

// Trimmed from a real Nextcloud 34 PROPFIND answer.
const LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
<d:response><d:href>/remote.php/dav/files/alice/Documents/</d:href><d:propstat><d:prop><d:getlastmodified>Wed, 14 Oct 2026 02:37:30 GMT</d:getlastmodified><d:resourcetype><d:collection/></d:resourcetype><oc:fileid>80</oc:fileid><oc:size>1313</oc:size></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getcontentlength/><d:getcontenttype/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/alice/Documents/Report%202026.pdf</d:href><d:propstat><d:prop><d:displayname>Report 2026.pdf</d:displayname><d:getcontentlength>637</d:getcontentlength><d:getcontenttype>application/pdf</d:getcontenttype><d:getlastmodified>Wed, 14 Oct 2026 02:37:30 GMT</d:getlastmodified><d:resourcetype/><oc:fileid>93</oc:fileid><oc:size>637</oc:size><oc:permissions>RGDNVW</oc:permissions><d:getetag>&quot;abc&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/alice/Documents/Tom%20%26%20Jerry.txt</d:href><d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

describe('webdav', () => {
  it('parses folders and files from a multistatus answer', () => {
    const entries = parseMultistatus(LISTING).map((r) => toEntry(r, 'alice'));
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ path: '/Documents', name: 'Documents', isFolder: true, size: 1313, fileId: '80', type: '' });
    expect(entries[1]).toMatchObject({
      path: '/Documents/Report 2026.pdf', name: 'Report 2026.pdf', isFolder: false, size: 637,
      type: 'application/pdf', fileId: '93', permissions: 'RGDNVW', etag: 'abc',
      modified: Date.parse('Wed, 14 Oct 2026 02:37:30 GMT'),
    });
    expect(entries[2]).toMatchObject({ name: 'Tom & Jerry.txt', type: 'application/octet-stream', size: 3 });
  });

  it('ignores properties that came back 404 and other prefixes work too', () => {
    const xml = '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/remote.php/dav/files/u/x</D:href>'
      + '<D:propstat><D:prop><D:getcontentlength>5</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>'
      + '<D:propstat><D:prop><D:getcontenttype>text/html</D:getcontenttype></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>'
      + '</D:response></D:multistatus>';
    const [entry] = parseMultistatus(xml).map((r) => toEntry(r, 'u'));
    expect(entry.size).toBe(5);
    expect(entry.type).toBe('application/octet-stream');
  });

  it('skips responses outside the user files', () => {
    const xml = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/uploads/u/1/</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
    expect(parseMultistatus(xml).map((r) => toEntry(r, 'u'))).toEqual([null]);
  });

  it('decodes entities', () => {
    expect(decodeXml('a &amp; b &lt;c&gt; &#228; &#x1F600;')).toBe('a & b <c> ä 😀');
  });

  it('escapes the search text and its wildcards', () => {
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
    const body = searchBody({ userId: 'alice', query: 'a<b' });
    expect(body).toContain('<d:literal>%a&lt;b%</d:literal>');
    expect(body).toContain('<d:href>/files/alice</d:href>');
    expect(searchBody({ userId: 'alice', recent: true, limit: 9999 })).toContain('<d:not><d:is-collection/></d:not>');
    expect(searchBody({ userId: 'alice', recent: true, limit: 9999 })).toContain('<d:nresults>200</d:nresults>');
  });

  it('sorts folders first, then names naturally', () => {
    const sorted = sortEntries([
      { name: 'b10', isFolder: false }, { name: 'b2', isFolder: false }, { name: 'z', isFolder: true }, { name: 'A', isFolder: true },
    ], 'en');
    expect(sorted.map((e) => e.name)).toEqual(['A', 'z', 'b2', 'b10']);
  });
});
