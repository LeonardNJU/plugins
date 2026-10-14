// The Nextcloud page (api.ui.setPages, slot "app-page"): browse, upload,
// download, share, and attach a file to a new message.

import { createElement as h, useMemo, useRef, useState } from 'react';
import { getApi } from '../lib/host.js';
import { createClient } from '../lib/client.js';
import { uploadFile, discardUpload } from '../lib/chunked.js';
import { NcError, errorText } from '../lib/errors.js';
import { formatSize } from '../lib/format.js';
import { attachToNewMessage, canDownload, downloadToComputer } from '../lib/files.js';
import { planUpload } from '../lib/save.js';
import { ensureStyles } from './styles.js';
import { ConnectionPanel, useConnection } from './connection-ui.js';
import { FileBrowser } from './browser.js';
import { ShareOptions, defaultShareOptions } from './picker-dialog.js';
import { NewFolder } from './save-dialog.js';

function Uploads({ api, jobs, onResume, onCancel, onDiscard }) {
  const t = api.i18n.t;
  const locale = api.i18n.getLocale();
  if (!jobs.length) return null;
  return h('ul', { className: 'nc-col', style: { listStyle: 'none', margin: 0, padding: 0 }, 'aria-label': t('files.upload') },
    jobs.map((job) => {
      const percent = job.total ? Math.round((job.loaded / job.total) * 100) : 0;
      return h('li', { key: job.id, className: 'nc-card nc-col', style: { padding: 8, gap: 6 } },
        h('div', { className: 'nc-row' },
          h('span', { className: 'nc-grow nc-small', role: 'status' },
            job.state === 'running' ? t('files.uploading', { name: job.file.name, loaded: formatSize(job.loaded, locale), total: formatSize(job.total, locale) })
              : job.state === 'paused' ? t('files.paused', { name: job.file.name })
                : job.state === 'done' ? t('files.uploaded', { name: job.file.name })
                  : `${job.file.name}: ${errorText(t, job.error)}`),
          job.state === 'running' ? h('button', { type: 'button', className: 'nc-btn', onClick: () => onCancel(job) }, t('common.cancel')) : null,
          job.state === 'paused' || job.state === 'error' ? h('button', { type: 'button', className: 'nc-btn', onClick: () => onResume(job) }, t('files.resume')) : null,
          job.state === 'paused' || job.state === 'error' ? h('button', { type: 'button', className: 'nc-btn', onClick: () => onDiscard(job) }, t('files.discard')) : null,
        ),
        job.state === 'running' ? h('div', { className: 'nc-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-label': job.file.name },
          h('span', { style: { width: `${percent}%` } })) : null,
      );
    }),
  );
}

function Details({ api, client, entry, onError }) {
  const t = api.i18n.t;
  const locale = api.i18n.getLocale();
  const [busy, setBusy] = useState(null);
  const [share, setShare] = useState(null);
  const [link, setLink] = useState('');

  const run = async (kind, fn) => {
    setBusy(kind);
    try { await fn(); } catch (err) { onError(err); } finally { setBusy(null); }
  };

  if (!entry) return h('p', { className: 'nc-muted nc-small', style: { margin: 0 } }, t('files.selectHint'));
  return h('div', { className: 'nc-card nc-col', 'aria-label': entry.name },
    h('div', { className: 'nc-row' },
      h('strong', { className: 'nc-name nc-grow' }, entry.name),
      h('span', { className: 'nc-meta' }, formatSize(entry.size, locale)),
    ),
    h('div', { className: 'nc-row' },
      canDownload(entry)
        ? h('button', { type: 'button', className: 'nc-btn', disabled: !!busy, onClick: () => void run('download', () => downloadToComputer(api, client, entry)) }, t('files.download'))
        : null,
      h('button', { type: 'button', className: 'nc-btn', disabled: !!busy, onClick: () => { setShare(defaultShareOptions(api.plugin.settings)); setLink(''); } }, t('files.share')),
      h('button', { type: 'button', className: 'nc-btn', disabled: !!busy, onClick: () => void run('attach', () => attachToNewMessage(api, client, entry)) }, t('files.attachNew')),
      h('button', { type: 'button', className: 'nc-btn', onClick: () => void api.ui.openExternalUrl(client.webUrl(entry)) }, t('files.open')),
    ),
    !canDownload(entry) ? h('p', { className: 'nc-muted nc-small', style: { margin: 0 } }, t('files.cantDownload')) : null,
    busy ? h('p', { className: 'nc-muted nc-small', role: 'status', style: { margin: 0 } }, t('files.preparing', { name: entry.name })) : null,
    share && !link ? h('div', { className: 'nc-col' },
      h(ShareOptions, { api, client, value: share, onChange: setShare, idPrefix: 'nc-page' }),
      h('div', { className: 'nc-row' },
        h('button', {
          type: 'button', className: 'nc-btn nc-primary', disabled: !!busy,
          onClick: () => void run('share', async () => {
            const created = await client.share(entry.path, { password: share.usePassword ? share.password.trim() : '', expireDate: share.expireDate });
            setLink(created.url);
          }),
        }, t('files.createLink')),
        h('button', { type: 'button', className: 'nc-btn', onClick: () => setShare(null) }, t('common.cancel')),
      ),
    ) : null,
    link ? h('label', { className: 'nc-label' }, t('files.linkReady'),
      h('input', { className: 'nc-input', readOnly: true, value: link, onFocus: (e) => e.target.select(), 'aria-label': t('files.linkLabel') })) : null,
  );
}

export function FilesPage() {
  ensureStyles();
  const api = getApi();
  const t = api.i18n.t;
  const connection = useConnection(api);
  const client = useMemo(() => (connection.conn ? createClient(api, connection.conn) : null), [connection.conn]);
  const [path, setPath] = useState('/');
  const [selected, setSelected] = useState(() => new Map());
  const [reloadKey, setReloadKey] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const controllers = useRef(new Map());

  const report = (err) => { connection.report(err); setError(err); };
  const update = (id, patch) => setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const runJob = async (job) => {
    const controller = new AbortController();
    controllers.current.set(job.id, controller);
    update(job.id, { state: 'running', error: null });
    try {
      const target = job.target ?? await planUpload(client, job.folder, job.file.name);
      update(job.id, { target });
      await uploadFile(api, client, job.file, target, {
        signal: controller.signal,
        onProgress: (loaded, total) => update(job.id, { loaded, total }),
      });
      update(job.id, { state: 'done', loaded: job.file.size });
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof NcError && err.code === 'cancelled') update(job.id, { state: 'paused' });
      else { connection.report(err); update(job.id, { state: 'error', error: err }); }
    } finally {
      controllers.current.delete(job.id);
    }
  };

  const addFiles = (files) => {
    setError(null);
    const added = [...files].map((file) => ({ id: `${Date.now()}-${Math.random()}`, file, folder: path, state: 'running', loaded: 0, total: file.size }));
    setJobs((list) => [...list.filter((j) => j.state !== 'done'), ...added]);
    for (const job of added) void runJob(job);
  };

  if (connection.status !== 'connected' || !client) {
    return h('div', { className: 'nc', style: { padding: 16, maxWidth: 720 } },
      h('h1', { style: { fontSize: 18, margin: '0 0 12px' } }, t('page.title')),
      h(ConnectionPanel, { api, connection }));
  }

  const current = [...selected.values()][0] ?? null;
  return h('div', {
    className: 'nc nc-col', style: { padding: 16, maxWidth: 960, outline: dragging ? '2px dashed var(--color-primary)' : 'none' },
    onDragOver: (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); },
  },
  h('div', { className: 'nc-row' },
    h('h1', { className: 'nc-grow', style: { fontSize: 18, margin: 0 } }, t('page.title')),
    h(ConnectionPanel, { api, connection, compact: true }),
  ),
  h(FileBrowser, {
    api, client, mode: 'manage', path, reloadKey, listHeight: 460,
    onNavigate: (p) => { setPath(p); setSelected(new Map()); },
    selected,
    onToggle: (entry) => setSelected((prev) => (prev.has(entry.path) ? new Map() : new Map([[entry.path, entry]]))),
    onError: report,
    toolbar: h('div', { className: 'nc-row' },
      h('input', {
        ref: inputRef, type: 'file', multiple: true, style: { display: 'none' }, 'aria-hidden': 'true', tabIndex: -1,
        'data-testid': 'nc-upload-input',
        onChange: (e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; },
      }),
      h('button', { type: 'button', className: 'nc-btn nc-primary', onClick: () => inputRef.current?.click() }, t('files.upload')),
      h(NewFolder, { api, client, path, onCreated: (p) => { setPath(p); setReloadKey((k) => k + 1); }, onError: report }),
      h('span', { className: 'nc-muted nc-small nc-hide-narrow' }, t('files.uploadHint')),
    ),
  }),
  h(Uploads, {
    api, jobs,
    onCancel: (job) => controllers.current.get(job.id)?.abort(),
    onResume: (job) => void runJob(jobs.find((j) => j.id === job.id) ?? job),
    onDiscard: async (job) => {
      const latest = jobs.find((j) => j.id === job.id) ?? job;
      if (latest.target) await discardUpload(api, client, latest.file, latest.target).catch(() => {});
      setJobs((list) => list.filter((j) => j.id !== job.id));
    },
  }),
  error ? h('p', { className: 'nc-error', role: 'alert', style: { margin: 0 } }, errorText(t, error)) : null,
  h(Details, { api, client, entry: current && !current.isFolder ? current : null, onError: report }),
  );
}
