/**
 * Reply-All Guardrail — confirmation prompt before reply-all (and optionally
 * before any send) when the recipient count crosses a threshold.
 *
 * Threshold resolution:
 *   admin `forceThreshold` (when set) and per-user `threshold` are compared;
 *   the smaller value wins. This lets admins enforce a stricter floor without
 *   stopping users from tightening it further on their own machine.
 *
 * Migration notes vs. the pre-sandbox plugin:
 *   - The custom CSS-in-JS modal is GONE — replaced by api.ui.confirm.
 *     The dialog can no longer render a per-recipient list inline (the host
 *     confirm is a single message string); the list is included in the
 *     message body as plain text instead.
 *   - All hooks are registered statically via the `hooks` export.
 *   - Storage / admin reads are awaited.
 */

// The bare, lowercased address from "Name <addr>" (how the host formats
// outgoing recipients) or a plain "addr".
function normaliseEmail(addr) {
  if (!addr) return '';
  const s = String(addr).trim();
  const m = s.match(/<([^<>]*)>\s*$/);
  return (m ? m[1] : s).trim().toLowerCase();
}

function collectOutgoingRecipients(email, excludeAddresses) {
  const seen = new Set();
  const out = [];
  for (const { field, list } of [
    { field: 'To', list: email.to || [] },
    { field: 'Cc', list: email.cc || [] },
    { field: 'Bcc', list: email.bcc || [] },
  ]) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      const n = normaliseEmail(a);
      if (!n || excludeAddresses.has(n) || seen.has(n)) continue;
      seen.add(n);
      out.push({ field, address: String(a).trim() });
    }
  }
  return out;
}

function collectReplyAllRecipients(originalEmail, excludeAddresses) {
  const seen = new Set();
  const out = [];
  for (const { field, list } of [
    { field: 'From', list: originalEmail.from || [] },
    { field: 'To', list: originalEmail.to || [] },
    { field: 'Cc', list: originalEmail.cc || [] },
  ]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const n = normaliseEmail(entry?.email);
      if (!n || excludeAddresses.has(n) || seen.has(n)) continue;
      seen.add(n);
      const display = entry?.name
        ? `${entry.name} <${entry.email}>`
        : String(entry?.email || '');
      out.push({ field, address: display });
    }
  }
  return out;
}

// ─── Module state, populated by activate() ────────────────────

let pluginApi = null;
let myAddresses = new Set();

// Reply-alls the user already confirmed, so the send-time check doesn't ask
// a second time for the same message. Each entry holds the recipients the
// user agreed to and the original's Message-ID, and expires after a while.
const CONFIRMED_TTL_MS = 15 * 60_000;
let confirmedReplyAlls = [];

function headerValue(email, name) {
  const headers = email && email.headers;
  if (!Array.isArray(headers)) return '';
  const wanted = name.toLowerCase();
  const h = headers.find((x) => x && String(x.name || '').toLowerCase() === wanted);
  return h ? String(h.value || '').trim() : '';
}

function stripAngles(id) {
  return String(id || '').trim().replace(/^<|>$/g, '');
}

function rememberConfirmedReplyAll(originalEmail, recipients) {
  const now = Date.now();
  confirmedReplyAlls = confirmedReplyAlls.filter((c) => now - c.at < CONFIRMED_TTL_MS);
  confirmedReplyAlls.push({
    at: now,
    messageId: stripAngles(headerValue(originalEmail, 'Message-ID')),
    recipients: new Set(recipients.map((r) => normaliseEmail(r.address))),
  });
}

/**
 * Whether this send is a reply-all the user already confirmed: it goes to
 * no one outside the confirmed recipients and, when both Message-IDs are
 * known, answers the confirmed message. Recipients added in the composer
 * after confirming still trigger the warning. A match is used up, so a
 * later send to the same people asks again.
 */
function takeConfirmedReplyAll(email, recipients) {
  const now = Date.now();
  confirmedReplyAlls = confirmedReplyAlls.filter((c) => now - c.at < CONFIRMED_TTL_MS);
  const inReplyTo = stripAngles(email.inReplyTo);
  const idx = confirmedReplyAlls.findIndex((c) =>
    (!inReplyTo || !c.messageId || c.messageId === inReplyTo)
    && recipients.every((r) => c.recipients.has(normaliseEmail(r.address))));
  if (idx < 0) return false;
  confirmedReplyAlls.splice(idx, 1);
  return true;
}

const ADMIN_TTL_MS = 30_000;
let cachedAdminThreshold = null;
let cachedAdminAt = 0;
let adminFetchPromise = null;

function fetchAdminThreshold() {
  const fresh = Date.now() - cachedAdminAt < ADMIN_TTL_MS;
  if (fresh) return Promise.resolve(cachedAdminThreshold);
  if (adminFetchPromise) return adminFetchPromise;
  adminFetchPromise = (async () => {
    try {
      const v = await pluginApi.admin.getConfig('forceThreshold');
      const n = Number(v);
      cachedAdminThreshold = Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
    } catch (err) {
      pluginApi.log.warn('Could not load admin forceThreshold', err);
      cachedAdminThreshold = null;
    } finally {
      cachedAdminAt = Date.now();
      adminFetchPromise = null;
    }
    return cachedAdminThreshold;
  })();
  return adminFetchPromise;
}

function effectiveThreshold() {
  const userRaw = Number(pluginApi.plugin.settings.threshold);
  const userN = Number.isFinite(userRaw) && userRaw >= 1 ? Math.floor(userRaw) : 5;
  if (cachedAdminThreshold !== null && cachedAdminThreshold < userN) {
    return cachedAdminThreshold;
  }
  return userN;
}

function excludeSet() {
  return pluginApi.plugin.settings.excludeSelf === false ? new Set() : myAddresses;
}

async function rememberMyAddress(addr) {
  const n = normaliseEmail(addr);
  if (!n || myAddresses.has(n)) return;
  myAddresses.add(n);
  await pluginApi.storage.set('myAddresses', [...myAddresses]);
}

function recipientsToMessage(recipients) {
  return recipients
    .map((r) => `[${r.field}] ${r.address}`)
    .join('\n');
}

async function promptForRecipients(recipients, mode) {
  const isReplyAll = mode === 'reply-all';
  const title = isReplyAll
    ? `Reply to all ${recipients.length} recipients?`
    : `Send to ${recipients.length} recipients?`;
  const body = isReplyAll
    ? `Replying to all would deliver this message to ${recipients.length} recipients. Confirm only if you intend to reach all of them.\n\n${recipientsToMessage(recipients)}`
    : `${recipients.length} recipients are about to receive this message. Confirm only if you intend to send to all of them.\n\n${recipientsToMessage(recipients)}`;

  return pluginApi.ui.confirm({
    title,
    message: body,
    confirmLabel: isReplyAll ? 'Reply all' : 'Send anyway',
    cancelLabel: 'Cancel',
    danger: true,
  });
}

// ─── Hooks ────────────────────────────────────────────────────

export const hooks = {
  async onBeforeReplyAll(ctx) {
    if (!ctx?.originalEmail || !pluginApi) return;
    await fetchAdminThreshold();

    const recipients = collectReplyAllRecipients(ctx.originalEmail, excludeSet());
    const threshold = effectiveThreshold();
    if (recipients.length < threshold) return;

    const ok = await promptForRecipients(recipients, 'reply-all');
    if (!ok) {
      pluginApi.toast.info('Send cancelled');
      return false;
    }
    rememberConfirmedReplyAll(ctx.originalEmail, recipients);
  },

  async onBeforeEmailSend(email) {
    if (!email || !pluginApi) return;

    // Always learn the user's send-addresses so excludeSelf works the moment
    // the user enables it.
    void rememberMyAddress(email.fromEmail);

    if (pluginApi.plugin.settings.warnOnSend === false) return;

    await fetchAdminThreshold();
    const recipients = collectOutgoingRecipients(email, excludeSet());
    const threshold = effectiveThreshold();
    if (recipients.length < threshold) return;
    // Already confirmed when the user clicked reply-all.
    if (takeConfirmedReplyAll(email, recipients)) return;

    const ok = await promptForRecipients(recipients, 'send');
    if (!ok) {
      pluginApi.toast.info('Send cancelled');
      return false;
    }
  },
};

// ─── Activate ─────────────────────────────────────────────────

export async function activate(api) {
  pluginApi = api;

  const stored = (await api.storage.get('myAddresses')) || [];
  myAddresses = new Set((Array.isArray(stored) ? stored : []).map(normaliseEmail).filter(Boolean));

  // Pre-warm so the first send doesn't race the network.
  fetchAdminThreshold().catch(() => {});

  api.log.info('Reply-All Guardrail plugin activated');
}
