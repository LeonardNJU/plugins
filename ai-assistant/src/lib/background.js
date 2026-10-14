// The background part: the Assistant button in the composer's bottom bar
// (a host action with the Alt+A shortcut), which opens the assistant
// dialog for that composer; the subject of the open draft for the "write"
// prompt; and whether a service is set up, so the buttons only show when
// they can work.

import { loadSetup } from './assistant.js';

export const DRAFT_KEY = 'draft';
export const COMPOSER_SURFACE = 'composer-toolbar-actions';
export const ACTION_ID = 'assistant';
export const SHORTCUT = 'Alt+A';
const REFRESH_EVERY_MS = 30_000;

export function createBackground(api, { now = () => Date.now() } = {}) {
  const state = { configured: false, showInReader: true, checkedAt: 0 };
  let shownAction = null;
  let dialogOpen = false;
  const t = (key, vars) => api.i18n.t(key, vars);

  async function syncAction() {
    // Only offered while a service is set up; only sent when that changes.
    if (shownAction === state.configured) return;
    shownAction = state.configured;
    try {
      await api.ui.setActions(COMPOSER_SURFACE, state.configured
        ? [{ id: ACTION_ID, label: t('composer.open'), icon: 'sparkles', shortcut: SHORTCUT }]
        : []);
    } catch (err) {
      shownAction = null;
      api.log?.warn?.('setActions failed', err?.message ?? err);
    }
  }

  async function refresh(force = false) {
    // Look again at once while nothing is set up (or the last look failed);
    // once a service is known, at most every 30 s.
    if (!force && state.configured && now() - state.checkedAt < REFRESH_EVERY_MS) return state;
    state.checkedAt = now();
    try {
      const setup = await loadSetup(api);
      state.configured = !!setup.endpoint;
      state.showInReader = setup.prefs.showInReader !== false;
    } catch {
      state.configured = false;
    }
    await syncAction();
    return state;
  }

  /** The assistant dialog for one composer. Not awaited by hooks: it waits for the user. */
  async function openAssistant(composerId) {
    if (typeof composerId !== 'string' || !composerId || dialogOpen) return null;
    dialogOpen = true;
    try {
      return await api.ui.openDialog({
        title: t('composer.title'),
        slot: 'plugin-dialog',
        width: 680,
        extraProps: { composerId },
      });
    } catch (err) {
      api.log?.warn?.('assistant dialog failed', err?.message ?? err);
      return null;
    } finally {
      dialogOpen = false;
    }
  }

  const forgetDraft = async () => {
    await api.storage.remove(DRAFT_KEY);
  };

  return {
    state,
    refresh,
    openAssistant,
    async activate() {
      // A draft left over from a closed tab is not kept.
      await forgetDraft();
      await refresh(true);
    },
    hooks: {
      onAction({ surface, actionId, context } = {}) {
        if (surface === COMPOSER_SURFACE && actionId === ACTION_ID) void openAssistant(context?.composerId);
      },
      // Only the subject: the dialog reads the text itself from the composer.
      async onDraftChange(draft) {
        await api.storage.set(DRAFT_KEY, {
          subject: typeof draft?.subject === 'string' ? draft.subject : '',
          at: now(),
        });
      },
      // The draft is not cleared here: the host may deliver this after the
      // first onDraftChange of the new composer.
      async onComposerOpen() {
        await refresh();
      },
      async onComposerClose() {
        await forgetDraft();
      },
      async onEmailOpen() {
        await refresh();
      },
    },
    shouldShow: {
      reader: () => state.configured && state.showInReader,
      thread: (ctx) => state.configured && state.showInReader && Array.isArray(ctx?.emailIds) && ctx.emailIds.length > 1,
      composer: () => state.configured,
    },
  };
}
