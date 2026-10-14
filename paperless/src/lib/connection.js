// Which Paperless to talk to, and with which credential.
//
// - shared: the administrator set a server URL and an API token in the
//   plugin's admin settings. Everyone uses that account.
// - personal: each user connects their own token in the host's "Connect"
//   dialog. When the administrator set only a server URL, it is suggested
//   there; otherwise the user types the address.

import { createClient, normalizeBase } from './client.js';
import { PaperlessError, errorFromResponse, toPaperlessError } from './errors.js';

export const SHARED = 'shared';
export const PERSONAL = 'personal';

/** The admin's server URL (a non-secret config field), or ''. */
export async function adminServer(api) {
  try {
    return normalizeBase(await api.admin.getConfig('serverUrl'));
  } catch {
    return '';
  }
}

/**
 * @returns {Promise<{ state: 'connected', mode: 'shared'|'personal', base: string, credentialId: string }
 *   | { state: 'disconnected', suggestedServer: string }
 *   | { state: 'error', error: PaperlessError, mode: 'shared'|'personal', suggestedServer: string }>}
 */
export async function resolveConnection(api) {
  const configured = await adminServer(api);
  if (configured) {
    let res;
    try {
      res = await api.proxy.fetch(SHARED, `${configured}/api/ui_settings/`, { headers: { Accept: 'application/json' }, responseType: 'text' });
    } catch (err) {
      return { state: 'error', error: toPaperlessError(err), mode: SHARED, suggestedServer: configured };
    }
    if (res?.ok) return { state: 'connected', mode: SHARED, base: configured, credentialId: SHARED };
    // No admin token: the users connect their own.
    if (res?.proxyError !== 'no_credential') {
      return { state: 'error', error: errorFromResponse(res || { status: 0 }), mode: SHARED, suggestedServer: configured };
    }
  }
  let accounts = [];
  try {
    accounts = (await api.proxy.accounts()) || [];
  } catch {
    accounts = [];
  }
  const mine = accounts.find((a) => a.credentialId === PERSONAL && a.connected);
  if (mine) {
    // Keep the admin's path (Paperless under /paperless) when it is the same server.
    const base = configured && new URL(configured).origin === mine.origin ? configured : normalizeBase(mine.origin);
    return { state: 'connected', mode: PERSONAL, base, credentialId: PERSONAL };
  }
  return { state: 'disconnected', suggestedServer: configured };
}

/** A client for a connected state, or a PaperlessError to show. */
export function clientFor(api, connection) {
  if (!connection || connection.state !== 'connected') {
    throw connection?.state === 'error' ? connection.error : new PaperlessError('error.not_connected');
  }
  return createClient({ proxyFetch: (...a) => api.proxy.fetch(...a), credentialId: connection.credentialId, base: connection.base });
}

/** Open the host's dialog to connect a personal token, then check it works. */
export async function connectPersonal(api, suggestedServer) {
  const result = await api.proxy.connect(PERSONAL, { mode: 'password', ...(suggestedServer ? { server: suggestedServer } : {}) });
  if (!result?.connected) return { connected: false };
  const connection = await resolveConnection(api);
  if (connection.state !== 'connected') return { connected: false };
  try {
    await clientFor(api, connection).whoAmI();
  } catch (err) {
    const e = toPaperlessError(err);
    // A wrong token is not worth keeping: the next try starts clean.
    if (e.key === 'error.token') await api.proxy.disconnect(PERSONAL).catch(() => {});
    return { connected: false, error: e };
  }
  return { connected: true, connection };
}
