import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Checkbox, DialogButtons, Field, Input, LinkButton, Spinner, Stack, Text } from '@plugin-host/ui';
import { getApi, t, formatSize } from './host.js';
import { ErrorAlert, PickOne, TagPicker, useConnection, useTaxonomies } from './common.jsx';
import { suggestMetadata } from '../lib/suggest.js';

export const REMEMBERED_KEY = 'remembered';

function sameSender(groups) {
  const emails = new Set(groups.map((g) => (g.sender?.email || '').toLowerCase()));
  return emails.size === 1 ? groups[0].sender : null;
}

/** The documents already in Paperless, once each (two items can be the same file). */
export function distinctDocuments(duplicates) {
  const byId = new Map();
  for (const doc of Object.values(duplicates || {})) if (doc && !byId.has(doc.id)) byId.set(doc.id, doc);
  return [...byId.values()];
}

/**
 * The "Send to Paperless" dialog. Shows what will be sent, flags files that
 * are already in Paperless (by checksum) and suggests metadata from the
 * sender. Hands the choice back with onResult; the background does the upload.
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
  const [duplicates, setDuplicates] = useState({});
  const [checking, setChecking] = useState(true);

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

  // "Already in Paperless" by checksum.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    (async () => {
      const found = {};
      for (const item of items) {
        try {
          const hit = await client.findByChecksum({ sha256: item.sha256, md5: item.md5 });
          if (hit) found[item.key] = hit;
        } catch { /* the check is a hint; sending still works */ }
      }
      if (cancelled) return;
      setDuplicates(found);
      setChecking(false);
      if (Object.keys(found).length) {
        setSelected((prev) => new Set([...prev].filter((k) => !found[k])));
      }
    })();
    return () => { cancelled = true; };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const single = selected.size === 1 ? items.find((i) => selected.has(i.key)) : null;
  useEffect(() => { setTitle(single ? single.title : ''); }, [single?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!selected.size || !client) return;
    onResult?.({
      selected: [...selected],
      title: single ? title : '',
      correspondent, documentType, storagePath, tags,
      remember: !!(remember && sender?.email),
      senderEmail: sender?.email || '',
    });
  };

  const openDoc = (id) => { if (client) void getApi().ui.openExternalUrl(client.documentUrl(id)); };
  // One document already there: "Open in Paperless" in the footer. Several:
  // a line with its own link for each.
  const found = distinctDocuments(duplicates);

  const buttons = [
    { id: 'cancel', label: t('common.cancel'), variant: 'secondary' },
    ...(found.length === 1 ? [{ id: 'open', label: t('browse.open_in_paperless'), variant: 'secondary' }] : []),
    { id: 'send', label: selected.size > 1 ? t('send.button_count', { count: selected.size }) : t('send.button'), variant: 'primary', disabled: !selected.size || !client },
  ];
  const onButton = (id) => {
    if (id === 'cancel') onResult?.(null);
    else if (id === 'open' && found[0]) openDoc(found[0].id);
    else if (id === 'send') submit();
  };

  return (
    <Stack gap={4}>
      {connection?.state === 'error' && <ErrorAlert error={connection.error} />}
      {groups.map((group) => (
        <div key={group.emailId} role="group" aria-label={group.subject || t('send.no_subject')}>
          <Stack gap={3}>
            <Text tone="muted" truncate>
              {t('send.from_line', { sender: group.sender?.name || group.sender?.email || '?', subject: group.subject || t('send.no_subject') })}
            </Text>
            {group.items.map((item) => {
              const dup = duplicates[item.key];
              return (
                <Checkbox
                  key={item.key}
                  checked={selected.has(item.key)}
                  onChange={() => toggle(item.key)}
                  label={item.kind === 'eml' ? t('send.whole_message', { name: item.name }) : item.name}
                  hint={(
                    <>
                      {formatSize(item.size)}
                      {item.support === 'tika' && <>{' '}<Badge tone="warning">{t('send.needs_tika')}</Badge></>}
                      {item.support === 'no' && <>{' '}<Badge tone="warning">{t('send.unsupported')}</Badge></>}
                      {dup && <>{' '}<Badge tone="success">{t('send.already', { title: dup.title })}</Badge></>}
                    </>
                  )}
                />
              );
            })}
          </Stack>
        </div>
      ))}
      {checking && <Spinner size="sm" label={t('send.checking')} />}
      {found.length > 1 && found.map((doc) => (
        <Alert key={doc.id} tone="success" icon="circle-check" action={<LinkButton icon="external-link" onClick={() => openDoc(doc.id)}>{t('browse.open_in_paperless')}</LinkButton>}>
          {t('send.already', { title: doc.title })}
        </Alert>
      ))}

      <ErrorAlert error={taxError} onRetry={reload} />
      {single && (
        <Field label={t('field.title')}>
          <Input type="text" value={title} maxLength={128} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        </Field>
      )}
      {selected.size > 1 && <Text tone="muted">{t('send.titles_from_names')}</Text>}
      {!tax && !taxError && <Spinner size="sm" label={t('common.loading')} />}
      {tax && (
        <>
          <PickOne label={t('field.correspondent')} items={tax.correspondents} value={correspondent} onChange={setCorrespondent}
            suggested={suggestion?.correspondent != null && suggestion.correspondent === correspondent} />
          <PickOne label={t('field.document_type')} items={tax.documentTypes} value={documentType} onChange={setDocumentType}
            suggested={suggestion?.documentType != null && suggestion.documentType === documentType} />
          {tax.storagePaths.length > 0 && (
            <PickOne label={t('field.storage_path')} items={tax.storagePaths} value={storagePath} onChange={setStoragePath} />
          )}
          <TagPicker tags={tax.tags} value={tags} onChange={setTags} />
          {suggestion?.source === 'remembered' && <Text tone="muted">{t('send.remembered_note')}</Text>}
          {sender?.email && (
            <Checkbox checked={remember} onChange={setRemember} label={t('send.remember', { sender: sender.email })} />
          )}
        </>
      )}
      <DialogButtons buttons={buttons} onClick={onButton} />
    </Stack>
  );
}
