// Who the user is, for the model: name, addresses, how they sign, where and
// when they are. Read from the account through the api; every piece is
// optional, and nothing here is sent until the user asks the assistant
// something.

/** The local date and time in a zone, in words. */
export function localNow(timeZone, at = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(at);
  } catch {
    return at.toISOString();
  }
}

/** { name, emails, signature, timeZone, language }; `now` is added per request with localNow. */
export async function loadPerson(api, language) {
  const safe = async (call, fallback) => {
    try { return (await call()) ?? fallback; } catch { return fallback; }
  };
  const [identities, accounts, zone, app] = await Promise.all([
    safe(() => api.user.getIdentities(), []),
    safe(() => api.user.getAccounts(), []),
    safe(() => api.user.getTimeZone(), ''),
    // Webmail 1.17.1 and later; older ones answer "unknown method".
    safe(() => api.app.getInfo(), null),
  ]);
  const list = Array.isArray(identities) ? identities : [];
  const all = Array.isArray(accounts) ? accounts : [];
  const active = all.find((a) => a?.isActive) ?? all.find((a) => a?.isDefault) ?? all[0];
  const first = list[0];
  let timeZone = typeof zone === 'string' ? zone : '';
  if (!timeZone) {
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { timeZone = ''; }
  }
  return {
    name: first?.name || active?.displayName || '',
    emails: [...new Set([...list.map((i) => i?.email), active?.email].filter((e) => typeof e === 'string' && e))],
    signature: typeof first?.textSignature === 'string' ? first.textSignature.trim() : '',
    timeZone,
    language,
    app: app && typeof app === 'object' ? app : null,
    account: active ? { email: active.email || active.username || '', server: hostOf(active.serverUrl), accounts: all.length } : null,
  };
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}
