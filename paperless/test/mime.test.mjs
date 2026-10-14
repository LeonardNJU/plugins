import { describe, it, expect } from 'vitest';
import { decodeWords, parseMessage, parseParams } from '../src/lib/mime.js';

const b64 = (s) => Buffer.from(s).toString('base64');

function message(parts) {
  return [
    'From: =?utf-8?B?SsO8cmdlbg==?= <j@example.org>',
    'Subject: =?iso-8859-1?Q?Rechnung_f=FCr_Oktober?=',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    '--outer',
    'Content-Type: multipart/alternative; boundary=inner',
    '',
    '--inner',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello',
    '--inner',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Hello <img src="cid:logo"></p>',
    '--inner--',
    ...parts,
    '--outer--',
    '',
  ].join('\r\n');
}

describe('parseMessage', () => {
  it('finds attachments, decodes their bytes and names', () => {
    const raw = message([
      '--outer',
      'Content-Type: application/pdf; name="invoice.pdf"',
      'Content-Disposition: attachment; filename="invoice.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      b64('%PDF-1.4 invoice').replace(/(.{8})/g, '$1\r\n'),
      '--outer',
      'Content-Type: application/pdf',
      "Content-Disposition: attachment; filename*=UTF-8''R%C3%BCckfrage.pdf",
      'Content-Transfer-Encoding: base64',
      '',
      b64('second'),
      '--outer',
      'Content-Type: text/plain; name="=?utf-8?Q?Notiz_=C3=A4.txt?="',
      'Content-Disposition: attachment',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'line one=\r\n continued =C3=A4',
      '--outer',
      'Content-Type: image/png; name="logo.png"',
      'Content-Disposition: inline; filename="logo.png"',
      'Content-ID: <logo>',
      'Content-Transfer-Encoding: base64',
      '',
      b64('png'),
    ]);
    const parsed = parseMessage(new TextEncoder().encode(raw));
    expect(parsed.subject).toBe('Rechnung für Oktober');
    expect(parsed.from).toBe('Jürgen <j@example.org>');
    expect(parsed.attachments.map((a) => a.name)).toEqual(['invoice.pdf', 'Rückfrage.pdf', 'Notiz ä.txt']);
    expect(new TextDecoder().decode(parsed.attachments[0].data)).toBe('%PDF-1.4 invoice');
    expect(parsed.attachments[0].type).toBe('application/pdf');
    expect(parsed.attachments[0].size).toBe(16);
    expect(new TextDecoder().decode(parsed.attachments[2].data)).toBe('line one continued ä');
  });

  it('has no attachments for a plain message', () => {
    const raw = 'Subject: hi\r\nContent-Type: text/plain\r\n\r\nJust text\r\n';
    expect(parseMessage(new TextEncoder().encode(raw)).attachments).toEqual([]);
  });

  it('keeps an inline PDF and names a nameless attachment', () => {
    const raw = message([
      '--outer',
      'Content-Type: application/pdf',
      'Content-Disposition: inline',
      '',
      '%PDF',
      '--outer',
      'Content-Type: application/octet-stream',
      'Content-Disposition: attachment',
      '',
      'bin',
    ]);
    const names = parseMessage(new TextEncoder().encode(raw)).attachments.map((a) => a.name);
    expect(names).toEqual(['attachment-1.pdf', 'attachment-2.bin']);
  });
});

describe('header helpers', () => {
  it('joins RFC 2231 continuations', () => {
    const { value, params } = parseParams("attachment; filename*0*=UTF-8''sehr%20lange; filename*1*=r%20Name.pdf");
    expect(value).toBe('attachment');
    expect(params.filename).toBe('sehr langer Name.pdf');
  });

  it('decodes adjacent encoded words without the space between them', () => {
    expect(decodeWords('=?utf-8?Q?a?= =?utf-8?Q?b?=')).toBe('ab');
    expect(decodeWords('plain')).toBe('plain');
  });
});
