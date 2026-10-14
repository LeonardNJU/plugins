// "From Nextcloud" in the composer's Attach menu: pick files, then attach
// copies to that composer (api.composer.attach with the click's
// composerId) or share them as links.

import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, DialogButtons, Heading, ProgressBar, Row, Spinner, Stack, Text,
} from '@plugin-host/ui';
import { attachEntries, shareEntries } from '../lib/attach.js';
import { NcError, errorText } from '../lib/errors.js';
import { formatSize } from '../lib/format.js';
import { BrowserList, browserBar, useBrowser } from './browser.js';
import { ShareOptions, defaultShareOptions } from './share-options.js';

const LAST_PATH_KEY = 'pickerPath';

export function PickerDialog({ api, client, onResult, report, composerId }) {
  const t = api.i18n.t;
  const locale = api.i18n.getLocale();
  const [path, setPath] = useState('/');
  const [selected, setSelected] = useState(() => new Map());
  const [share, setShare] = useState(() => defaultShareOptions(api.plugin.settings));
  const [showShare, setShowShare] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const browser = useBrowser({ api, client, path, onError: report });

  useEffect(() => {
    api.storage.get(LAST_PATH_KEY).then((p) => { if (typeof p === 'string' && p) setPath(p); }).catch(() => {});
    return () => abortRef.current?.abort();
  }, []);

  const navigate = (p) => { setPath(p); void api.storage.set(LAST_PATH_KEY, p).catch(() => {}); };
  const toggle = (entry) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(entry.path)) next.delete(entry.path); else next.set(entry.path, entry);
    return next;
  });
  const entries = useMemo(() => [...selected.values()], [selected]);
  const total = entries.reduce((n, e) => n + (e.size || 0), 0);

  const fail = (err) => {
    setBusy(null);
    if (err instanceof NcError && err.code === 'cancelled') return;
    report?.(err);
    setError(err);
  };

  const attach = async () => {
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    let attached = 0;
    setBusy({ kind: 'attach', index: 0, count: entries.length, loaded: 0, total: entries[0]?.size || 0, name: entries[0]?.name });
    try {
      if (!composerId) throw new NcError('attach_refused');
      await attachEntries(api, client, entries, {
        signal: controller.signal,
        onProgress: (p) => setBusy({ kind: 'attach', ...p }),
        onAttach: async (blob) => {
          const ok = await api.composer.attach(composerId, blob);
          if (ok !== false) attached++;
          return ok;
        },
      });
      onResult({ action: 'attach', attached });
    } catch (err) {
      // Files already in the message stay there; take them out of the
      // selection so trying again doesn't attach them twice.
      if (attached) {
        const done = new Set(entries.slice(0, attached).map((e) => e.path));
        setSelected((prev) => new Map([...prev].filter(([p]) => !done.has(p))));
        api.toast.success(t('composer.attached', { count: attached }));
      }
      fail(err);
    }
  };

  const shareLinks = async () => {
    if (!showShare) { setShowShare(true); return; }
    setError(null);
    setBusy({ kind: 'share' });
    try {
      const links = await shareEntries(client, entries, {
        password: share.usePassword ? share.password.trim() : '',
        includePassword: share.includePassword,
        expireDate: share.expireDate,
      });
      onResult({ action: 'links', links });
    } catch (err) {
      fail(err);
    }
  };

  const none = !entries.length;
  const attachButton = { id: 'attach', label: t('picker.attach'), variant: showShare ? 'secondary' : 'primary', disabled: none || !!busy, busy: busy?.kind === 'attach' };
  const linksButton = { id: 'links', label: showShare ? t('picker.createLinks') : t('picker.shareLinks'), variant: showShare ? 'primary' : 'secondary', disabled: none || !!busy, busy: busy?.kind === 'share' };
  const buttons = [
    { id: 'cancel', label: t('common.cancel'), variant: 'secondary' },
    ...(showShare ? [attachButton, linksButton] : [linksButton, attachButton]),
  ];
  const click = (id) => {
    if (id === 'cancel') {
      if (busy?.kind === 'attach') abortRef.current?.abort();
      else onResult(null);
    } else if (id === 'attach') void attach();
    else if (id === 'links') void shareLinks();
  };

  const fraction = busy?.kind === 'attach' && busy.total ? busy.loaded / busy.total : null;
  return h(Stack, { gap: 3 },
    h(Row, { gap: 2, wrap: false }, ...browserBar({ api, browser, path, onNavigate: navigate, compact: true })),
    h(BrowserList, { api, browser, mode: 'files', selected, onNavigate: navigate, onToggle: toggle }),
    h(Text, { tone: 'muted', size: 'xs' },
      entries.length ? t('picker.selected', { count: entries.length, size: formatSize(total, locale) }) : t('picker.hint')),
    showShare ? h(Stack, { gap: 3 }, h(Heading, { level: 4 }, t('share.options')), h(ShareOptions, { api, client, value: share, onChange: setShare })) : null,
    busy?.kind === 'attach' ? h(Stack, { gap: 2 },
      h(Text, { size: 'xs' }, t('picker.downloading', { name: busy.name ?? '', index: (busy.index ?? 0) + 1, count: busy.count ?? 1 })),
      h(ProgressBar, { value: fraction, label: t('picker.progress') })) : null,
    busy?.kind === 'share' ? h(Spinner, { label: t('picker.sharing') }) : null,
    error ? h(Alert, { tone: 'danger', icon: 'alert-triangle' }, error.code === 'attach_refused' && error.detail
      ? t('error.attach_refused_name', { name: error.detail })
      : errorText(t, error)) : null,
    h(DialogButtons, { buttons, onClick: click }),
  );
}
