// The offer shown when a large file is attached: upload it to Nextcloud and
// put a share link in the message instead.

import { createElement as h, useEffect, useRef, useState } from 'react';
import {
  Alert, DialogButtons, Heading, ProgressBar, Stack, Text,
} from '@plugin-host/ui';
import { uploadFile } from '../lib/chunked.js';
import { NcError, errorText } from '../lib/errors.js';
import { formatSize } from '../lib/format.js';
import { linkBlock } from '../lib/links.js';
import { uploadFolder } from '../lib/paths.js';
import { planUpload } from '../lib/save.js';
import { ShareOptions, defaultShareOptions } from './share-options.js';

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

  const uploading = state.phase === 'upload';
  const again = state.phase === 'paused' || state.phase === 'error';
  const buttons = uploading
    ? [
      { id: 'stop', label: t('common.cancel'), variant: 'secondary' },
      { id: 'upload', label: t('offload.upload'), variant: 'primary', busy: true },
    ]
    : [
      { id: 'normal', label: t('offload.attachNormally'), variant: 'secondary' },
      { id: 'upload', label: again ? t('offload.resume') : t('offload.upload'), variant: 'primary' },
    ];
  const click = (id) => {
    if (id === 'stop') abortRef.current?.abort();
    else if (id === 'normal') onResult({ action: 'attach' });
    else if (id === 'upload' && !uploading) void start();
  };

  return h(Stack, { gap: 4 },
    h(Stack, { gap: 1 },
      h(Text, null, t('offload.intro', { name, size: formatSize(size, locale) })),
      h(Text, { tone: 'muted', size: 'xs' }, t('offload.folder', { folder }))),
    uploading ? null : h(Stack, { gap: 3 }, h(Heading, { level: 4 }, t('share.options')), h(ShareOptions, { api, client, value: share, onChange: setShare })),
    uploading ? h(Stack, { gap: 2 },
      h(Text, { size: 'xs' }, t('offload.uploading', { loaded: formatSize(state.loaded, locale), total: formatSize(state.total, locale) })),
      h(ProgressBar, { value: state.total ? state.loaded / state.total : null, label: t('picker.progress') })) : null,
    state.phase === 'paused' ? h(Alert, { tone: 'info', icon: 'player-pause' }, t('offload.paused')) : null,
    state.phase === 'error' ? h(Alert, { tone: 'danger', icon: 'alert-triangle' }, errorText(t, state.error)) : null,
    h(DialogButtons, { buttons, onClick: click }),
  );
}
