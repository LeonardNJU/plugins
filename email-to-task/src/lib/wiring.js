// The plugin's buttons, hooks and badge, separate from src/index.js so they
// can be tested with a fake api.

import { loadTasks, tasksFor } from './task-store.js';

export const SINGLE_SURFACES = ['message-row-actions', 'reader-actions'];
export const BULK_SURFACE = 'message-bulk-actions';
export const ACTION_ID = 'create-task';
export const BULK_ACTION_ID = 'create-tasks';
export const BADGE_KEY = 'email-to-task';

export function createWiring(initialApi) {
  let api = initialApi;
  let openEmailId = null;
  let taskMap = {};
  let dialogOpen = false;

  const t = (key, vars) => api.i18n.t(key, vars);

  async function setActions() {
    const single = [{ id: ACTION_ID, label: t('action.create'), icon: 'checklist', order: 60 }];
    for (const surface of SINGLE_SURFACES) await api.ui.setActions(surface, single);
    await api.ui.setActions(BULK_SURFACE, [{ id: BULK_ACTION_ID, label: t('action.create_bulk'), icon: 'checklist', order: 60 }]);
  }

  async function reloadTasks() {
    try {
      taskMap = await loadTasks(api);
    } catch {
      taskMap = {};
    }
  }

  /** Open the dialog for these messages. Not awaited by hooks: it waits for the user. */
  async function openDialog(emailIds) {
    const ids = (emailIds ?? []).filter((id) => typeof id === 'string' && id);
    if (!ids.length) {
      api.toast.info(t('shortcut.no_message'));
      return null;
    }
    if (dialogOpen) return null;
    dialogOpen = true;
    try {
      const result = await api.ui.openDialog({
        title: ids.length > 1 ? t('dialog.heading_many', { count: ids.length }) : t('dialog.heading'),
        slot: 'plugin-dialog',
        extraProps: { emailIds: ids },
        width: 560,
      });
      await reloadTasks();
      return result;
    } catch (err) {
      api.log.error('dialog failed', err);
      api.toast.error(t('error.unknown'));
      return null;
    } finally {
      dialogOpen = false;
    }
  }

  const hooks = {
    onAction({ surface, actionId, context } = {}) {
      if (actionId === ACTION_ID && SINGLE_SURFACES.includes(surface)) {
        void openDialog(context?.emailId ? [context.emailId] : []);
      } else if (actionId === BULK_ACTION_ID && surface === BULK_SURFACE) {
        void openDialog(Array.isArray(context?.emailIds) ? context.emailIds : []);
      }
    },
    onEmailOpen(email) {
      openEmailId = email?.id ?? null;
    },
    onEmailClose({ emailId } = {}) {
      if (!emailId || emailId === openEmailId) openEmailId = null;
    },
    onEmailListItemRender(badges, { email } = {}) {
      const refs = tasksFor(taskMap, email?.id);
      if (!refs.length) return undefined;
      const last = refs[refs.length - 1];
      return [...(Array.isArray(badges) ? badges : []), {
        key: BADGE_KEY,
        label: t('badge.label'),
        title: refs.length > 1 ? t('badge.title_many', { count: refs.length }) : t('badge.title', { title: last.title }),
        color: 'var(--color-primary)',
      }];
    },
  };

  return {
    hooks,
    async activate(next) {
      if (next) api = next;
      await reloadTasks();
      await setActions();
      api.i18n.onLocaleChange?.(() => { void setActions(); });
    },
    fromShortcut() {
      void openDialog(openEmailId ? [openEmailId] : []);
    },
    openDialog,
    /** For tests. */
    get openEmailId() { return openEmailId; },
  };
}
