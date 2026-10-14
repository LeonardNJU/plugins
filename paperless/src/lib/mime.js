// Just enough MIME to find the attachments of a message from its raw source.
// The host hands plugins the attachment list only for the attachment menu, so
// "send this message's attachments" (reader toolbar, bulk, rules) reads them
// from api.email.getRaw.

const latin1 = (bytes, start = 0, end = bytes.length) => {
  let out = '';
  for (let i = start; i < end; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + 8192)));
  return out;
};

function decodeCharset(bytes, charset) {
  const label = (charset || 'utf-8').trim().toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function base64ToBytes(text) {
  let clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  // Padding was dropped above; put it back (a lone trailing character is noise).
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  while (clean.length % 4) clean += '=';
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function qpToBytes(text, header = false) {
  const src = header ? text.replace(/_/g, ' ') : text.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(src.charCodeAt(i) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** RFC 2047 encoded words: =?utf-8?B?...?= and =?iso-8859-1?Q?...?=. */
export function decodeWords(value) {
  if (typeof value !== 'string' || !value.includes('=?')) return value || '';
  return value
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?)/gi, '$1')
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bq])\?([^?]*)\?=/gi, (_m, charset, enc, text) => {
      const bytes = enc.toLowerCase() === 'b' ? base64ToBytes(text) : qpToBytes(text, true);
      return decodeCharset(bytes, charset);
    });
}

/** Header block → map of lower-case name to values (unfolded, raw). */
export function parseHeaders(text) {
  const headers = {};
  const lines = text.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    (headers[name] ||= []).push(line.slice(i + 1).trim());
  }
  return headers;
}

/** "text/plain; charset=utf-8; name*=UTF-8''f%C3%BC.pdf" → { value, params }, with RFC 2231 continuations. */
export function parseParams(header) {
  const parts = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < (header || '').length; i++) {
    const c = header[i];
    if (c === '"' && header[i - 1] !== '\\') quoted = !quoted;
    if (c === ';' && !quoted) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  const value = (parts.shift() || '').trim().toLowerCase();
  const raw = {};
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i <= 0) continue;
    const key = p.slice(0, i).trim().toLowerCase();
    let v = p.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    raw[key] = v;
  }
  const params = {};
  const continued = {};
  for (const [key, v] of Object.entries(raw)) {
    const m = /^([^*]+)\*(\d+)?(\*)?$/.exec(key);
    if (!m) { params[key] = v; continue; }
    const [, name, index, encoded] = m;
    (continued[name] ||= []).push({ index: Number(index ?? 0), v, encoded: !!encoded || (index === undefined) });
  }
  for (const [name, pieces] of Object.entries(continued)) {
    pieces.sort((a, b) => a.index - b.index);
    let charset = 'utf-8';
    const bytes = [];
    pieces.forEach((piece, n) => {
      let text = piece.v;
      if (piece.encoded && n === 0) {
        const m = /^([^']*)'[^']*'(.*)$/.exec(text);
        if (m) { charset = m[1] || 'utf-8'; text = m[2]; }
      }
      if (piece.encoded) {
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) { bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; }
          else bytes.push(text.charCodeAt(i) & 0xff);
        }
      } else {
        for (const b of new TextEncoder().encode(text)) bytes.push(b);
      }
    });
    params[name] = decodeCharset(new Uint8Array(bytes), charset);
  }
  return { value, params };
}

function indexOfBytes(hay, needle, from) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Split an entity into header text and body bytes. */
function splitEntity(bytes) {
  let i = indexOfBytes(bytes, [13, 10, 13, 10], 0);
  let skip = 4;
  const lf = indexOfBytes(bytes, [10, 10], 0);
  if (lf !== -1 && (i === -1 || lf < i)) { i = lf; skip = 2; }
  if (i === -1) return { headerText: latin1(bytes), body: new Uint8Array(0) };
  return { headerText: latin1(bytes, 0, i), body: bytes.subarray(i + skip) };
}

function splitMultipart(body, boundary) {
  const marker = new TextEncoder().encode(`--${boundary}`);
  const parts = [];
  let pos = indexOfBytes(body, marker, 0);
  while (pos !== -1) {
    let start = pos + marker.length;
    if (body[start] === 45 && body[start + 1] === 45) break; // closing --boundary--
    while (start < body.length && body[start] !== 10) start++;
    start++;
    const next = indexOfBytes(body, marker, start);
    if (next === -1) { parts.push(body.subarray(start)); break; }
    let end = next;
    if (body[end - 1] === 10) end--;
    if (body[end - 1] === 13) end--;
    parts.push(body.subarray(start, end));
    pos = next;
  }
  return parts;
}

function decodeBody(body, encoding) {
  const enc = (encoding || '').trim().toLowerCase();
  if (enc === 'base64') return base64ToBytes(latin1(body));
  if (enc === 'quoted-printable') return qpToBytes(latin1(body));
  return body;
}

const EXT_BY_TYPE = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/tiff': 'tiff', 'image/webp': 'webp',
  'image/gif': 'gif', 'text/plain': 'txt', 'text/csv': 'csv', 'message/rfc822': 'eml',
};

function walk(bytes, out, depth) {
  if (depth > 8) return;
  const { headerText, body } = splitEntity(bytes);
  const headers = parseHeaders(headerText);
  const ct = parseParams(headers['content-type']?.[0] || 'text/plain');
  const cd = parseParams(headers['content-disposition']?.[0] || '');
  if (ct.value.startsWith('multipart/') && ct.params.boundary) {
    for (const part of splitMultipart(body, ct.params.boundary)) walk(part, out, depth + 1);
    return;
  }
  const rawName = cd.params.filename || ct.params.name || '';
  const name = decodeWords(rawName).replace(/[\\/]/g, '_').trim();
  // Inline parts are pictures in the text (logos, signatures), except a PDF
  // some mailers mark inline anyway.
  let isAttachment;
  if (cd.value === 'attachment') isAttachment = true;
  else if (cd.value === 'inline') isAttachment = ct.value === 'application/pdf';
  else isAttachment = !!name;
  if (!isAttachment || depth === 0) return;
  const data = decodeBody(body, headers['content-transfer-encoding']?.[0]);
  const type = ct.value || 'application/octet-stream';
  out.push({
    name: name || `attachment-${out.length + 1}.${EXT_BY_TYPE[type] || 'bin'}`,
    type,
    size: data.byteLength,
    data,
  });
}

/**
 * The attachments of a raw RFC 5322 message, in order.
 * @param {ArrayBuffer|Uint8Array} raw
 * @returns {{ subject: string, from: string, date: string, attachments: Array<{ name: string, type: string, size: number, data: Uint8Array }> }}
 */
export function parseMessage(raw) {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const { headerText } = splitEntity(bytes);
  const headers = parseHeaders(headerText);
  const attachments = [];
  walk(bytes, attachments, 0);
  return {
    subject: decodeWords(headers.subject?.[0] || ''),
    from: decodeWords(headers.from?.[0] || ''),
    date: headers.date?.[0] || '',
    attachments,
  };
}
