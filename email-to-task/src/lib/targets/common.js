// Shared bits of the services tasks go to.

/** Remove trailing slashes. */
export function trimSlash(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

/** The origin of a URL, or null. */
export function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Where a service's API lives on the connected server. The administrator's
 * address counts when it is on that server (it may carry a sub-path, e.g.
 * https://example.com/vikunja); otherwise the service's usual path.
 */
export function baseOn(origin, configured, usualPath = '') {
  if (configured && originOf(configured) === origin) {
    return trimSlash(`${origin}${new URL(configured).pathname}`);
  }
  return trimSlash(`${origin}${usualPath}`);
}

/** `YYYY-MM-DD` at noon, local time, as an ISO timestamp (what Vikunja's quick add uses for a day). */
export function noonOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/** A random id for new CalDAV resources. */
export function randomId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
