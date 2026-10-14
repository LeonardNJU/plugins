// "Attach from Nextcloud": pick files, then attach copies or share links.

import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { attachEntries, shareEntries } from '../lib/attach.js';
import { NcError, errorText } from '../lib/errors.js';
import { dateInDays, formatSize } from '../lib/format.js';
import { FileBrowser } from './browser.js';

const LAST_PATH_KEY = 'pickerPath';

/** The share options form (password and expiry), shared with the large-file offer. */
export function ShareOptions({ api, client, value, onChange, idPrefix = 'nc' }) {
  const t = api.i18n.t;
  const set = (patch) => onChange({ ...value, ...patch });
  const latest = useRef(value);
  latest.current = value;
  // A password that fits the server's rules, made when the box is ticked.
  useEffect(() => {
    if (!value.usePassword || value.password) return;
    let live = true;
    client.generatePassword().then((password) => {
      if (live && latest.current.usePassword && !latest.current.password) onChange({ ...latest.current, password });
    });
    return () => { live = false; };
  }, [value.usePassword]);
  const togglePassword = (on) => set({ usePassword: on });
  return h('fieldset', { className: 'nc-col nc-card', style: { margin: 0 } },
    h('legend', { className: 'nc-small', style: { padding: '0 4px' } }, t('share.options')),
    h('label', { className: 'nc-row' },
      h('input', { type: 'checkbox', className: 'nc-check', checked: value.usePassword, onChange: (e) => togglePassword(e.target.checked) }),
      t('share.usePassword')),
    value.usePassword ? h('div', { className: 'nc-col', style: { paddingInlineStart: 24 } },
      h('label', { className: 'nc-label', htmlFor: `${idPrefix}-password` }, t('share.password'),
        h('input', {
          id: `${idPrefix}-password`, className: 'nc-input', type: 'text', autoComplete: 'off', spellCheck: false,
          value: value.password, onChange: (e) => set({ password: e.target.value }),
        })),
      h('label', { className: 'nc-row nc-small' },
        h('input', { type: 'checkbox', className: 'nc-check', checked: value.includePassword, onChange: (e) => set({ includePassword: e.target.checked }) }),
        t('share.includePassword')),
      !value.includePassword ? h('p', { className: 'nc-muted nc-small', style: { margin: 0 } }, t('share.sendSeparately')) : null,
    ) : null,
    h('label', { className: 'nc-label', htmlFor: `${idPrefix}-expiry` }, t('share.expiry'),
      h('input', {
        id: `${idPrefix}-expiry`, className: 'nc-input', type: 'date', value: value.expireDate, min: dateInDays(1),
        onChange: (e) => set({ expireDate: e.target.value }), style: { maxWidth: 200 },
      })),
    h('p', { className: 'nc-muted nc-small', style: { margin: 0 } }, value.expireDate ? t('share.expiryHint') : t('share.noExpiry')),
  );
}

/** Starting share options from the user's settings. */
export function defaultShareOptions(settings) {
  return {
    usePassword: settings?.passwordProtect === true,
    password: '',
    includePassword: false,
    expireDate: dateInDays(Number(settings?.expiryDays ?? 14)),
  };
}

export function PickerDialog({ api, client, onResult, report }) {
  const t = api.i18n.t;
  const locale = api.i18n.getLocale();
  const [path, setPath] = useState('/');
  const [selected, setSelected] = useState(() => new Map());
  const [share, setShare] = useState(() => defaultShareOptions(api.plugin.settings));
  const [showShare, setShowShare] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

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
    if (err instanceof NcError && err.code === 'cancelled') { setBusy(null); return; }
    report?.(err);
    setError(err);
    setBusy(null);
  };

  const attach = async () => {
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const blobs = [];
    setBusy({ kind: 'attach', index: 0, count: entries.length, loaded: 0, total: entries[0]?.size || 0, name: entries[0]?.name });
    try {
      await attachEntries(api, client, entries, {
        signal: controller.signal,
        onProgress: (p) => setBusy({ kind: 'attach', ...p }),
        onAttach: async (blob) => { blobs.push(blob); return true; },
      });
      onResult({ action: 'attach', blobs });
    } catch (err) {
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

  const percent = busy?.kind === 'attach' && busy.total ? Math.round((busy.loaded / busy.total) * 100) : 0;
  return h('div', { className: 'nc nc-col' },
    h(FileBrowser, { api, client, mode: 'files', path, onNavigate: navigate, selected, onToggle: toggle, onError: report, listHeight: 340 }),
    showShare ? h(ShareOptions, { api, client, value: share, onChange: setShare, idPrefix: 'nc-pick' }) : null,
    error ? h('p', { className: 'nc-error', role: 'alert', style: { margin: 0 } }, errorText(t, error)) : null,
    busy?.kind === 'attach' ? h('div', { className: 'nc-col', role: 'status' },
      h('span', { className: 'nc-small' }, t('picker.downloading', { name: busy.name ?? '', index: (busy.index ?? 0) + 1, count: busy.count ?? 1 })),
      h('div', { className: 'nc-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-label': t('picker.progress') },
        h('span', { style: { width: `${percent}%` } })),
    ) : null,
    busy?.kind === 'share' ? h('p', { className: 'nc-muted', role: 'status', style: { margin: 0 } }, t('picker.sharing')) : null,
    h('div', { className: 'nc-row nc-footer' },
      h('span', { className: 'nc-grow nc-muted nc-small', 'aria-live': 'polite' },
        entries.length ? t('picker.selected', { count: entries.length, size: formatSize(total, locale) }) : t('picker.hint')),
      busy?.kind === 'attach'
        ? h('button', { type: 'button', className: 'nc-btn', onClick: () => abortRef.current?.abort() }, t('common.cancel'))
        : null,
      h('button', { type: 'button', className: 'nc-btn', disabled: !entries.length || !!busy, onClick: () => void shareLinks() },
        showShare ? t('picker.createLinks') : t('picker.shareLinks')),
      h('button', { type: 'button', className: 'nc-btn nc-primary', disabled: !entries.length || !!busy, onClick: () => void attach() },
        t('picker.attach')),
    ),
  );
}
