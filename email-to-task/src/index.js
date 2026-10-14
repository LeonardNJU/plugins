// Email to task: turn a message into a task in Bulwark's own tasks,
// Vikunja, Todoist or a CalDAV task list.
//
// The background part offers the buttons (message row, reader toolbar,
// selection toolbar, a keyboard shortcut) and the row badge; the dialog runs
// in the plugin-dialog slot and does the work there.

import * as React from 'react';
import { TaskDialog } from './ui/task-dialog.js';
import { createWiring } from './lib/wiring.js';

const hostApi = require('@plugin-host');
const wiring = createWiring(hostApi);

export default {
  activate: (api) => wiring.activate(api),
  hooks: wiring.hooks,
  shortcuts: {
    'create-task': {
      keys: 'Alt+Shift+T',
      label: hostApi.i18n.t('shortcut.label'),
      category: 'Email',
      handler: () => wiring.fromShortcut(),
    },
  },
  slots: {
    'plugin-dialog': {
      component: (props) => React.createElement(TaskDialog, { ...props, api: hostApi }),
    },
  },
};
