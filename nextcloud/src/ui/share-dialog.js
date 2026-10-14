// "Share link" on the Files page: the link options, then the new link to copy.

import { createElement as h, useState } from 'react';
import {
  Alert, DialogButtons, Field, Input, Stack,
} from '@plugin-host/ui';
import { errorText } from '../lib/errors.js';
import { ShareOptions, defaultShareOptions } from './share-options.js';

export function ShareDialog({ api, client, onResult, report, path }) {
  const t = api.i18n.t;
  const [share, setShare] = useState(() => defaultShareOptions(api.plugin.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [link, setLink] = useState('');

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await client.share(path, { password: share.usePassword ? share.password.trim() : '', expireDate: share.expireDate });
      setLink(created.url);
    } catch (err) {
      report?.(err);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (link) {
    return h(Stack, { gap: 4 },
      h(Field, { label: t('files.linkLabel'), hint: t('files.linkReady') },
        h(Input, { readOnly: true, value: link, onFocus: (e) => e.target.select() })),
      h(DialogButtons, { buttons: [{ id: 'close', label: t('common.close'), variant: 'primary' }], onClick: () => onResult({ url: link }) }),
    );
  }
  return h(Stack, { gap: 4 },
    h(ShareOptions, { api, client, value: share, onChange: setShare }),
    error ? h(Alert, { tone: 'danger', icon: 'alert-triangle' }, errorText(t, error)) : null,
    h(DialogButtons, {
      buttons: [
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary' },
        { id: 'create', label: t('files.createLink'), variant: 'primary', busy },
      ],
      onClick: (id) => { if (id === 'cancel') onResult(null); else if (!busy) void create(); },
    }),
  );
}
