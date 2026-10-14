// "Save to Nextcloud": pick a folder (or make one), then save an attachment
// or the whole message there.

import { createElement as h, useEffect, useRef, useState } from 'react';
import {
  Alert, DialogButtons, ProgressBar, Row, Stack, Text, ToolbarButton,
} from '@plugin-host/ui';
import { NcError, errorText } from '../lib/errors.js';
import { formatSize } from '../lib/format.js';
import { createFolder } from '../lib/files.js';
import { SAVE_FOLDER_KEY, saveAttachment, saveMessage } from '../lib/save.js';
import { BrowserList, browserBar, useBrowser } from './browser.js';

export function SaveDialog({ api, client, onResult, report, kind, emailId, blobId, name, size }) {
  const t = api.i18n.t;
  const locale = api.i18n.getLocale();
  const [path, setPath] = useState('/');
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ phase: 'pick' });
  const abortRef = useRef(null);
  const browser = useBrowser({ api, client, path, reloadKey, onError: report });

  useEffect(() => {
    api.storage.get(SAVE_FOLDER_KEY).then((p) => { if (typeof p === 'string' && p) setPath(p); }).catch(() => {});
    return () => abortRef.current?.abort();
  }, []);

  const fail = (err) => {
    if (err instanceof NcError && err.code === 'cancelled') { setState({ phase: 'pick' }); return; }
    report?.(err);
    setState({ phase: 'error', error: err });
  };

  const newFolder = async () => {
    try {
      const created = await createFolder(api, client, path);
      if (created) { browser.showView('files'); setPath(created); setReloadKey((k) => k + 1); }
    } catch (err) {
      fail(err);
    }
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

  const saving = state.phase === 'saving';
  const click = (id) => {
    if (id === 'cancel') { if (saving) abortRef.current?.abort(); else onResult(null); }
    if (id === 'save') void save();
  };
  return h(Stack, { gap: 3 },
    h(Text, null, t('save.choose', { name: size ? `${name} (${formatSize(size, locale)})` : name })),
    h(Row, { gap: 2, wrap: false },
      ...browserBar({ api, browser, path, onNavigate: setPath, compact: true }),
      h(ToolbarButton, { icon: 'folder-plus', label: t('save.newFolder'), compact: true, disabled: saving || browser.view !== 'files', onClick: () => void newFolder() })),
    h(BrowserList, { api, browser, mode: 'folder', onNavigate: setPath }),
    saving ? h(Stack, { gap: 2 },
      h(Text, { size: 'xs' }, t('save.saving')),
      h(ProgressBar, { value: state.total ? state.loaded / state.total : null, label: t('picker.progress') })) : null,
    state.phase === 'error' ? h(Alert, { tone: 'danger', icon: 'alert-triangle' }, errorText(t, state.error)) : null,
    h(DialogButtons, {
      buttons: [
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary' },
        { id: 'save', label: t('save.here'), variant: 'primary', busy: saving, disabled: browser.view !== 'files' },
      ],
      onClick: click,
    }),
  );
}
