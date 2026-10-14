// The plugin's section in Settings: connect, see the account, disconnect.

import { createElement as h } from 'react';
import { getApi } from '../lib/host.js';
import { ensureStyles } from './styles.js';
import { ConnectionPanel, useConnection } from './connection-ui.js';

export function SettingsSection() {
  ensureStyles();
  const api = getApi();
  const t = api.i18n.t;
  const connection = useConnection(api);
  return h('section', { className: 'nc nc-col', 'aria-label': t('settings.title') },
    h('h3', { style: { margin: 0, fontSize: '14px' } }, t('settings.title')),
    h(ConnectionPanel, { api, connection }),
    h('p', { className: 'nc-muted nc-small', style: { margin: 0 } }, t('settings.privacy')),
    h('p', { className: 'nc-muted nc-small', style: { margin: 0 } }, t('settings.migration')),
  );
}
