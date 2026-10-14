// "Save to Nextcloud": pick a folder (or make one), then save an attachment
// or the whole message there.

import { createElement as h, useEffect, useRef, useState } from 'react';
import { NcError, errorText } from '../lib/errors.js';
import { formatSize } from '../lib/format.js';
import { joinPath, sanitizeFileName } from '../lib/paths.js';
import { SAVE_FOLDER_KEY, saveAttachment, saveMessage } from '../lib/save.js';
import { FileBrowser } from './browser.js';

export function NewFolder({ api, client, path, onCreated, onError }) {
  const t = api.i18n.t;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = async () => {
    const clean = sanitizeFileName(name, '');
    if (!clean) return;
    try {
      const target = joinPath(path, clean);
      await client.mkdir(target);
      setOpen(false);
      setName('');
      onCreated(target);
    } catch (err) {
      onError(err);
    }
  };
  if (!open) return h('button', { type: 'button', className: 'nc-btn', onClick: () => setOpen(true) }, t('save.newFolder'));
  return h('div', { className: 'nc-row' },
    h('label', { className: 'nc-sr', htmlFor: 'nc-new-folder' }, t('save.folderName')),
    h('input', {
      id: 'nc-new-folder', className: 'nc-input', value: name, placeholder: t('save.folderName'), autoFocus: true,
      onChange: (e) => setName(e.target.value),
      onKeyDown: (e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setOpen(false); },
    }),
    h('button', { type: 'button', className: 'nc-btn', disabled: !name.trim(), onClick: () => void create() }, t('save.create')),
    h('button', { type: 'button', className: 'nc-btn', onClick: () => setOpen(false) }, t('common.cancel')),
  );
}

export function SaveDialog({ api, client, onResult, report, kind, emailId, blobId, name, size }) {
  const t = api.i18n.t;
  const locale = api.i18n.getLocale();
  const [path, setPath] = useState('/');
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ phase: 'pick' });
  const abortRef = useRef(null);

  useEffect(() => {
    api.storage.get(SAVE_FOLDER_KEY).then((p) => { if (typeof p === 'string' && p) setPath(p); }).catch(() => {});
    return () => abortRef.current?.abort();
  }, []);

  const fail = (err) => {
    if (err instanceof NcError && err.code === 'cancelled') { setState({ phase: 'pick' }); return; }
    report?.(err);
    setState({ phase: 'error', error: err });
  };

  const save = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ phase: 'saving', loaded: 0, total: size || 0 });
    const opts = { signal: controller.signal, onProgress: (loaded, total) => setState({ phase: 'saving', loaded, total }) };
    try {
      const saved = kind === 'message'
        ? await saveMessage(api, client, { emailId, name }, path, opts)
        : await saveAttachment(api, client, { emailId, blobId, name }, path, opts);
      await api.storage.set(SAVE_FOLDER_KEY, path).catch(() => {});
      onResult({ path: saved });
    } catch (err) {
      fail(err);
    }
  };

  const percent = state.phase === 'saving' && state.total ? Math.round((state.loaded / state.total) * 100) : 0;
  return h('div', { className: 'nc nc-col' },
    h('p', { style: { margin: 0 } }, t('save.choose', { name: size ? `${name} (${formatSize(size, locale)})` : name })),
    h(FileBrowser, {
      api, client, mode: 'folder', path, onNavigate: setPath, reloadKey, onError: report, listHeight: 300,
      toolbar: h('div', { className: 'nc-row' },
        h(NewFolder, { api, client, path, onCreated: (p) => { setPath(p); setReloadKey((k) => k + 1); }, onError: fail })),
    }),
    state.phase === 'saving' ? h('div', { className: 'nc-col', role: 'status' },
      h('span', { className: 'nc-small' }, t('save.saving')),
      h('div', { className: 'nc-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-label': t('picker.progress') },
        h('span', { style: { width: `${percent}%` } })),
    ) : null,
    state.phase === 'error' ? h('p', { className: 'nc-error', role: 'alert', style: { margin: 0 } }, errorText(t, state.error)) : null,
    h('div', { className: 'nc-row nc-footer', style: { justifyContent: 'flex-end' } },
      state.phase === 'saving'
        ? h('button', { type: 'button', className: 'nc-btn', onClick: () => abortRef.current?.abort() }, t('common.cancel'))
        : h('button', { type: 'button', className: 'nc-btn', onClick: () => onResult(null) }, t('common.cancel')),
      h('button', { type: 'button', className: 'nc-btn nc-primary', disabled: state.phase === 'saving', onClick: () => void save() }, t('save.here')),
    ),
  );
}
