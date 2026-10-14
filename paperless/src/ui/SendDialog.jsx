import { useEffect, useMemo, useState } from 'react';
import { getApi, t, formatSize } from './host.js';
import { ErrorBox, Field, PickOne, Styles, TagPicker, useConnection, useTaxonomies } from './common.jsx';
import { suggestMetadata } from '../lib/suggest.js';

export const REMEMBERED_KEY = 'remembered';

function sameSender(groups) {
  const emails = new Set(groups.map((g) => (g.sender?.email || '').toLowerCase()));
  return emails.size === 1 ? groups[0].sender : null;
}

/**
 * The "Send to Paperless" dialog. Shows what will be sent and suggests
 * metadata from the sender. Hands the choice back with onResult; the background does the upload.
 */
export function SendDialog({ groups = [], connection: initialConnection, onResult }) {
  const { client, connection } = useConnection(initialConnection);
  const { tax, error: taxError, reload } = useTaxonomies(client);
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const sender = sameSender(groups);
  const [selected, setSelected] = useState(() => new Set(items.filter((i) => i.selected).map((i) => i.key)));
  const [title, setTitle] = useState('');
  const [correspondent, setCorrespondent] = useState(null);
  const [documentType, setDocumentType] = useState(null);
  const [storagePath, setStoragePath] = useState(null);
  const [tags, setTags] = useState([]);
  const [suggestion, setSuggestion] = useState(null);
  const [remember, setRemember] = useState(true);

  // Suggestions once the lists are in.
  useEffect(() => {
    if (!tax) return;
    let cancelled = false;
    (async () => {
      const api = getApi();
      const remembered = (await api.storage.get(REMEMBERED_KEY).catch(() => null)) || {};
      const text = [...groups.map((g) => g.subject), ...items.map((i) => i.name)].join(' ');
      const s = suggestMetadata({ sender: sender || {}, text }, tax, sender ? remembered : {});
      if (cancelled) return;
      setSuggestion(s);
      setCorrespondent(sender ? s.correspondent : null);
      setDocumentType(s.documentType);
      setStoragePath(s.storagePath);
      setTags(s.tags);
    })();
    return () => { cancelled = true; };
  }, [tax]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const single = selected.size === 1 ? items.find((i) => selected.has(i.key)) : null;
  useEffect(() => { setTitle(single ? single.title : ''); }, [single?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // A button, not a form: the sandboxed frame may not submit forms.
  const submit = (e) => {
    e?.preventDefault?.();
    if (!selected.size) return;
    onResult?.({
      selected: [...selected],
      title: single ? title : '',
      correspondent, documentType, storagePath, tags,
      remember: !!(remember && sender?.email),
      senderEmail: sender?.email || '',
    });
  };

  return (
    <div className="pl" style={{ padding: 4 }}>
      <Styles />
      {connection?.state === 'error' && <ErrorBox error={connection.error} />}
      {groups.map((group) => (
        <section key={group.emailId} style={{ marginBottom: 12 }} aria-label={group.subject || t('send.no_subject')}>
          <div className="pl-muted" style={{ marginBottom: 6 }}>
            {t('send.from_line', { sender: group.sender?.name || group.sender?.email || '?', subject: group.subject || t('send.no_subject') })}
          </div>
          <ul className="pl-list">
            {group.items.map((item) => {
              const id = `pl-item-${item.key.replace(/[^a-z0-9]/gi, '-')}`;
              return (
                <li key={item.key} className={`pl-item${selected.has(item.key) ? ' pl-active' : ''}`}>
                  <input id={id} type="checkbox" checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
                  <div className="pl-grow">
                    <label htmlFor={id} className="pl-name">
                      {item.kind === 'eml' ? t('send.whole_message', { name: item.name }) : item.name}
                    </label>
                    <div className="pl-row" style={{ marginTop: 2 }}>
                      <span className="pl-muted">{formatSize(item.size)}</span>
                      {item.support === 'tika' && <span className="pl-badge pl-warn">{t('send.needs_tika')}</span>}
                      {item.support === 'no' && <span className="pl-badge pl-warn">{t('send.unsupported')}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <ErrorBox error={taxError} onRetry={reload} />
      {single && (
        <Field id="pl-title" label={t('field.title')} style={{ marginBottom: 10 }}>
          <input id="pl-title" type="text" value={title} maxLength={128} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(e); }} />
        </Field>
      )}
      {selected.size > 1 && <p className="pl-muted">{t('send.titles_from_names')}</p>}
      {!tax && !taxError && <p className="pl-muted" aria-live="polite">{t('common.loading')}</p>}
      {tax && (
        <>
          <div className="pl-grid">
            <PickOne id="pl-corr" label={t('field.correspondent')} items={tax.correspondents} value={correspondent} onChange={setCorrespondent}
              suggested={suggestion?.correspondent != null && suggestion.correspondent === correspondent} />
            <PickOne id="pl-type" label={t('field.document_type')} items={tax.documentTypes} value={documentType} onChange={setDocumentType}
              suggested={suggestion?.documentType != null && suggestion.documentType === documentType} />
            {tax.storagePaths.length > 0 && (
              <PickOne id="pl-path" label={t('field.storage_path')} items={tax.storagePaths} value={storagePath} onChange={setStoragePath} />
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <TagPicker tags={tax.tags} value={tags} onChange={setTags} />
          </div>
          {suggestion?.source === 'remembered' && <p className="pl-muted">{t('send.remembered_note')}</p>}
          {sender?.email && (
            <label className="pl-row" style={{ marginTop: 10, fontSize: 13 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t('send.remember', { sender: sender.email })}
            </label>
          )}
        </>
      )}
      <div className="pl-actions">
        <button type="button" onClick={() => onResult?.(null)}>{t('common.cancel')}</button>
        <button type="button" className="pl-primary" disabled={!selected.size || !client} onClick={submit}>
          {selected.size > 1 ? t('send.button_count', { count: selected.size }) : t('send.button')}
        </button>
      </div>
    </div>
  );
}
