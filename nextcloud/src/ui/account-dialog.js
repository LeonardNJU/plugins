// The Nextcloud account behind the connection, opened from the Files page:
// which account it is, use another one, disconnect.

import { createElement as h } from 'react';
import { DialogButtons, Stack, Text } from '@plugin-host/ui';
import { connectedText } from '../lib/account.js';
import { ConnectionEmpty, connectLabel } from './connection-ui.js';

export function AccountDialog({ api, connection, onResult }) {
  const t = api.i18n.t;
  const c = connection;
  const close = { id: 'close', label: t('common.close'), variant: 'secondary' };
  if (c.status === 'connected') {
    return h(Stack, { gap: 3 },
      h(Text, { weight: 'medium' }, connectedText(t, c.conn)),
      h(Text, { tone: 'muted' }, t('connect.accountHint')),
      h(Text, { tone: 'muted', size: 'xs' }, t('settings.privacy')),
      h(DialogButtons, {
        buttons: [
          close,
          { id: 'disconnect', label: t('connect.disconnect'), variant: 'secondary' },
          { id: 'switch', label: t('connect.switch'), variant: 'primary' },
        ],
        onClick: (id) => {
          if (id === 'close') onResult({ changed: false });
          else if (id === 'disconnect') void c.signOut().then(() => onResult({ changed: true }));
          else if (id === 'switch') void c.switchAccount();
        },
      }),
    );
  }
  return h(ConnectionDialogBody, { api, connection: c, onCancel: () => onResult({ changed: true }) });
}

/** A dialog body for a connection that isn't usable yet, with its buttons in the footer. */
export function ConnectionDialogBody({ api, connection, onCancel }) {
  const t = api.i18n.t;
  const c = connection;
  const cancel = { id: 'cancel', label: t('common.cancel'), variant: 'secondary' };
  let buttons = [cancel];
  if (c.status === 'waiting') buttons = [cancel, { id: 'reopen', label: t('connect.reopen'), variant: 'primary' }];
  else if (c.status === 'approving') buttons = [cancel, { id: 'connect', label: t('connect.button'), variant: 'primary', busy: true }];
  else if (connectLabel(t, c)) buttons = [cancel, { id: 'connect', label: connectLabel(t, c), variant: 'primary' }];
  return h(Stack, { gap: 0 },
    h(ConnectionEmpty, { api, connection: c, actions: false, compact: true }),
    h(DialogButtons, {
      buttons,
      onClick: (id) => {
        if (id === 'cancel') { if (c.status === 'waiting') c.cancel(); else onCancel(); }
        else if (id === 'reopen') void api.ui.openExternalUrl(c.loginUrl);
        else if (id === 'connect') void c.connect();
      },
    }),
  );
}
