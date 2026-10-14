// A small XML reader for WebDAV multistatus answers. Namespace prefixes are
// dropped (DAV servers pick their own: D:, d:, A:, cal:, ...), which is fine
// for the handful of DAV and CalDAV element names read here.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function localName(name) {
  const i = name.indexOf(':');
  return (i >= 0 ? name.slice(i + 1) : name).toLowerCase();
}

/** Parse XML into `{ name, attrs, children, text }` nodes. Throws on broken XML. */
export function parseXml(xml) {
  const source = String(xml ?? '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tagRe = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  for (let m = tagRe.exec(source); m; m = tagRe.exec(source)) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.text += decode(source.slice(last, m.index));
    last = tagRe.lastIndex;
    if (m[1] !== undefined) {
      top.text += m[1];
      continue;
    }
    const [, , closing, rawName, rawAttrs, selfClosing] = m;
    const name = localName(rawName);
    if (closing) {
      if (stack.length < 2 || top.name !== name) throw new Error(`Unexpected </${rawName}>`);
      stack.pop();
      continue;
    }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[localName(a[1])] = decode(a[2] ?? a[3] ?? '');
    }
    const node = { name, attrs, children: [], text: '' };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error('Unclosed element');
  return root;
}

export function child(node, name) {
  return node?.children.find((c) => c.name === name) ?? null;
}

export function children(node, name) {
  return node?.children.filter((c) => c.name === name) ?? [];
}

/** All descendants with this name, depth first. */
export function descendants(node, name, out = []) {
  for (const c of node?.children ?? []) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

function textOf(node) {
  return (node?.text ?? '').trim();
}

/**
 * The responses of a multistatus document: `{ href, props }` where props
 * maps each property found with a 2xx status to its node.
 */
export function multistatus(xml) {
  const doc = parseXml(xml);
  const ms = descendants(doc, 'multistatus')[0];
  if (!ms) return [];
  return children(ms, 'response').map((response) => {
    const props = {};
    for (const propstat of children(response, 'propstat')) {
      const status = textOf(child(propstat, 'status'));
      if (status && !/\s2\d\d(\s|$)/.test(status)) continue;
      for (const prop of children(propstat, 'prop')) {
        for (const p of prop.children) props[p.name] = p;
      }
    }
    return { href: textOf(child(response, 'href')), props };
  });
}

/** The first href inside a property, e.g. current-user-principal. */
export function hrefIn(propNode) {
  return textOf(descendants(propNode, 'href')[0]) || null;
}

/** Whether a response is a calendar collection that takes tasks. */
export function isTaskList(props) {
  const types = props.resourcetype?.children.map((c) => c.name) ?? [];
  if (!types.includes('calendar')) return false;
  const set = props['supported-calendar-component-set'];
  // Without the property a calendar takes every component.
  if (!set) return true;
  return descendants(set, 'comp').some((c) => (c.attrs.name ?? '').toUpperCase() === 'VTODO');
}

/** Whether a calendar takes nothing but tasks. */
export function isTasksOnly(props) {
  const set = props['supported-calendar-component-set'];
  if (!set) return false;
  const comps = descendants(set, 'comp').map((c) => (c.attrs.name ?? '').toUpperCase());
  return comps.length > 0 && comps.every((c) => c === 'VTODO');
}

export function displayName(props) {
  return textOf(props.displayname);
}
