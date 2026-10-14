// The plugin's section in Settings: connect, see which Nextcloud account is
// used, switch to another one, disconnect.

import { createElement as h } from 'react';
import { getApi } from '../lib/host.js';
import { ConnectionSettings, useConnection } from './connection-ui.js';

export function SettingsSection() {
  const api = getApi();
  const connection = useConnection(api);
  return h(ConnectionSettings, { api, connection });
}
