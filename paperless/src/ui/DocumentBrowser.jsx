import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi, t, formatDate } from './host.js';
import { ConnectPanel, ErrorBox, Field, PickOne, Styles, TagPicker, useConnection, useTaxonomies } from './common.jsx';
import { attachDocuments, downloadDocument } from '../lib/documents.js';

const nameOf = (list, id) => list?.find((x) => x.id === id)?.name || '';

/** Thumbnails as object URLs, loaded lazily and revoked on unmount. */
function useThumbs(client) {
  const [urls, setUrls] = useState({});
  const asked = useRef(new Set());
  const made = useRef([]);
  useEffect(() => () => { for (const u of made.current) URL.revokeObjectURL(u); }, []);
  const want = useCallback((id) => {
    if (!client || asked.current.has(id)) return;
    asked.current.add(id);
    client.thumbnail(id).then((thumb) => {
      const url = URL.createObjectURL(new Blob([thumb.data], { type: thumb.type }));
      made.current.push(url);
      setUrls((prev) => ({ ...prev, [id]: url }));
    }).catch(() => { /* no thumbnail: the placeholder stays */ });
  }, [client]);
  return { urls, want };
}

function Thumb({ id, thumbs, alt }) {
  useEffect(() => { thumbs.want(id); }, [id, thumbs]);
  const url = thumbs.urls[id];
  return url ? <img className="pl-thumb" src={url} alt={alt} /> : <div className="pl-thumb" aria-hidden="true" />;
}

/** Preview: the image itself for picture documents, else the large thumbnail. */
function Preview({ client, doc, thumbs }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let made = null;
    let cancelled = false;
    if (client && /^image\//.test(doc.mime_type || '')) {
      client.preview(doc.id).then((p) => {
        if (cancelled) return;
        made = URL.createObjectURL(new Blob([p.data], { type: p.type }));
        setUrl(made);
      }).catch(() => {});
    } else {
      thumbs.want(doc.id);
    }
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [client, doc.id, doc.mime_type, thumbs]);
  const src = url || thumbs.urls[doc.id];
  return src ? <img className="pl-big" src={src} alt={t('browse.preview_of', { title: doc.title })} /> : null;
}

/**
 * Search Paperless and use documents in mail. Used by the app page and by
 * the "Browse documents" dialog.
 */
export function DocumentBrowser({ onClose, inDialog = false }) {
  const { connection, client, loading, refresh } = useConnection();
  const { tax } = useTaxonomies(client);
  const [filters, setFilters] = useState({ text: '', tags: [], correspondent: null, documentType: null, from: '', to: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState('');
  const thumbs = useThumbs(client);
  const api = getApi();

  // Only the latest search may fill the list: an earlier, slower one must
  // not overwrite it.
  const seq = useRef(0);
  const run = useCallback(async (nextPage = 1, f = filters) => {
    if (!client) return;
    const mine = ++seq.current;
    setSearching(true);
    setError(null);
    try {
      const res = await client.searchDocuments(f, nextPage);
      if (mine !== seq.current) return;
      setResults((prev) => (nextPage === 1 ? res.results : [...prev, ...res.results]));
      setCount(res.count);
      setHasMore(res.hasMore);
      setPage(nextPage);
    } catch (err) {
      if (mine === seq.current) setError(err);
    } finally {
      if (mine === seq.current) setSearching(false);
    }
  }, [client, filters]);

  useEffect(() => { if (client) void run(1); }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setFilters((prev) => ({ ...prev, ...patch }));
  const pickedDocs = results.filter((d) => picked.has(d.id));

  const attach = async (docs) => {
    setBusy('attach');
    setError(null);
    try {
      await attachDocuments(api, client, docs, (i, n) => setBusy(t('browse.attaching', { current: i + 1, total: n })));
      if (inDialog) onClose?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  };

  const download = async (doc) => {
    setBusy('download');
    setError(null);
    try {
      await downloadDocument(api, client, doc);
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  };

  if (loading) return <div className="pl pl-page"><Styles /><p className="pl-muted">{t('common.loading')}</p></div>;
  if (connection?.state === 'disconnected') {
    return <div className="pl pl-page"><Styles /><h2>{t('page.title')}</h2><ConnectPanel connection={connection} onConnected={() => refresh()} /></div>;
  }
  if (connection?.state === 'error') {
    return <div className="pl pl-page"><Styles /><h2>{t('page.title')}</h2><ErrorBox error={connection.error} onRetry={refresh} /></div>;
  }

  return (
    <div className={`pl${inDialog ? '' : ' pl-page'}`}>
      <Styles />
      {!inDialog && <h2>{t('page.title')}</h2>}
      {/* No <form>: the sandboxed frame may not submit forms, so Enter and the button search directly. */}
      <div role="search" className="pl-row">
        <label htmlFor="pl-q" className="pl-sr">{t('browse.search_label')}</label>
        <input id="pl-q" type="search" className="pl-grow" style={{ flexBasis: 220 }} placeholder={t('browse.search_placeholder')}
          value={filters.text} onChange={(e) => set({ text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setOpen(null); void run(1); } }} />
        <button type="button" className="pl-primary" disabled={searching} onClick={() => { setOpen(null); void run(1); }}>{t('browse.search')}</button>
        <button type="button" aria-expanded={showFilters} aria-controls="pl-filters" onClick={() => setShowFilters((v) => !v)}>
          {t('browse.filters')}
        </button>
      </div>
      {showFilters && tax && (
        <div id="pl-filters" className="pl-card" style={{ marginTop: 8 }}>
          <div className="pl-grid">
            <PickOne id="pl-f-corr" label={t('field.correspondent')} items={tax.correspondents} value={filters.correspondent}
              onChange={(v) => set({ correspondent: v })} noneLabel={t('common.any')} />
            <PickOne id="pl-f-type" label={t('field.document_type')} items={tax.documentTypes} value={filters.documentType}
              onChange={(v) => set({ documentType: v })} noneLabel={t('common.any')} />
            <Field id="pl-f-from" label={t('browse.from')}>
              <input id="pl-f-from" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></Field>
            <Field id="pl-f-to" label={t('browse.to')}>
              <input id="pl-f-to" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: 8 }}>
            <TagPicker tags={tax.tags} value={filters.tags} onChange={(v) => set({ tags: v })} label={t('browse.with_tags')} />
          </div>
          <div className="pl-actions">
            <button type="button" onClick={() => { const empty = { text: filters.text, tags: [], correspondent: null, documentType: null, from: '', to: '' }; setFilters(empty); void run(1, empty); }}>
              {t('browse.clear_filters')}
            </button>
            <button type="button" className="pl-primary" onClick={() => { setOpen(null); void run(1); }}>{t('browse.apply')}</button>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      <p className="pl-muted" aria-live="polite" style={{ marginTop: 8 }}>
        {searching ? t('browse.searching') : t('browse.count', { count })}
      </p>
      <div className="pl-docs">
        <ul className="pl-list" aria-label={t('browse.results')}>
          {results.map((doc) => (
            <li key={doc.id} className={`pl-item${open?.id === doc.id ? ' pl-active' : ''}`}>
              <input type="checkbox" aria-label={t('browse.select', { title: doc.title })} checked={picked.has(doc.id)}
                onChange={() => setPicked((prev) => { const n = new Set(prev); if (n.has(doc.id)) n.delete(doc.id); else n.add(doc.id); return n; })} />
              <Thumb id={doc.id} thumbs={thumbs} alt="" />
              <div className="pl-grow">
                <button type="button" className="pl-link pl-name" style={{ textAlign: 'start', padding: 0 }} onClick={() => setOpen(doc)}>
                  {doc.title}
                </button>
                <div className="pl-muted">{[nameOf(tax?.correspondents, doc.correspondent), formatDate(doc.created)].filter(Boolean).join(' · ')}</div>
                <div className="pl-row" style={{ marginTop: 4 }}>
                  {nameOf(tax?.documentTypes, doc.document_type) && <span className="pl-badge pl-type">{nameOf(tax?.documentTypes, doc.document_type)}</span>}
                  {(doc.tags || []).map((id) => nameOf(tax?.tags, id)).filter(Boolean).map((n) => <span key={n} className="pl-badge">{n}</span>)}
                </div>
              </div>
            </li>
          ))}
          {hasMore && (
            <li><button type="button" onClick={() => run(page + 1)} disabled={searching}>{t('browse.more')}</button></li>
          )}
        </ul>
        {open && (
          <section className="pl-card pl-detail" aria-label={open.title}>
            <div className="pl-row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{open.title}</h3>
              <button type="button" onClick={() => setOpen(null)} aria-label={t('common.close')}>×</button>
            </div>
            <Preview client={client} doc={open} thumbs={thumbs} />
            <dl className="pl-dl">
              <dt>{t('field.correspondent')}</dt><dd>{nameOf(tax?.correspondents, open.correspondent) || '-'}</dd>
              <dt>{t('field.document_type')}</dt><dd>{nameOf(tax?.documentTypes, open.document_type) || '-'}</dd>
              <dt>{t('field.created')}</dt><dd>{formatDate(open.created)}</dd>
              <dt>{t('field.file')}</dt><dd>{open.original_file_name || '-'}</dd>
            </dl>
            {open.content && <div className="pl-content" tabIndex={0} aria-label={t('browse.text')}>{String(open.content).slice(0, 2000)}</div>}
            <div className="pl-actions">
              <button type="button" onClick={() => api.ui.openExternalUrl(client.documentUrl(open.id))}>{t('browse.open_in_paperless')}</button>
              <button type="button" onClick={() => download(open)} disabled={!!busy}>{t('browse.download')}</button>
              <button type="button" className="pl-primary" onClick={() => attach([open])} disabled={!!busy}>{t('browse.attach')}</button>
            </div>
          </section>
        )}
      </div>
      {picked.size > 0 && (
        <div className="pl-bar pl-row">
          <span className="pl-grow">{t('browse.selected', { count: picked.size })}</span>
          <button type="button" onClick={() => setPicked(new Set())}>{t('browse.clear_selection')}</button>
          <button type="button" className="pl-primary" disabled={!!busy || pickedDocs.length === 0} onClick={() => attach(pickedDocs)}>
            {t('browse.attach_count', { count: picked.size })}
          </button>
        </div>
      )}
      {busy && busy !== 'attach' && busy !== 'download' && <p className="pl-muted" aria-live="polite">{busy}</p>}
      {busy === 'attach' && <p className="pl-muted" aria-live="polite">{t('common.working')}</p>}
    </div>
  );
}
