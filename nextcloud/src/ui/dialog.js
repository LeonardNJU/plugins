// The plugin's dialog (api.ui.openDialog with slot "plugin-dialog"). The
// `view` prop picks what it shows; every view needs a connection first.

import { createElement as h, useMemo } from 'react';
import { getApi } from '../lib/host.js';
import { createClient } from '../lib/client.js';
import { ensureStyles } from './styles.js';
import { ConnectionPanel, useConnection } from './connection-ui.js';
import { PickerDialog } from './picker-dialog.js';
import { OffloadDialog } from './offload-dialog.js';
import { SaveDialog } from './save-dialog.js';

const VIEWS = {
  picker: PickerDialog,
  offload: OffloadDialog,
  save: SaveDialog,
};

export function registerView(name, component) {
  VIEWS[name] = component;
}

export function PluginDialog(props) {
  ensureStyles();
  const api = getApi();
  const connection = useConnection(api);
  const client = useMemo(() => (connection.conn ? createClient(api, connection.conn) : null), [connection.conn]);
  const View = VIEWS[props.view];
  if (!View) return null;
  if (connection.status !== 'connected' || !client) {
    return h('div', { className: 'nc' }, h(ConnectionPanel, { api, connection }));
  }
  return h(View, { ...props, api, client, report: connection.report });
}
