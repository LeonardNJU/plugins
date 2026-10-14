// How the plugin names the connected Nextcloud account. It is whoever was
// signed in on Nextcloud's page when the user connected, which can be a
// different person than the mail account, so the text names Nextcloud and
// both the display name and the login.

import { hostOf } from './format.js';

/** "Alice Example (alice)", or just one of them when they are the same or one is missing. */
export function accountName(conn) {
  const name = String(conn?.displayName ?? '').trim();
  const login = String(conn?.userId ?? '').trim() || String(conn?.username ?? '').trim();
  if (name && login && name.toLowerCase() !== login.toLowerCase()) return `${name} (${login})`;
  return name || login;
}

/** "Connected to Nextcloud at cloud.example.com as Alice Example (alice)". */
export function connectedText(t, conn) {
  return t('connect.account', { host: hostOf(conn?.origin), user: accountName(conn) });
}
