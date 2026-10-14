import { useEffect, useState } from 'react';
import {
  Button, Card, Checkbox, Field, Input, Loading, Row, RowAction, Section, Select, SettingRow, Stack, Switch, Text,
} from '@plugin-host/ui';
import { getApi, t, hostOf } from './host.js';
import { ErrorAlert, PickOne, TagPicker, connectIntro, useConnect, useConnection, useTaxonomies } from './common.jsx';
import { PERSONAL } from '../lib/connection.js';
import { RULES_KEY, normalizeRule, normalizeRules } from '../lib/rules.js';

const EMPTY_RULE = { from: '', subject: '', what: 'attachments', tags: [], correspondent: null, documentType: null, storagePath: null, enabled: false };

function RuleForm({ initial, tax, onSave, onCancel }) {
  const [rule, setRule] = useState({ ...EMPTY_RULE, ...initial });
  const set = (patch) => setRule((prev) => ({ ...prev, ...patch }));
  const valid = rule.from.trim().length > 0;
  return (
    <div role="group" aria-label={t('rules.form')}>
      <Card title={t('rules.form')}>
        <Stack gap={4}>
          <Field label={t('rules.from')} required>
            <Input type="text" required value={rule.from} placeholder={t('rules.from_placeholder')} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field label={t('rules.subject')}>
            <Input type="text" value={rule.subject} placeholder={t('rules.subject_placeholder')} onChange={(e) => set({ subject: e.target.value })} />
          </Field>
          <Field label={t('rules.what')}>
            <Select block value={rule.what} onChange={(v) => set({ what: v })} options={[
              { value: 'attachments', label: t('rules.what_attachments') },
              { value: 'message', label: t('rules.what_message') },
            ]} />
          </Field>
          {tax && (
            <>
              <PickOne label={t('field.correspondent')} items={tax.correspondents} value={rule.correspondent} onChange={(v) => set({ correspondent: v })} />
              <PickOne label={t('field.document_type')} items={tax.documentTypes} value={rule.documentType} onChange={(v) => set({ documentType: v })} />
              {tax.storagePaths.length > 0 && (
                <PickOne label={t('field.storage_path')} items={tax.storagePaths} value={rule.storagePath} onChange={(v) => set({ storagePath: v })} />
              )}
              <TagPicker tags={tax.tags} value={rule.tags} onChange={(v) => set({ tags: v })} />
            </>
          )}
          <Checkbox checked={rule.enabled} onChange={(v) => set({ enabled: v })} label={t('rules.enable')} />
          <Row justify="end">
            <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
            <Button disabled={!valid} onClick={() => onSave(rule)}>{t('rules.save')}</Button>
          </Row>
        </Stack>
      </Card>
    </div>
  );
}

function describeRule(rule, tax) {
  const names = (list, ids) => ids.map((id) => list?.find((x) => x.id === id)?.name).filter(Boolean);
  const parts = [rule.what === 'message' ? t('rules.what_message') : t('rules.what_attachments')];
  const corr = tax?.correspondents?.find((x) => x.id === rule.correspondent)?.name;
  const type = tax?.documentTypes?.find((x) => x.id === rule.documentType)?.name;
  if (corr) parts.push(`${t('field.correspondent')}: ${corr}`);
  if (type) parts.push(`${t('field.document_type')}: ${type}`);
  const tagNames = names(tax?.tags, rule.tags);
  if (tagNames.length) parts.push(`${t('field.tags')}: ${tagNames.join(', ')}`);
  return parts.join(' · ');
}

function Rules({ client }) {
  const { tax } = useTaxonomies(client);
  const [rules, setRules] = useState(null);
  const [editing, setEditing] = useState(null); // rule id, 'new' or null
  const [error, setError] = useState(null);
  const api = getApi();

  useEffect(() => {
    api.storage.get(RULES_KEY).then((r) => setRules(normalizeRules(r))).catch((err) => { setError(err); setRules([]); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next) => {
    setError(null);
    try {
      await api.storage.set(RULES_KEY, next);
      setRules(next);
      setEditing(null);
    } catch (err) {
      setError(err);
    }
  };

  const upsert = (raw) => {
    const prev = rules.find((r) => r.id === raw.id);
    // Switching a rule on starts its clock: older mail is never touched.
    const enabledAt = raw.enabled ? (prev?.enabled ? prev.enabledAt : Date.now()) : null;
    const rule = normalizeRule({ ...raw, enabledAt });
    if (!rule) return;
    void save(prev ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);
  };

  return (
    <Section title={t('rules.title')} description={t('rules.intro')}>
      <ErrorAlert error={error} />
      {!rules && <Loading />}
      {rules && rules.length === 0 && editing !== 'new' && <Text tone="muted">{t('rules.none')}</Text>}
      {rules?.length > 0 && (
        <div>
          {rules.map((rule) => (editing === rule.id ? (
            <RuleForm key={rule.id} initial={rule} tax={tax} onSave={upsert} onCancel={() => setEditing(null)} />
          ) : (
            <SettingRow
              key={rule.id}
              label={rule.subject
                ? t('rules.summary_subject', { from: rule.from, subject: rule.subject })
                : t('rules.summary', { from: rule.from })}
              description={describeRule(rule, tax)}
            >
              <Row gap={1} wrap={false}>
                <RowAction icon="pencil" label={t('common.edit')} onClick={() => setEditing(rule.id)} />
                <RowAction icon="trash" danger label={t('rules.delete', { from: rule.from })} onClick={() => save(rules.filter((r) => r.id !== rule.id))} />
                <Switch checked={rule.enabled} label={t('rules.toggle', { from: rule.from })} onChange={(on) => upsert({ ...rule, enabled: on })} />
              </Row>
            </SettingRow>
          )))}
        </div>
      )}
      {editing === 'new'
        ? <RuleForm initial={EMPTY_RULE} tax={tax} onSave={upsert} onCancel={() => setEditing(null)} />
        : rules && <Row><Button variant="secondary" icon="plus" onClick={() => setEditing('new')}>{t('rules.add')}</Button></Row>}
    </Section>
  );
}

function connectedText(connection, who) {
  if (connection.mode === 'shared') return t('settings.connected_shared', { host: hostOf(connection.base) });
  return who ? t('settings.connected_as', { host: hostOf(connection.base), user: who }) : t('settings.connected', { host: hostOf(connection.base) });
}

/** The plugin's page in Settings: connection, browse, rules. */
export function Settings() {
  const { connection, client, loading, refresh } = useConnection();
  const { busy, error: connectError, connect } = useConnect(connection, () => refresh());
  const [who, setWho] = useState('');
  const [error, setError] = useState(null);
  const api = getApi();

  useEffect(() => {
    if (!client) return;
    client.whoAmI().then((w) => setWho(w.username)).catch((err) => setError(err));
  }, [client]);

  const disconnect = async () => {
    await api.proxy.disconnect(PERSONAL).catch(() => {});
    setWho('');
    setError(null);
    await refresh();
  };

  const browse = () => api.ui.openDialog({ title: t('page.title'), slot: 'plugin-dialog', extraProps: { view: 'browse' }, width: 900 });

  return (
    <Stack gap={6}>
      <Section title={t('settings.title')}>
        {loading && <Loading />}
        {!loading && connection?.state === 'disconnected' && (
          <>
            <SettingRow label={t('settings.connection')} description={`${connectIntro(connection)} ${t('connect.token_hint')}`}>
              <Button busy={busy} onClick={connect}>{t('connect.button')}</Button>
            </SettingRow>
            <ErrorAlert error={connectError} />
          </>
        )}
        {!loading && connection?.state === 'error' && (
          <>
            <ErrorAlert error={connection.error} onRetry={refresh} />
            {connection.mode === 'shared' && <Text tone="muted">{t('settings.shared_error')}</Text>}
          </>
        )}
        {!loading && connection?.state === 'connected' && (
          <div>
            <SettingRow label={t('settings.connection')} description={connectedText(connection, who)}>
              {connection.mode === 'personal' && <Button variant="secondary" onClick={disconnect}>{t('settings.disconnect')}</Button>}
            </SettingRow>
            <SettingRow label={t('browse.results')} description={t('settings.documents_hint')}>
              <Button variant="secondary" icon="archive" onClick={browse}>{t('settings.browse')}</Button>
            </SettingRow>
          </div>
        )}
        <ErrorAlert error={error} />
      </Section>
      {!loading && connection?.state === 'connected' && <Rules client={client} />}
    </Stack>
  );
}
