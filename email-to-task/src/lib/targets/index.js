import { vikunja } from './vikunja.js';

/** In the order the dialog lists them. */
export const TARGETS = [vikunja];

export function targetById(id) {
  return TARGETS.find((t) => t.id === id) ?? null;
}

/**
 * Admin settings (configSchema), read once. A user without access to them
 * still gets the defaults.
 */
export async function loadConfig(api) {
  try {
    const all = (await api.admin.getAllConfig()) ?? {};
    return {
      vikunjaUrl: typeof all.vikunjaUrl === 'string' ? all.vikunjaUrl.trim() : '',
      todoistApiUrl: typeof all.todoistApiUrl === 'string' ? all.todoistApiUrl.trim() : '',
      caldavUrl: typeof all.caldavUrl === 'string' ? all.caldavUrl.trim() : '',
    };
  } catch {
    return { vikunjaUrl: '', todoistApiUrl: '', caldavUrl: '' };
  }
}

/** The connected account of each credential: `{ vikunja: { origin, username }, ... }`. */
export async function loadAccounts(api) {
  try {
    const list = (await api.proxy.accounts()) ?? [];
    const out = {};
    for (const a of list) if (a?.connected && a.origin) out[a.credentialId] = { origin: a.origin, username: a.username };
    return out;
  } catch {
    return {};
  }
}

/** What a target's calls need, or null when its account isn't connected. */
export function contextFor(api, target, { config, accounts, manualUrl }) {
  if (!target.credentialId) return { api, config };
  const account = accounts[target.credentialId];
  if (!account) return null;
  return { api, config, origin: account.origin, username: account.username, manualUrl };
}
