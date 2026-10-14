// The logic behind the "Create task" dialog, without any UI, so it can be
// tested on its own: what the dialog is filled in with, and what happens on
// "Create".

import { findDueDate } from './due-date.js';
import { detectPriority } from './priority.js';
import { messageLink, taskDescription, taskTitle, webmailBase } from './message.js';
import { TARGETS, contextFor, loadAccounts, loadConfig, targetById } from './targets/index.js';
import { loadPrefs, savePrefs } from './task-store.js';
import { TaskError, toTaskError } from './errors.js';

/** At most this many messages in one go. */
export const MAX_MESSAGES_PER_DIALOG = 25;

function formatDate(iso, locale) {
  try {
    return new Intl.DateTimeFormat(locale || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** One message as a dialog item. */
export function itemFor(email, { t, base, locale, withExcerpt }) {
  const link = base ? messageLink(base, email.id) : '';
  const due = findDueDate(email);
  return {
    emailId: email.id,
    subject: email.subject ?? '',
    title: taskTitle(email.subject) || t('dialog.no_subject'),
    description: taskDescription(email, { link, t, withExcerpt, formatDate: (iso) => formatDate(iso, locale) }),
    link,
    due: due?.date ?? '',
    dueMatch: due?.match ?? '',
    priority: detectPriority(email),
    existing: [],
  };
}

/**
 * Everything the dialog starts with: the messages, the services and which
 * of them can be used, the user's last choices.
 */
export async function prepareDialog(api, { emailIds, location = globalThis.location } = {}) {
  const t = (k, v) => api.i18n.t(k, v);
  const locale = api.i18n.getLocale?.() ?? 'en';
  const ids = [...new Set((emailIds ?? []).filter((id) => typeof id === 'string' && id))];
  const [config, accounts, prefs] = await Promise.all([loadConfig(api), loadAccounts(api), loadPrefs(api)]);
  const base = webmailBase(location);
  const items = [];
  const missing = [];
  for (const id of ids.slice(0, MAX_MESSAGES_PER_DIALOG)) {
    let email = null;
    try {
      email = await api.email.get(id);
    } catch {
      email = null;
    }
    if (!email) {
      missing.push(id);
      continue;
    }
    const item = itemFor(email, { t, base, locale, withExcerpt: prefs.withExcerpt !== false });
    items.push(item);
  }
  const targets = TARGETS.map((target) => ({
    id: target.id,
    name: target.name,
    available: true,
    connected: !target.credentialId || !!accounts[target.credentialId],
  })).filter((target) => target.available);
  const remembered = targets.find((x) => x.id === prefs.target);
  const target = remembered?.id ?? targets.find((x) => x.connected)?.id ?? targets[0]?.id ?? null;
  return {
    items,
    missing,
    skipped: Math.max(0, ids.length - MAX_MESSAGES_PER_DIALOG),
    config,
    accounts,
    prefs,
    targets,
    target,
  };
}

/** The projects or lists of a target, or [] when it has none to choose from. */
export async function containersFor(api, state, targetId) {
  const target = targetById(targetId);
  if (!target) return [];
  const ctx = contextFor(api, target, { config: state.config, accounts: state.accounts, manualUrl: state.prefs.caldavUrl });
  if (!ctx) throw new TaskError('not_connected');
  return target.containers(ctx);
}

/** Ask the host to connect a target's account; resolves to the fresh accounts. */
export async function connectTarget(api, state, targetId) {
  const target = targetById(targetId);
  if (!target?.credentialId) return state.accounts;
  const server = target.suggestedServer?.(state.config);
  await api.proxy.connect(target.credentialId, { mode: 'password', ...(server ? { server } : {}) });
  return loadAccounts(api);
}


/**
 * Create one task per item, one after the other. `onProgress(done, total)`.
 * Resolves to `{ created: [{ emailId, ref }], failed: [{ emailId, error }] }`;
 * the created ones are remembered and their messages marked.
 */
export async function createTasks(api, state, form, onProgress = () => {}) {
  const target = targetById(form.target);
  if (!target) throw new TaskError('unknown');
  const ctx = contextFor(api, target, { config: state.config, accounts: state.accounts, manualUrl: state.prefs.caldavUrl });
  if (!ctx) throw new TaskError('not_connected');
  const created = [];
  const failed = [];
  let done = 0;
  for (const item of form.items) {
    onProgress(done, form.items.length);
    const title = String(item.title ?? '').trim();
    if (!title) {
      failed.push({ emailId: item.emailId, error: new TaskError('no_title') });
      done++;
      continue;
    }
    try {
      const result = await target.create(ctx, {
        title,
        description: String(item.description ?? ''),
        due: item.due || null,
        priority: item.priority || 'none',
        containerId: form.containerId || null,
        link: item.link || null,
      });
      created.push({
        emailId: item.emailId,
        ref: { target: target.id, taskId: result.taskId, title, url: result.url ?? null, containerId: form.containerId || null },
      });
    } catch (err) {
      const error = toTaskError(err);
      failed.push({ emailId: item.emailId, error });
      // The same answer would come for every other message.
      if (['auth', 'not_connected', 'forbidden', 'rate_limited', 'quota', 'no_project', 'no_task_list', 'permission', 'unreachable', 'blocked'].includes(error.code)) {
        for (const rest of form.items.slice(done + 1)) failed.push({ emailId: rest.emailId, error, skipped: true });
        break;
      }
    }
    done++;
  }
  onProgress(form.items.length, form.items.length);
  await savePrefs(api, {
    target: target.id,
    containers: { ...state.prefs.containers, ...(form.containerId ? { [target.id]: form.containerId } : {}) },
  });
  return { created, failed };
}
