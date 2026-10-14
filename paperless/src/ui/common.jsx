import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, EmptyState, Field, LinkButton, Row, Select, Stack, Text } from '@plugin-host/ui';
import { getApi, t, hostOf } from './host.js';
import { clientFor, connectPersonal, resolveConnection } from '../lib/connection.js';
import { errorText } from '../lib/errors.js';

/** The connection, resolved once per mount; `refresh` re-checks it. */
export function useConnection(initial) {
  const [connection, setConnection] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setConnection(await resolveConnection(getApi()));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (!initial) void refresh(); }, [initial, refresh]);
  const client = useMemo(() => (connection?.state === 'connected' ? clientFor(getApi(), connection) : null), [connection]);
  return { connection, client, loading, refresh };
}

/** An error in the app's error bar, with "Retry" when there is something to retry. */
export function ErrorAlert({ error, onRetry }) {
  if (!error) return null;
  return (
    <Alert tone="danger" icon="alert-circle" action={onRetry ? <LinkButton onClick={onRetry}>{t('common.retry')}</LinkButton> : null}>
      {errorText(t, error)}
    </Alert>
  );
}

/** Runs the host's "Connect" dialog. */
export function useConnect(connection, onConnected) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await connectPersonal(getApi(), connection?.suggestedServer || '');
      if (result.connected) onConnected?.(result.connection);
      else if (result.error) setError(result.error);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, connect };
}

export function connectIntro(connection) {
  return connection?.suggestedServer
    ? t('connect.intro_server', { host: hostOf(connection.suggestedServer) })
    : t('connect.intro');
}

/** "Connect Paperless" for a user without a connection, as the Files app's empty state. */
export function ConnectEmptyState({ connection, onConnected }) {
  const { busy, error, connect } = useConnect(connection, onConnected);
  return (
    <Stack gap={4}>
      <EmptyState
        icon="archive"
        title={t('connect.title')}
        description={`${connectIntro(connection)} ${t('connect.token_hint')}`}
        actions={<Button busy={busy} onClick={connect}>{t('connect.button')}</Button>}
      />
      <ErrorAlert error={error} />
    </Stack>
  );
}

/** A select over Paperless objects, with an empty "none" entry. */
export function PickOne({ label, items, value, onChange, noneLabel, suggested, block = true }) {
  return (
    <Field label={suggested ? <>{label} <Badge tone="success">{t('send.suggested')}</Badge></> : label}>
      <Select
        block={block}
        value={value == null ? '' : String(value)}
        onChange={(v) => onChange(v === '' ? null : Number(v))}
        options={[{ value: '', label: noneLabel || t('common.none') }, ...(items || []).map((it) => ({ value: String(it.id), label: it.name }))]}
      />
    </Field>
  );
}

/** Tags as a row of check boxes. */
export function TagPicker({ tags, value, onChange, label }) {
  const on = new Set(value || []);
  if (!tags?.length) return null;
  const toggle = (id) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  };
  const name = label || t('field.tags');
  return (
    <div role="group" aria-label={name}>
      <Stack gap={2}>
        <Text weight="medium">{name}</Text>
        <Row gap={4}>
          {tags.map((tag) => (
            <Checkbox key={tag.id} label={tag.name} checked={on.has(tag.id)} onChange={() => toggle(tag.id)} />
          ))}
        </Row>
      </Stack>
    </div>
  );
}

/** The taxonomies of a client, loaded once. */
export function useTaxonomies(client) {
  const [tax, setTax] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      setTax(await client.taxonomies());
    } catch (err) {
      setError(err);
    }
  }, [client?.base, client?.credentialId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  return { tax, error, reload: load };
}
