// Which messages have tasks, kept in the plugin's storage:
//   tasks: { [emailId]: [{ target, taskId, title, url, createdAt }] }
// plus the user's last choices in the dialog.

export const PREFS_KEY = 'prefs';

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
