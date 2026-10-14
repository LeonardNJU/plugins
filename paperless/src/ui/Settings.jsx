import { useEffect, useState } from 'react';
import { getApi, t, hostOf } from './host.js';
import { ConnectPanel, ErrorBox, Field, PickOne, Styles, TagPicker, useConnection, useTaxonomies } from './common.jsx';
import { PERSONAL } from '../lib/connection.js';
import { RULES_KEY, normalizeRule, normalizeRules } from '../lib/rules.js';

const EMPTY_RULE = { from: '', subject: '', what: 'attachments', tags: [], correspondent: null, documentType: null, storagePath: null, enabled: false };

function RuleForm({ initial, tax, onSave, onCancel }) {
  const [rule, setRule] = useState({ ...EMPTY_RULE, ...initial });
  const set = (patch) => setRule((prev) => ({ ...prev, ...patch }));
  const valid = rule.from.trim().length > 0;
  return (
    <div className="pl-card" role="group" aria-label={t('rules.form')}>
      <div className="pl-grid">
        <Field id="pl-r-from" label={t('rules.from')}>
          <input id="pl-r-from" type="text" required value={rule.from} placeholder={t('rules.from_placeholder')} onChange={(e) => set({ from: e.target.value })} /></Field>
        <Field id="pl-r-subject" label={t('rules.subject')}>
          <input id="pl-r-subject" type="text" value={rule.subject} placeholder={t('rules.subject_placeholder')} onChange={(e) => set({ subject: e.target.value })} /></Field>
        <Field id="pl-r-what" label={t('rules.what')}>
          <select id="pl-r-what" value={rule.what} onChange={(e) => set({ what: e.target.value })}>
            <option value="attachments">{t('rules.what_attachments')}</option>
            <option value="message">{t('rules.what_message')}</option>
          </select></Field>
      </div>
      {tax && (
        <>
          <div className="pl-grid" style={{ marginTop: 8 }}>
            <PickOne id="pl-r-corr" label={t('field.correspondent')} items={tax.correspondents} value={rule.correspondent} onChange={(v) => set({ correspondent: v })} />
            <PickOne id="pl-r-type" label={t('field.document_type')} items={tax.documentTypes} value={rule.documentType} onChange={(v) => set({ documentType: v })} />
            {tax.storagePaths.length > 0 && (
              <PickOne id="pl-r-path" label={t('field.storage_path')} items={tax.storagePaths} value={rule.storagePath} onChange={(v) => set({ storagePath: v })} />
            )}
          </div>
          <div style={{ marginTop: 8 }}><TagPicker tags={tax.tags} value={rule.tags} onChange={(v) => set({ tags: v })} /></div>
        </>
      )}
      <label className="pl-row" style={{ marginTop: 10, fontSize: 13 }}>
        <input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {t('rules.enable')}
      </label>
      <div className="pl-actions">
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="pl-primary" disabled={!valid} onClick={() => onSave(rule)}>{t('rules.save')}</button>
      </div>
    </div>
  );
}

function describeRule(rule, tax) {
  const names = (list, ids) => ids.map((id) => list?.find((x) => x.id === id)?.name).filter(Boolean);
  const parts = [];
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

  if (!rules) return <p className="pl-muted">{t('common.loading')}</p>;
  return (
    <section aria-labelledby="pl-rules-h">
      <h3 id="pl-rules-h">{t('rules.title')}</h3>
      <p className="pl-muted">{t('rules.intro')}</p>
      <ErrorBox error={error} />
      {rules.length === 0 && editing !== 'new' && <p className="pl-muted">{t('rules.none')}</p>}
      <ul className="pl-list">
        {rules.map((rule) => (
          <li key={rule.id}>
            {editing === rule.id ? (
              <RuleForm initial={rule} tax={tax} onSave={upsert} onCancel={() => setEditing(null)} />
            ) : (
              <div className="pl-item">
                <input type="checkbox" checked={rule.enabled} aria-label={t('rules.toggle', { from: rule.from })}
                  onChange={(e) => upsert({ ...rule, enabled: e.target.checked })} />
                <div className="pl-grow">
                  <div className="pl-name">
                    {rule.subject
                      ? t('rules.summary_subject', { from: rule.from, subject: rule.subject })
                      : t('rules.summary', { from: rule.from })}
                  </div>
                  <div className="pl-muted">
                    {rule.what === 'message' ? t('rules.what_message') : t('rules.what_attachments')}
                    {describeRule(rule, tax) ? ` · ${describeRule(rule, tax)}` : ''}
                  </div>
                  <div className="pl-muted">{rule.enabled ? t('rules.on') : t('rules.off')}</div>
                </div>
                <button type="button" onClick={() => setEditing(rule.id)}>{t('common.edit')}</button>
                <button type="button" className="pl-danger" onClick={() => save(rules.filter((r) => r.id !== rule.id))}
                  aria-label={t('rules.delete', { from: rule.from })}>{t('common.delete')}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new'
        ? <div style={{ marginTop: 8 }}><RuleForm initial={EMPTY_RULE} tax={tax} onSave={upsert} onCancel={() => setEditing(null)} /></div>
        : <div className="pl-actions" style={{ justifyContent: 'flex-start' }}><button type="button" onClick={() => setEditing('new')}>{t('rules.add')}</button></div>}
    </section>
  );
}

/** The plugin's page in Settings: connection, browse, rules. */
export function Settings() {
  const { connection, client, loading, refresh } = useConnection();
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

  const browse = () => api.ui.openDialog({ title: t('page.title'), slot: 'plugin-dialog', extraProps: { view: 'browse' }, width: 1000 });

  return (
    <div className="pl" style={{ padding: 4 }}>
      <Styles />
      <h2>{t('settings.title')}</h2>
      {loading && <p className="pl-muted">{t('common.loading')}</p>}
      {connection?.state === 'disconnected' && <ConnectPanel connection={connection} onConnected={() => refresh()} />}
      {connection?.state === 'error' && (
        <div className="pl-card">
          <ErrorBox error={connection.error} onRetry={refresh} />
          {connection.mode === 'shared' && <p className="pl-muted">{t('settings.shared_error')}</p>}
        </div>
      )}
      {connection?.state === 'connected' && (
        <div className="pl-card">
          <p>
            {connection.mode === 'shared'
              ? t('settings.connected_shared', { host: hostOf(connection.base) })
              : who ? t('settings.connected_as', { host: hostOf(connection.base), user: who }) : t('settings.connected', { host: hostOf(connection.base) })}
          </p>
          <ErrorBox error={error} />
          <div className="pl-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="pl-primary" onClick={browse}>{t('settings.browse')}</button>
            {connection.mode === 'personal' && <button type="button" onClick={disconnect}>{t('settings.disconnect')}</button>}
          </div>
        </div>
      )}
      {connection?.state === 'connected' && <Rules client={client} />}
    </div>
  );
}
