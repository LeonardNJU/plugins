// WebDAV request bodies and a small parser for Nextcloud's multistatus
// answers. The sandbox has DOMParser, but the unit tests run in Node, and the
// answers are simple enough for a tolerant regex parser that ignores which
// namespace prefixes the server picked.

import { baseName, hrefToPath } from './paths.js';

const PROPS = `<d:prop>
  <d:displayname/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:resourcetype/><d:getetag/>
  <oc:fileid/><oc:size/><oc:permissions/>
</d:prop>`;

const NS = 'xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"';

export const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind ${NS}>${PROPS}</d:propfind>`;

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A DAV `like` pattern matching names that contain `text`. */
export function likePattern(text) {
  // % and _ are the wildcards of a DAV like; take them literally.
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * A SEARCH body for the user's files: names containing `query`, or with
 * `recent` the newest files (folders left out), newest first.
 */
export function searchBody({ userId, query = '', recent = false, limit = 50 }) {
  const where = recent
    ? '<d:not><d:is-collection/></d:not>'
    : `<d:like><d:prop><d:displayname/></d:prop><d:literal>${xmlEscape(likePattern(query))}</d:literal></d:like>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:searchrequest ${NS}>
<d:basicsearch>
<d:select>${PROPS}</d:select>
<d:from><d:scope><d:href>/files/${xmlEscape(userId)}</d:href><d:depth>infinity</d:depth></d:scope></d:from>
<d:where>${where}</d:where>
<d:orderby><d:order><d:prop><d:getlastmodified/></d:prop><d:descending/></d:order></d:orderby>
<d:limit><d:nresults>${Math.max(1, Math.min(200, Number(limit) || 50))}</d:nresults></d:limit>
</d:basicsearch>
</d:searchrequest>`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

function blocks(xml, local) {
  // <x:local ...> ... </x:local>, any or no prefix. \1 is empty without one.
  const re = new RegExp(`<([A-Za-z][\\w.-]*:)?${local}\\b[^>]*>([\\s\\S]*?)</\\1${local}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[2]);
  return out;
}

function first(xml, local) {
  return blocks(xml, local)[0];
}

/** The properties inside one <prop> element, by local name. */
function parseProps(xml) {
  const props = {};
  const re = /<(?:[A-Za-z][\w.-]*:)?([A-Za-z][\w.-]*)\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z][\w.-]*:)?\1>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, name, inner] = m;
    props[name] = inner === undefined ? '' : inner;
  }
  return props;
}

/**
 * The responses of a multistatus document: `{ href, props }`, where props
 * holds the raw inner XML of each property that came back with status 200.
 */
export function parseMultistatus(xml) {
  const out = [];
  for (const response of blocks(String(xml ?? ''), 'response')) {
    const href = decodeXml((first(response, 'href') ?? '').trim());
    const props = {};
    for (const propstat of blocks(response, 'propstat')) {
      const status = first(propstat, 'status') ?? '';
      if (!/\s2\d\d\b/.test(status)) continue;
      const prop = first(propstat, 'prop');
      if (prop !== undefined) Object.assign(props, parseProps(prop));
    }
    out.push({ href, props });
  }
  return out;
}

/** A file or folder as the plugin uses it. */
export function toEntry({ href, props }, userId) {
  const path = hrefToPath(href, userId);
  if (path === null) return null;
  const isFolder = /<(?:[\w.-]+:)?collection\b/.test(props.resourcetype ?? '');
  const sizeRaw = props.size ?? props.getcontentlength;
  const size = Number(sizeRaw);
  const modified = Date.parse(decodeXml(props.getlastmodified ?? ''));
  const displayName = decodeXml(props.displayname ?? '').trim();
  return {
    path,
    name: baseName(path) || displayName || '',
    isFolder,
    size: Number.isFinite(size) && sizeRaw !== '' ? size : 0,
    type: isFolder ? '' : (decodeXml(props.getcontenttype ?? '') || 'application/octet-stream'),
    modified: Number.isFinite(modified) ? modified : 0,
    fileId: props.fileid ? decodeXml(props.fileid) : '',
    permissions: props.permissions ? decodeXml(props.permissions) : '',
    etag: props.getetag ? decodeXml(props.getetag).replace(/"/g, '') : '',
  };
}

/** Folders first, then by name in the user's language. */
export function sortEntries(entries, locale) {
  const collator = new Intl.Collator(locale || undefined, { numeric: true, sensitivity: 'base' });
  return [...entries].sort((a, b) => (a.isFolder === b.isFolder ? collator.compare(a.name, b.name) : a.isFolder ? -1 : 1));
}
