// The "Nextcloud" button in the composer's attach row, and the share links
// waiting to be added to the message.

import { createElement as h, useCallback, useEffect, useState } from 'react';
import { getApi } from '../lib/host.js';
import { errorText } from '../lib/errors.js';
import { addPending, getPending, removePending } from '../lib/links.js';
import { ensureStyles } from './styles.js';
import { Icon } from './icons.js';
import { useConnection } from './connection-ui.js';

/** What to do with the dialog's answer. Exported for tests. */
export async function applyPickerResult(api, result, onAttach) {
  const t = api.i18n.t;
  if (!result || typeof result !== 'object') return { attached: 0, links: 0 };
  if (result.action === 'attach') {
    let attached = 0;
    for (const blob of result.blobs ?? []) {
      const ok = typeof onAttach === 'function' ? await onAttach(blob) : false;
      if (ok === false) {
        api.toast.error(t('error.attach_refused_name', { name: blob.name }));
        break;
      }
      attached++;
    }
    if (attached) api.toast.success(t('composer.attached', { count: attached }));
    return { attached, links: 0 };
  }
  if (result.action === 'links' && Array.isArray(result.links) && result.links.length) {
    await addPending(api.storage, result.links);
    api.toast.success(t('composer.linksAdded', { count: result.links.length }));
    return { attached: 0, links: result.links.length };
  }
  return { attached: 0, links: 0 };
}

export function ComposerSource(props) {
  ensureStyles();
  const api = getApi();
  const t = api.i18n.t;
  const connection = useConnection(api);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => getPending(api.storage).then(setPending).catch(() => {}), []);
  useEffect(() => { void reload(); }, [reload]);

  const open = async () => {
    if (busy) return;
    if (connection.status !== 'connected') {
      await connection.connect();
      return;
    }
    setBusy(true);
    try {
      const result = await api.ui.openDialog({ title: t('picker.title'), slot: 'plugin-dialog', extraProps: { view: 'picker' }, width: 760 });
      await applyPickerResult(api, result, props.onAttach);
      await reload();
    } catch (err) {
      api.toast.error(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const waiting = connection.status === 'waiting' || connection.status === 'approving';
  const label = connection.status === 'connected' || connection.status === 'loading' ? t('composer.button') : t('connect.button');
  return h('div', { className: 'nc nc-row', style: { gap: 6 } },
    h('button', {
      type: 'button', className: 'nc-btn', onClick: () => void open(), disabled: busy || waiting || connection.status === 'loading',
      title: connection.status === 'expired' ? t('connect.expired') : t('composer.title'),
    }, h(Icon, { name: 'cloud', size: 16, className: '' }), waiting ? t('composer.waiting') : label),
    waiting ? h('button', { type: 'button', className: 'nc-link nc-small', onClick: connection.cancel }, t('common.cancel')) : null,
    pending.length ? h('div', { className: 'nc-row', style: { gap: 4 }, 'aria-label': t('composer.pending'), role: 'list' },
      h('span', { className: 'nc-muted nc-small', title: t('composer.pendingHint') }, t('composer.pendingCount', { count: pending.length })),
      ...pending.map((link) => h('span', { key: link.id, className: 'nc-chip', role: 'listitem', title: link.url },
        h('span', { className: 'nc-name', style: { maxWidth: 140 } }, link.name),
        h('button', {
          type: 'button', 'aria-label': t('composer.removeLink', { name: link.name }),
          onClick: () => void removePending(api.storage, link.id).then(setPending),
        }, '×'),
      )),
    ) : null,
  );
}
