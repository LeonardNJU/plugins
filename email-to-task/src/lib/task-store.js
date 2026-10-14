// Which messages have tasks, kept in the plugin's storage:
//   tasks: { [emailId]: [{ target, taskId, title, url, createdAt }] }
// plus the user's last choices in the dialog.

export const TASKS_KEY = 'tasks';
export const PREFS_KEY = 'prefs';
/** Messages remembered at most; the oldest are dropped first. */
export const MAX_MESSAGES = 2000;

export async function loadTasks(api) {
  const raw = await api.storage.get(TASKS_KEY);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function tasksFor(map, emailId) {
  const list = map?.[emailId];
  return Array.isArray(list) ? list : [];
}

function newest(list) {
  return list.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), '');
}

/** Add task refs for messages and keep the store within MAX_MESSAGES. */
export async function rememberTasks(api, entries, now = new Date()) {
  const map = await loadTasks(api);
  for (const { emailId, ref } of entries) {
    map[emailId] = [...tasksFor(map, emailId), { ...ref, createdAt: now.toISOString() }];
  }
  const ids = Object.keys(map);
  if (ids.length > MAX_MESSAGES) {
    ids.sort((a, b) => newest(map[a]).localeCompare(newest(map[b])));
    for (const id of ids.slice(0, ids.length - MAX_MESSAGES)) delete map[id];
  }
  await api.storage.set(TASKS_KEY, map);
  return map;
}

/** Forget one task of a message (it was deleted in the service). */
export async function forgetTask(api, emailId, taskId) {
  const map = await loadTasks(api);
  const left = tasksFor(map, emailId).filter((r) => r.taskId !== taskId);
  if (left.length) map[emailId] = left;
  else delete map[emailId];
  await api.storage.set(TASKS_KEY, map);
  return map;
}

export const DEFAULT_PREFS = { target: null, containers: {}, after: 'keyword', withExcerpt: true, caldavUrl: '' };

export async function loadPrefs(api) {
  const raw = await api.storage.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

export async function savePrefs(api, patch) {
  const next = { ...(await loadPrefs(api)), ...patch };
  await api.storage.set(PREFS_KEY, next);
  return next;
}
