// The Nextcloud file browser shared by the file picker, the folder picker
// and the Files page: the listing state (folder, recent files, search) and
// the parts that show it, drawn with the app's UI kit like the Files app.

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react';
import {
  Breadcrumbs, Button, EmptyState, List, ListRow, Loading, SearchInput, ToolbarButton,
} from '@plugin-host/ui';
import { breadcrumb, parentPath } from '../lib/paths.js';
import { errorText } from '../lib/errors.js';
import { formatDate, formatSize } from '../lib/format.js';

const SEARCH_DELAY_MS = 350;

/**
 * The listing of one place: the folder at `path`, recent files, or search
 * results for what the user typed (searched once they stop typing).
 */
export function useBrowser({ api, client, path, reloadKey = 0, onError }) {
  const locale = api.i18n.getLocale();
  const [view, setView] = useState('files');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [state, setState] = useState({ loading: true, entries: [], error: null });
  const [retry, setRetry] = useState(0);
  const seq = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setView((v) => (v === 'search' ? 'files' : v));
      return undefined;
    }
    const timer = setTimeout(() => { setSearched(q); setView('search'); }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

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
        onErrorRef.current?.(error);
      },
    );
  }, [client, view, path, searched, reloadKey, retry]);

  const showView = useCallback((next) => {
    setView(next);
    if (next !== 'search') setQuery('');
  }, []);

  return {
    view, query, searched, ...state,
    setQuery,
    showView,
    reload: () => setRetry((n) => n + 1),
  };
}

/** The breadcrumb items for where the browser is. Ids starting with "#" are views. */
export function crumbItems(t, browser, path) {
  if (browser.view === 'recent') return [{ id: '#files', label: t('browser.allFiles') }, { id: '#recent', label: t('browser.recent') }];
  if (browser.view === 'search') return [{ id: '#files', label: t('browser.allFiles') }, { id: '#search', label: t('browser.results', { query: browser.searched }) }];
  return breadcrumb(path).map((c) => ({ id: c.path, label: c.name || t('browser.home') }));
}

/** Breadcrumbs, search box and the Recent toggle, for a Toolbar or a dialog's top row. */
export function browserBar({ api, browser, path, onNavigate, compact = false, search = true }) {
  const t = api.i18n.t;
  const select = (id) => {
    if (id === '#files') { browser.showView('files'); return; }
    if (id.startsWith('#')) return;
    browser.showView('files');
    onNavigate(id);
  };
  return [
    h(Breadcrumbs, { key: 'crumbs', items: crumbItems(t, browser, path), onSelect: select, label: t('browser.location') }),
    search ? h(SearchInput, {
      key: 'search', value: browser.query, onChange: browser.setQuery,
      placeholder: t('browser.searchPlaceholder'), label: t('browser.search'),
    }) : null,
    h(ToolbarButton, {
      key: 'recent', icon: 'clock', label: t('browser.recent'), compact, active: browser.view === 'recent',
      onClick: () => browser.showView(browser.view === 'recent' ? 'files' : 'recent'),
    }),
  ];
}

/**
 * The entries as Files app rows. mode: "files" (tick several files),
 * "folder" (only folders can be opened), "manage" (Files page: one file
 * selected at a time). `selected` is a Map path -> entry. `columns` adds the
 * Files app's column header and the modified date.
 */
export function BrowserList({ api, browser, mode, selected, onNavigate, onToggle, columns = false, before = null, empty = null }) {
  const t = api.i18n.t;
  const locale = api.i18n.getLocale();
  const flat = browser.view !== 'files';
  const shown = mode === 'folder' && flat ? browser.entries.filter((e) => e.isFolder) : browser.entries;

  let body;
  if (browser.loading) {
    body = h(Loading, { label: t('browser.loading') });
  } else if (browser.error) {
    body = h(EmptyState, {
      icon: 'alert-triangle', compact: !columns, title: errorText(t, browser.error),
      actions: h(Button, { variant: 'secondary', size: 'sm', onClick: browser.reload }, t('browser.retry')),
    });
  } else if (shown.length === 0) {
    body = browser.view === 'search'
      ? h(EmptyState, { icon: 'search', compact: !columns, title: t('browser.noResults') })
      : browser.view === 'recent'
        ? h(EmptyState, { icon: 'clock', compact: !columns, title: t('browser.noRecent') })
        : (empty ?? h(EmptyState, { icon: 'folder-open', compact: !columns, title: t('browser.empty') }));
  } else {
    body = shown.map((entry) => {
      const isSelected = selected?.has(entry.path) ?? false;
      const pickable = entry.isFolder || mode !== 'folder';
      const size = entry.isFolder ? '—' : formatSize(entry.size, locale);
      const meta = columns ? [size, formatDate(entry.modified, locale)] : entry.isFolder ? undefined : [size];
      const parent = parentPath(entry.path);
      const where = flat ? (parent === '/' ? t('browser.home') : parent) : undefined;
      const tickable = mode === 'files' && !entry.isFolder;
      return h(ListRow, {
        key: entry.path,
        title: entry.name,
        subtitle: where,
        icon: entry.isFolder ? 'folder' : entry.name,
        folder: entry.isFolder,
        meta,
        selected: isSelected,
        disabled: !pickable,
        checked: tickable ? isSelected : undefined,
        onCheck: tickable ? () => onToggle?.(entry) : undefined,
        onClick: () => {
          if (entry.isFolder) { browser.showView('files'); onNavigate(entry.path); return; }
          if (mode !== 'folder') onToggle?.(entry);
        },
      });
    });
  }

  const hasRows = !browser.loading && !browser.error && shown.length > 0;
  const cols = columns && (hasRows || before) ? [
    { label: t('files.name') },
    { label: t('files.size'), align: 'end' },
    { label: t('files.modified'), align: 'end', hideNarrow: true },
  ] : undefined;
  return h(List, { label: t('browser.location'), columns: cols }, before, body);
}
