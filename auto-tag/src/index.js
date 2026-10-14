/**
 * Auto Tag Plugin — automatically tags incoming emails based on rules.
 *
 * Demonstrates:
 *   - `hooks` export with onNewEmailReceived (runs in the background iframe)
 *   - `activate(api)` for one-shot init (load lifetime counter from storage)
 *   - `api.plugin.onSettingsChange` to pick up new settings without a reload
 *   - `api.email.setKeyword` (needs `email:write`) to tag a message
 *   - Async storage (`await api.storage.get/set`)
 *
 * The hook gets the new message the way the mail view sees it: an id,
 * `from` as a list of { name, email }, a subject, a preview and sometimes
 * its headers. Any of these can be missing, so every rule reads them
 * defensively.
 */

let rules = [];
let totalTagged = 0;
let pluginApi = null;

/** All sender names and addresses as one lowercase string. */
function fromText(email) {
  const from = email && email.from;
  if (!from) return '';
  if (typeof from === 'string') return from.toLowerCase();
  const list = Array.isArray(from) ? from : [from];
  return list
    .filter(Boolean)
    .map((a) => (typeof a === 'string' ? a : `${a.name || ''} <${a.email || ''}>`))
    .join(', ')
    .toLowerCase();
}

function subjectText(email) {
  return String((email && email.subject) || '').toLowerCase();
}

/** Whether the message carries a header, for JMAP `[{name, value}]` or a plain object. */
function hasHeader(email, name) {
  const headers = email && email.headers;
  if (!headers) return false;
  const wanted = name.toLowerCase();
  if (Array.isArray(headers)) {
    return headers.some((h) => h && String(h.name || '').toLowerCase() === wanted);
  }
  if (typeof headers === 'object') {
    return Object.keys(headers).some((k) => k.toLowerCase() === wanted);
  }
  return false;
}

function buildRules(settings) {
  const out = [];

  // GitHub first: its notifications also come from a noreply address, and
  // only the first matching rule tags a message.
  if (settings.tagGithub !== false) {
    out.push({
      name: 'GitHub',
      keyword: '$github',
      check: (email) => {
        const from = fromText(email);
        return (
          from.includes('notifications@github.com') ||
          from.includes('noreply@github.com')
        );
      },
    });
  }

  if (settings.tagNewsletter !== false) {
    out.push({
      name: 'Newsletter',
      keyword: '$newsletter',
      check: (email) => {
        const from = fromText(email);
        const subject = subjectText(email);
        return (
          hasHeader(email, 'List-Unsubscribe') ||
          from.includes('newsletter') ||
          from.includes('noreply') ||
          from.includes('no-reply') ||
          subject.includes('unsubscribe') ||
          subject.includes('weekly digest') ||
          subject.includes('monthly update')
        );
      },
    });
  }

  if (settings.tagInvoice !== false) {
    out.push({
      name: 'Invoice',
      keyword: '$invoice',
      check: (email) => {
        const subject = subjectText(email);
        return (
          subject.includes('invoice') ||
          subject.includes('receipt') ||
          subject.includes('payment confirmation') ||
          subject.includes('order confirmation') ||
          subject.includes('billing statement')
        );
      },
    });
  }

  return out;
}

export async function activate(api) {
  pluginApi = api;
  rules = buildRules(api.plugin.settings || {});
  api.plugin.onSettingsChange((settings) => {
    rules = buildRules(settings || {});
  });
  totalTagged = Number((await api.storage.get('totalTagged')) || 0);

  if (rules.length === 0) {
    api.log.info('Auto Tag: no rules enabled');
    return;
  }
  api.log.info(`Auto Tag: ${rules.length} rule(s) active, ${totalTagged} message(s) tagged so far`);
}

export const hooks = {
  async onNewEmailReceived(email) {
    if (!pluginApi || rules.length === 0) return;
    if (!email || typeof email !== 'object') return;
    const emailId = email.id || email.emailId;
    if (!emailId) return;

    const rule = rules.find((r) => {
      try { return r.check(email); } catch { return false; }
    });
    if (!rule) return;
    if (email.keywords && email.keywords[rule.keyword]) return; // already tagged

    try {
      await pluginApi.email.setKeyword(String(emailId), rule.keyword, email.accountId || undefined);
    } catch (err) {
      pluginApi.log.warn(`Auto Tag: could not tag "${email.subject || ''}" as ${rule.keyword}`, err);
      return;
    }
    pluginApi.log.info(`Auto Tag: tagged "${email.subject || ''}" as ${rule.keyword} (rule "${rule.name}")`);
    totalTagged++;
    // Fire-and-forget; we don't block the hook on persistence.
    void pluginApi.storage.set('totalTagged', totalTagged);
  },
};
