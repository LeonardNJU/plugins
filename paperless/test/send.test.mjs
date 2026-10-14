import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import {
  collectAttachment, collectMessage, collectMessages, consumability, effectiveType, emlName, forDialog, plannedUploads,
} from '../src/lib/send.js';
import { sha256Hex } from '../src/lib/hash.js';

const enc = (s) => new TextEncoder().encode(s);
const view = { subject: 'Invoice 10', from: [{ name: 'ACME', email: 'billing@acme.example' }], receivedAt: '2026-10-14T10:00:00Z' };

function raw(parts) {
  return enc([
    'Subject: Invoice 10', 'Content-Type: multipart/mixed; boundary=b', '',
    '--b', 'Content-Type: text/plain', '', 'see attached',
    ...parts.flatMap(([name, type, body]) => ['--b', `Content-Type: ${type}`, `Content-Disposition: attachment; filename="${name}"`, '', body]),
    '--b--', '',
  ].join('\r\n')).buffer;
}

describe('file types', () => {
  it('trusts the extension over application/octet-stream', () => {
    expect(effectiveType('scan.PDF', 'application/octet-stream')).toBe('application/pdf');
    expect(effectiveType('x.bin', '')).toBe('application/octet-stream');
  });
  it('knows what Paperless takes as is and what needs Tika', () => {
    expect(consumability('application/pdf')).toBe('yes');
    expect(consumability('image/jpeg')).toBe('yes');
    expect(consumability('message/rfc822')).toBe('tika');
    expect(consumability('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('tika');
    expect(consumability('application/zip')).toBe('no');
  });
  it('names a message file after its subject', () => {
    expect(emlName('Re: a/b "c"?')).toBe('Re a b c.eml');
    expect(emlName('')).toBe('message.eml');
  });
});

describe('collect', () => {
  it('reads one attachment with its checksums, ticked', async () => {
    const api = fakeApi({
      handlers: {
        'email.get': async () => view,
        'email.getAttachment': async () => ({ name: 'invoice.pdf', type: 'application/pdf', size: 4, data: enc('%PDF').buffer }),
      },
    });
    const [group] = await collectAttachment(api, { emailId: 'e1', blobId: 'b1', name: 'invoice.pdf', type: 'application/pdf' });
    expect(group.sender).toEqual({ name: 'ACME', email: 'billing@acme.example' });
    expect(group.items).toHaveLength(1);
    expect(group.items[0]).toMatchObject({ key: 'a:b1', kind: 'file', name: 'invoice.pdf', size: 4, selected: true, sha256: sha256Hex('%PDF'), title: 'invoice' });
    expect(api.calls('email.getAttachment')[0].args).toEqual(['e1', 'b1']);
  });

  it('a message: its attachments ticked, the .eml not; the .eml ticked when there is nothing else', async () => {
    const api = fakeApi({
      handlers: {
        'email.get': async () => view,
        'email.getRaw': async (id) => (id === 'e1' ? raw([['a.pdf', 'application/pdf', '%PDF'], ['b.zip', 'application/zip', 'PK']]) : raw([])),
      },
    });
    const one = await collectMessage(api, 'e1');
    expect(one.items.map((i) => [i.name, i.kind, i.selected])).toEqual([
      ['a.pdf', 'file', true], ['b.zip', 'file', false], ['Invoice 10.eml', 'eml', false],
    ]);
    expect(one.items[2].title).toBe('Invoice 10');
    const none = await collectMessage(api, 'e2');
    expect(none.items.map((i) => [i.kind, i.selected])).toEqual([['eml', true]]);
  });

  it('bulk reads at most 25 messages and reports progress', async () => {
    const api = fakeApi({ handlers: { 'email.get': async () => view, 'email.getRaw': async () => raw([]) } });
    const progress = [];
    const groups = await collectMessages(api, Array.from({ length: 30 }, (_, i) => `e${i}`), (i, n) => progress.push(`${i}/${n}`));
    expect(groups).toHaveLength(25);
    expect(progress[24]).toBe('24/25');
  });

  it('keeps the bytes out of what goes to the dialog', async () => {
    const api = fakeApi({ handlers: { 'email.get': async () => view, 'email.getRaw': async () => raw([['a.pdf', 'application/pdf', '%PDF']]) } });
    const dialog = forDialog([await collectMessage(api, 'e1')]);
    expect(dialog[0].items.every((i) => !('data' in i))).toBe(true);
    expect(dialog[0].items[0].sha256).toBe(sha256Hex('%PDF'));
  });
});

describe('plannedUploads', () => {
  const groups = [{ items: [
    { key: 'k1', name: 'a.pdf', type: 'application/pdf', title: 'a', data: enc('1') },
    { key: 'k2', name: 'b.pdf', type: 'application/pdf', title: 'b', data: enc('2') },
  ] }];

  it('uses the typed title for a single file only', () => {
    const one = plannedUploads(groups, { selected: ['k2'], title: ' Strom ', correspondent: 3, tags: [1, 'x'] });
    expect(one).toHaveLength(1);
    expect(one[0].doc).toMatchObject({ name: 'b.pdf', title: 'Strom', correspondent: 3, documentType: null, tags: [1] });
    const two = plannedUploads(groups, { selected: ['k1', 'k2'], title: 'ignored' });
    expect(two.map((u) => u.doc.title)).toEqual(['a', 'b']);
  });
});
