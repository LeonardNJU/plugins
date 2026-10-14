import { describe, expect, it } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { createWiring } from '../src/lib/wiring.js';

function setup(handlers = {}) {
  const api = fakeApi({
    translations: { en: { 'action.create': 'Create task', 'action.create_bulk': 'Create tasks', 'badge.label': 'Task', 'badge.title': 'Task: {title}' } },
    handlers: { 'ui.openDialog': async () => ({ created: ['M1'] }), ...handlers },
  });
  return { api, wiring: createWiring(api) };
}

describe('buttons', () => {
  it('puts "Create task" on message rows and the reader, "Create tasks" on the selection toolbar', async () => {
    const { api, wiring } = setup();
    await wiring.activate(api);
    const set = Object.fromEntries(api.calls('ui.setActions').map((c) => [c.args[0], c.args[1]]));
    expect(Object.keys(set).sort()).toEqual(['message-bulk-actions', 'message-row-actions', 'reader-actions']);
    expect(set['message-row-actions']).toEqual([{ id: 'create-task', label: 'Create task', icon: 'checklist', order: 60 }]);
    expect(set['message-bulk-actions'][0]).toMatchObject({ id: 'create-tasks', label: 'Create tasks' });
  });

  it('relabels the buttons when the language changes', async () => {
    const { api, wiring } = setup();
    await wiring.activate(api);
    api.i18n.addTranslations('de', { 'action.create': 'Aufgabe erstellen' });
    api.setLocale('de');
    await new Promise((r) => setTimeout(r, 0));
    const last = api.calls('ui.setActions').filter((c) => c.args[0] === 'reader-actions').pop();
    expect(last.args[1][0].label).toBe('Aufgabe erstellen');
  });
});

describe('clicks', () => {
  it('opens the dialog for the clicked message', async () => {
    const { api, wiring } = setup();
    await wiring.activate(api);
    wiring.hooks.onAction({ surface: 'reader-actions', actionId: 'create-task', context: { emailId: 'M1' } });
    await new Promise((r) => setTimeout(r, 0));
    const [call] = api.calls('ui.openDialog');
    expect(call.args[0]).toMatchObject({ slot: 'plugin-dialog', extraProps: { emailIds: ['M1'] } });
  });

  it('opens it for all selected messages from the selection toolbar', async () => {
    const { api, wiring } = setup();
    wiring.hooks.onAction({ surface: 'message-bulk-actions', actionId: 'create-tasks', context: { emailIds: ['M1', 'M2'] } });
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls('ui.openDialog')[0].args[0].extraProps).toEqual({ emailIds: ['M1', 'M2'] });
  });

  it('ignores other surfaces and actions, and returns before the user answers', () => {
    const { api, wiring } = setup({ 'ui.openDialog': () => new Promise(() => {}) });
    expect(wiring.hooks.onAction({ surface: 'attachment-menu', actionId: 'create-task', context: { emailId: 'M1' } })).toBeUndefined();
    wiring.hooks.onAction({ surface: 'message-row-actions', actionId: 'other', context: { emailId: 'M1' } });
    expect(api.calls('ui.openDialog')).toHaveLength(0);
    // A pending dialog does not keep the hook waiting.
    expect(wiring.hooks.onAction({ surface: 'message-row-actions', actionId: 'create-task', context: { emailId: 'M1' } })).toBeUndefined();
  });

  it('opens only one dialog at a time', async () => {
    const { api, wiring } = setup({ 'ui.openDialog': () => new Promise(() => {}) });
    wiring.hooks.onAction({ surface: 'message-row-actions', actionId: 'create-task', context: { emailId: 'M1' } });
    wiring.hooks.onAction({ surface: 'message-row-actions', actionId: 'create-task', context: { emailId: 'M2' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls('ui.openDialog')).toHaveLength(1);
  });
});

describe('keyboard shortcut', () => {
  it('uses the open message', async () => {
    const { api, wiring } = setup();
    wiring.hooks.onEmailOpen({ id: 'M9', subject: 'x' });
    wiring.fromShortcut();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.emailIds).toEqual(['M9']);
  });

  it('says what to do when no message is open', async () => {
    const { api, wiring } = setup();
    wiring.hooks.onEmailOpen({ id: 'M9' });
    wiring.hooks.onEmailClose({ emailId: 'M9' });
    wiring.fromShortcut();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls('ui.openDialog')).toHaveLength(0);
    expect(api.calls('toast.info')).toHaveLength(1);
  });
});

