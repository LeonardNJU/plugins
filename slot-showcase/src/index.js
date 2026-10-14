// Slot showcase: fills every plugin surface of the webmail with something you
// can see, for the docs screenshots and for checking a layout by hand.
//
// - Every frame slot shows the app's UI kit component an author would use
//   there (src/lib/surfaces.js): info bars in the reader, sidebar rows in the
//   sidebar, a form with footer buttons in the dialog, setting rows in
//   Settings, a toolbar and list on the page. Each names its slot and the
//   props it received.
// - Every action surface gets one or two buttons; a click shows a toast with
//   the surface and the context keys the host passed.
// - Day labels on today and a few days after, and one page of its own.
//
// The lists follow lib/plugin-slot-catalog.ts in the webmail.

import { SURFACES, describeProps } from './lib/surfaces.js';

const api = require('@plugin-host');

// A check item in the composer's Options menu; a click flips it.
function optionEntries(checked) {
  return [{ id: 'option', label: 'Showcase option', icon: 'flask-2', checked, description: 'A check item with a description' }];
}
let optionChecked = true;

// Action surfaces and the buttons the showcase puts on each.
const ACTIONS = {
  'command-palette': [
    { id: 'open-dialog', label: 'Slot showcase: open the dialog', icon: 'layout-grid' },
    { id: 'notify', label: 'Slot showcase: send a notification', icon: 'bell' },
  ],
  'top-bar-actions': [{ id: 'top', label: 'Showcase', icon: 'flask-2' }],
  'message-row-actions': [{ id: 'row', label: 'Showcase row action', icon: 'flask-2' }],
  'message-bulk-actions': [
    { id: 'bulk', label: 'Showcase', icon: 'flask-2' },
    { id: 'bulk-danger', label: 'Showcase (danger)', icon: 'bug', danger: true },
  ],
  'reader-actions': [{ id: 'reader', label: 'Showcase', icon: 'flask-2' }],
  'attachment-menu': [{ id: 'attachment', label: 'Showcase attachment action', icon: 'flask-2' }],
  'composer-send-menu': [{ id: 'send', label: 'Showcase send option', icon: 'flask-2' }],
  'composer-attach-menu': [{ id: 'attach', label: 'Showcase attach source', icon: 'flask-2' }],
  'composer-toolbar-actions': [{ id: 'composer', label: 'Showcase', icon: 'flask-2', shortcut: 'Alt+Shift+S' }],
  'composer-options-menu': optionEntries(true),
  'contact-list-actions': [{ id: 'contacts', label: 'Showcase', icon: 'flask-2' }],
  'task-list-actions': [{ id: 'tasks', label: 'Showcase', icon: 'flask-2' }],
  'file-actions': [{ id: 'files', label: 'Showcase file action', icon: 'flask-2' }],
};

const slots = {};
for (const [name, component] of Object.entries(SURFACES)) {
  slots[name] = { component };
}
// The details panel asks once per category; show the section once, at the bottom.
slots['email-details-section'].shouldShow = (ctx) => ctx?.category == null;

function isoDay(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function activate() {
  for (const [surface, actions] of Object.entries(ACTIONS)) {
    try {
      await api.ui.setActions(surface, actions);
    } catch (err) {
      api.log.warn(`setActions(${surface}) failed: ${err.message}`);
    }
  }
  await api.ui.setDayLabels([
    { date: isoDay(0), text: 'Showcase today', title: 'Day label from the slot showcase', dot: true },
    { date: isoDay(1), text: 'Label + dot', dot: true },
    { date: isoDay(3), text: 'Label only' },
    { date: isoDay(5), dot: true, title: 'Dot only' },
  ]);
  await api.ui.setPages([{ id: 'showcase', title: 'Showcase', icon: 'layout-grid' }]);
  try {
    await api.ui.setSectionTitle('Showcase section');
  } catch (err) {
    api.log.warn(`setSectionTitle failed: ${err.message}`);
  }
}

export const hooks = {
  async onAction({ surface, actionId, context }) {
    if (actionId === 'open-dialog') {
      const result = await api.ui.openDialog({ title: 'Slot showcase', slot: 'plugin-dialog', extraProps: { opened: 'from the command palette' } });
      api.toast.info(`plugin-dialog resolved: ${JSON.stringify(result)}`);
      return;
    }
    if (actionId === 'notify') {
      await api.notifications.show({ title: 'Slot showcase', body: 'A notification from api.notifications.show', tag: 'showcase' });
      return;
    }
    if (actionId === 'option') {
      optionChecked = !optionChecked;
      await api.ui.setActions('composer-options-menu', optionEntries(optionChecked));
    }
    const keys = describeProps(context);
    api.toast.info(`${surface} (${actionId}): ${keys.length ? keys.join(', ') : 'no context'}`);
  },
  onNotificationClick({ tag }) {
    api.toast.info(`Notification clicked: ${tag}`);
  },
};

export { slots };
