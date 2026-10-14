/**
 * External Link Warning — intercepts clicks on external links and asks the
 * user to confirm before navigating to a domain that isn't on the trusted
 * list.
 *
 * Trusted-domain sources (merged, de-duplicated):
 *   1. Admin-managed list (api.admin.getConfig('trustedDomains'))
 *   2. Per-user list from plugin settings (trustedDomainsCsv)
 *   3. Locally-trusted domains the user explicitly chose to always trust
 *      (kept in plugin storage)
 *
 * Migrated to the sandboxed contract:
 *   - The custom CSS-in-JS modal is GONE — we now use api.ui.confirm.
 *   - window.open is replaced with api.ui.openExternalUrl.
 *   - All storage / admin lookups are awaited.
 *   - The hook is registered statically via the `hooks` export.
 *
 * api.ui.confirm has two buttons, so trusting a domain is a second, explicit
 * question: "Continue" in the first dialog opens the link once; only the
 * "Always trust <domain>" button in the follow-up dialog remembers it. The
 * follow-up is only asked when the `rememberLocalChoices` setting is on.
 */

// English fallbacks; the manifest's locales carry the translations.
const FALLBACK = {
  'dialog.title': 'Open external link?',
  'dialog.message': "You're about to visit {host}.\n\n{href}\n\nThis domain isn't on your trusted list. Only continue if you recognise it.",
  'dialog.continue': 'Continue',
  'dialog.cancel': 'Cancel',
  'trust.title': 'Trust {host} from now on?',
  'trust.message': 'Links to {host} and its subdomains will open without this warning on this device.',
  'trust.confirm': 'Always trust {host}',
  'trust.cancel': 'Just this once',
  trustedAdded: '{host} added to your trusted domains',
};

function tr(key, vars) {
  const i18n = pluginApi && pluginApi.i18n;
  if (i18n && typeof i18n.has === 'function' && i18n.has(key)) return i18n.t(key, vars);
  return String(FALLBACK[key] || key).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
}

function parseDomains(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((d) => normaliseDomain(String(d))).filter(Boolean);
  }
  return String(input)
    .split(/[\s,;]+/)
    .map(normaliseDomain)
    .filter(Boolean);
}

function normaliseDomain(raw) {
  let d = String(raw).trim().toLowerCase();
  if (!d) return '';
  d = d.replace(/^\*\./, '');
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/\/.*$/, '');
  return d;
}

function hostnameFromHref(href) {
  try {
    // No `window.location` reliable origin inside a background iframe; treat
    // the href as absolute. Relative URLs (without a scheme) are very rare in
    // email bodies and aren't external anyway, so we ignore them.
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isTrusted(hostname, list) {
  if (!hostname) return false;
  for (const d of list) {
    if (!d) continue;
    if (hostname === d) return true;
    if (hostname.endsWith('.' + d)) return true;
  }
  return false;
}

// ─── Module-level state, populated by activate() ──────────────

let pluginApi = null;
let cachedAdminDomains = [];
let adminFetched = false;
let adminFetchPromise = null;
let localTrusted = [];

function fetchAdminDomains() {
  if (adminFetched) return Promise.resolve(cachedAdminDomains);
  if (adminFetchPromise) return adminFetchPromise;
  adminFetchPromise = (async () => {
    try {
      const value = await pluginApi.admin.getConfig('trustedDomains');
      cachedAdminDomains = parseDomains(value);
    } catch (err) {
      pluginApi.log.warn('Could not load admin trusted-domains list', err);
      cachedAdminDomains = [];
    } finally {
      adminFetched = true;
    }
    return cachedAdminDomains;
  })();
  return adminFetchPromise;
}

async function getTrustedList() {
  const userDomains = parseDomains(pluginApi.plugin.settings.trustedDomainsCsv);
  const adminDomains = await fetchAdminDomains();
  return [...new Set([...adminDomains, ...userDomains, ...localTrusted])];
}

async function addLocalTrust(domain) {
  if (!domain || localTrusted.includes(domain)) return;
  localTrusted.push(domain);
  await pluginApi.storage.set('localTrusted', localTrusted);
  pluginApi.toast.success(tr('trustedAdded', { host: domain }));
}

/** Ask about an untrusted link, then open it if the user agrees. */
async function confirmAndOpen(href, hostname) {
  const proceed = await pluginApi.ui.confirm({
    title: tr('dialog.title'),
    message: tr('dialog.message', { host: hostname, href }),
    confirmLabel: tr('dialog.continue'),
    cancelLabel: tr('dialog.cancel'),
  });
  if (!proceed) return;

  if (pluginApi.plugin.settings.rememberLocalChoices !== false) {
    const always = await pluginApi.ui.confirm({
      title: tr('trust.title', { host: hostname }),
      message: tr('trust.message', { host: hostname }),
      confirmLabel: tr('trust.confirm', { host: hostname }),
      cancelLabel: tr('trust.cancel'),
    });
    if (always) await addLocalTrust(hostname);
  }

  await pluginApi.ui.openExternalUrl(href, '_blank');
}

// ─── Activate ─────────────────────────────────────────────────

export async function activate(api) {
  pluginApi = api;

  const stored = await api.storage.get('localTrusted');
  localTrusted = Array.isArray(stored) ? stored.slice() : [];

  // Pre-warm so the first click doesn't race against the network.
  fetchAdminDomains().catch(() => {});

  api.log.info('External Link Warning plugin activated');
}

// ─── Hooks ────────────────────────────────────────────────────

export const hooks = {
  async onBeforeExternalLink(ctx) {
    if (!pluginApi || !ctx?.href) return;

    const hostname = hostnameFromHref(ctx.href);
    if (!hostname) return; // mailto:, tel:, relative URLs — leave alone

    const trusted = await getTrustedList();
    if (isTrusted(hostname, trusted)) return; // pass through

    // Cancel the host's navigation right away and run the dialogs on our
    // own. Awaiting them here would let the host's hook timeout open the
    // link behind the user's back while they are still deciding.
    confirmAndOpen(ctx.href, hostname).catch((err) => {
      pluginApi.log.warn('External link dialog failed', err);
    });
    return false;
  },
};
