// The background part: keeps the open draft where the composer dialog can
// read it, and knows whether a service is set up so the buttons only show
// when they can work.

import { loadSetup } from './assistant.js';

export const DRAFT_KEY = 'draft';
const REFRESH_EVERY_MS = 30_000;

export function createBackground(api, { now = () => Date.now() } = {}) {
  const state = { configured: false, showInReader: true, checkedAt: 0 };

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
    return state;
  }

  const forgetDraft = async () => {
    await api.storage.remove(DRAFT_KEY);
  };

  return {
    state,
    refresh,
    async activate() {
      // A draft left over from a closed tab is not kept.
      await forgetDraft();
      await refresh(true);
    },
    hooks: {
      // The composer dialog reads this: the composer's toolbar slot gets no
      // draft from the host. Only in this browser, and gone when the
      // composer closes.
      async onDraftChange(draft) {
        await api.storage.set(DRAFT_KEY, {
          subject: typeof draft?.subject === 'string' ? draft.subject : '',
          text: typeof draft?.textBody === 'string' ? draft.textBody : '',
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
