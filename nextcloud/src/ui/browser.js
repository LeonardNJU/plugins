// A Nextcloud file browser: folders, recent files and search, used by the
// file picker, the folder picker and the Files page.

import { createElement as h, useEffect, useRef, useState } from 'react';
import { breadcrumb, parentPath } from '../lib/paths.js';
import { errorText } from '../lib/errors.js';
import { formatDate, formatSize } from '../lib/format.js';
import { Icon } from './icons.js';

/**
 * mode: "files" (pick several files), "folder" (pick a folder), "manage"
 * (Files page: one item at a time). `selected` is a Map path -> entry.
 */
export function FileBrowser({
  api, client, mode, path, onNavigate, selected, onToggle, reloadKey = 0, onError, listHeight = 320, toolbar,
}) {
  const t = api.i18n.t;
  const locale = api.i18n.getLocale();
  const [view, setView] = useState('files');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [state, setState] = useState({ loading: true, entries: [], error: null });
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const load = view === 'recent'
      ? client.recent({ limit: 50 })
      : view === 'search'
        ? client.search(searched, { limit: 100 })
        : client.list(path, locale);
    load.then(
      (entries) => { if (seq.current === mine) setState({ loading: false, entries, error: null }); },
      (error) => {
        if (seq.current !== mine) return;
        setState({ loading: false, entries: [], error });
        onError?.(error);
      },
    );
  }, [client, view, path, searched, reloadKey]);

  const runSearch = (e) => {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) { setView('files'); return; }
    setSearched(q);
    setView('search');
  };

  const shown = mode === 'folder' && view !== 'files' ? state.entries.filter((e) => e.isFolder) : state.entries;
  const flat = view !== 'files';

  const open = (entry) => {
    if (entry.isFolder) {
      setView('files');
      onNavigate(entry.path);
      return;
    }
    if (mode !== 'folder') onToggle?.(entry);
  };

  const tab = (id, label) => h('button', {
    type: 'button', role: 'tab', className: 'nc-tab', 'aria-selected': view === id ? 'true' : 'false',
    onClick: () => { setView(id); if (id !== 'search') setQuery(''); },
  }, label);

  const crumbs = breadcrumb(path);
  return h('div', { className: 'nc-col' },
    // No <form>: the sandboxed iframe may not submit forms.
    h('div', { className: 'nc-row', role: 'search' },
      h('label', { className: 'nc-sr', htmlFor: 'nc-search' }, t('browser.search')),
      h('input', {
        id: 'nc-search', className: 'nc-input nc-grow', type: 'search', value: query, placeholder: t('browser.searchPlaceholder'),
        onChange: (e) => setQuery(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') runSearch(e); },
      }),
      h('button', { type: 'button', className: 'nc-btn', onClick: runSearch }, t('browser.search')),
    ),
    h('div', { className: 'nc-tabs', role: 'tablist' },
      tab('files', t('browser.allFiles')),
      tab('recent', t('browser.recent')),
      view === 'search' ? tab('search', t('browser.results', { query: searched })) : null,
    ),
    view === 'files'
      ? h('nav', { className: 'nc-crumbs', 'aria-label': t('browser.location') },
        path !== '/' ? h('button', {
          type: 'button', className: 'nc-crumb', onClick: () => onNavigate(parentPath(path)), 'aria-label': t('browser.up'), title: t('browser.up'),
        }, h(Icon, { name: 'up', size: 14, className: '' })) : null,
        ...crumbs.map((c, i) => [
          i > 0 ? h('span', { key: `s${i}`, className: 'nc-muted', 'aria-hidden': 'true' }, '/') : null,
          h('button', {
            key: c.path, type: 'button', className: 'nc-crumb', onClick: () => onNavigate(c.path),
            'aria-current': i === crumbs.length - 1 ? 'page' : undefined,
          }, c.name || t('browser.home')),
        ]).flat().filter(Boolean),
      )
      : null,
    toolbar ?? null,
    h('div', { className: 'nc-list', style: { maxHeight: listHeight, minHeight: Math.min(listHeight, 160) }, 'aria-busy': state.loading ? 'true' : 'false' },
      state.loading
        ? h('div', { className: 'nc-empty', role: 'status' }, t('browser.loading'))
        : state.error
          ? h('div', { className: 'nc-empty nc-error', role: 'alert' }, errorText(t, state.error))
          : shown.length === 0
            ? h('div', { className: 'nc-empty' }, view === 'search' ? t('browser.noResults') : view === 'recent' ? t('browser.noRecent') : t('browser.empty'))
            : shown.map((entry) => {
              const isSelected = selected?.has(entry.path) ?? false;
              const pickable = entry.isFolder || mode !== 'folder';
              const meta = entry.isFolder
                ? (flat ? parentPath(entry.path) : '')
                : [flat ? parentPath(entry.path) : '', formatSize(entry.size, locale), formatDate(entry.modified, locale)].filter(Boolean).join(' · ');
              return h('button', {
                key: entry.path,
                type: 'button',
                className: 'nc-item',
                disabled: !pickable,
                'data-checked': isSelected ? 'true' : 'false',
                'aria-pressed': !entry.isFolder && mode !== 'folder' ? (isSelected ? 'true' : 'false') : undefined,
                'data-path': entry.path,
                onClick: () => open(entry),
                style: pickable ? undefined : { opacity: 0.5, cursor: 'default' },
              },
              mode === 'files' && !entry.isFolder
                ? h('input', { type: 'checkbox', className: 'nc-check', checked: isSelected, readOnly: true, tabIndex: -1, 'aria-hidden': 'true' })
                : null,
              h(Icon, { name: entry.isFolder ? 'folder' : 'file' }),
              h('span', { className: 'nc-name', title: entry.name }, entry.name),
              meta ? h('span', { className: 'nc-meta nc-hide-narrow' }, meta) : null,
              );
            }),
    ),
  );
}
