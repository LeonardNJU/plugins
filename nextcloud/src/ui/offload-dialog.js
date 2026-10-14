// The offer shown when a large file is attached: upload it to Nextcloud and
// put a share link in the message instead.

import { createElement as h, useEffect, useRef, useState } from 'react';
import { uploadFile } from '../lib/chunked.js';
import { NcError, errorText } from '../lib/errors.js';
import { formatSize } from '../lib/format.js';
import { linkBlock } from '../lib/links.js';
import { joinPath, sanitizeFileName, uniqueName, uploadFolder } from '../lib/paths.js';
import { ShareOptions, defaultShareOptions } from './picker-dialog.js';

/** Where an upload goes: the folder (made if missing) and a free name in it. */
export async function planUpload(client, folder, name) {
  await client.mkdirp(folder);
  const taken = await client.names(folder);
  return joinPath(folder, uniqueName(sanitizeFileName(name), taken));
}

/** Upload, share and build the link block. Exported for tests. */
export async function offloadFile(api, client, file, { share, onProgress, signal, folder }) {
  const settings = api.plugin.settings ?? {};
  const target = folder ?? uploadFolder(settings.uploadFolder, settings.folderLayout);
  const path = await planUpload(client, target, file.name);
  await uploadFile(api, client, file, path, { onProgress, signal });
  const password = share.usePassword ? share.password.trim() : '';
  const created = await client.share(path, { password, expireDate: share.expireDate });
  const link = {
    id: path, name: file.name, size: file.size, url: created.url, password,
    includePassword: !!(password && share.includePassword), expireDate: share.expireDate,
  };
  const block = linkBlock(api.i18n.t, [link], api.i18n.getLocale());
  return { externalAttachment: true, html: block.html, text: block.text, path, url: created.url };
}

export function OffloadDialog({ api, client, onResult, report, fileId, name, size }) {
  const t = api.i18n.t;
  const locale = api.i18n.getLocale();
  const [share, setShare] = useState(() => defaultShareOptions(api.plugin.settings));
  const [state, setState] = useState({ phase: 'ask' });
  const abortRef = useRef(null);
  const settings = api.plugin.settings ?? {};
  const folder = uploadFolder(settings.uploadFolder, settings.folderLayout);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ phase: 'upload', loaded: 0, total: size });
    try {
      const file = await api.upfiles.get(fileId);
      if (!file) throw new NcError('not_found');
      const result = await offloadFile(api, client, file, {
        share, folder, signal: controller.signal,
        onProgress: (loaded, total) => setState({ phase: 'upload', loaded, total }),
      });
      onResult(result);
    } catch (err) {
      if (err instanceof NcError && err.code === 'cancelled') { setState({ phase: 'paused' }); return; }
      report?.(err);
      setState({ phase: 'error', error: err });
    }
  };

  const percent = state.phase === 'upload' && state.total ? Math.round((state.loaded / state.total) * 100) : 0;
  return h('div', { className: 'nc nc-col' },
    h('p', { style: { margin: 0 } }, t('offload.intro', { name, size: formatSize(size, locale) })),
    h('p', { className: 'nc-muted nc-small', style: { margin: 0 } }, t('offload.folder', { folder })),
    state.phase === 'ask' || state.phase === 'error' || state.phase === 'paused'
      ? h(ShareOptions, { api, client, value: share, onChange: setShare, idPrefix: 'nc-off' })
      : null,
    state.phase === 'upload' ? h('div', { className: 'nc-col', role: 'status' },
      h('span', { className: 'nc-small' }, t('offload.uploading', { loaded: formatSize(state.loaded, locale), total: formatSize(state.total, locale) })),
      h('div', { className: 'nc-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-label': t('picker.progress') },
        h('span', { style: { width: `${percent}%` } })),
    ) : null,
    state.phase === 'paused' ? h('p', { className: 'nc-muted', role: 'status', style: { margin: 0 } }, t('offload.paused')) : null,
    state.phase === 'error' ? h('p', { className: 'nc-error', role: 'alert', style: { margin: 0 } }, errorText(t, state.error)) : null,
    h('div', { className: 'nc-row nc-footer', style: { justifyContent: 'flex-end' } },
      state.phase === 'upload'
        ? h('button', { type: 'button', className: 'nc-btn', onClick: () => abortRef.current?.abort() }, t('common.cancel'))
        : h('button', { type: 'button', className: 'nc-btn', onClick: () => onResult({ action: 'attach' }) }, t('offload.attachNormally')),
      state.phase !== 'upload'
        ? h('button', { type: 'button', className: 'nc-btn nc-primary', onClick: () => void start() },
          state.phase === 'paused' || state.phase === 'error' ? t('offload.resume') : t('offload.upload'))
        : null,
    ),
  );
}
