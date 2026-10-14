// The plugin's section in Settings: which service is used, the privacy
// note, the model, and connecting the user's own key when allowed.

import { useCallback, useEffect, useId, useState } from 'react';
import { Styles, host, t } from './common.jsx';
import { loadSetup, savePrefs, PROVIDER_LABELS } from '../lib/assistant.js';
import {
  DEFAULT_MODELS, OFFICIAL_BASE_URLS, OWN_CREDENTIALS, PROVIDERS,
  adminProviders, hostOf, normalizeBaseUrl, userKeysAllowed,
} from '../lib/config.js';

export function SettingsPanel() {
  const [setup, setSetup] = useState(null);
  const [model, setModel] = useState('');
  const [ownProvider, setOwnProvider] = useState('openai');
  const [ownUrl, setOwnUrl] = useState(OFFICIAL_BASE_URLS.openai);
  const [ownModel, setOwnModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const ids = { model: useId(), provider: useId(), ownProvider: useId(), ownUrl: useId(), ownModel: useId(), reader: useId() };

  const reload = useCallback(async () => {
    const next = await loadSetup(host());
    setSetup(next);
    setModel(next.prefs.model ?? '');
    const own = next.prefs.own ?? {};
    if (PROVIDERS.includes(own.provider)) setOwnProvider(own.provider);
    if (own.baseUrl) setOwnUrl(own.baseUrl);
    setOwnModel(own.model ?? '');
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  if (!setup) return <div className="ai ai-muted" style={{ padding: 4 }}><Styles />{t('common.loading')}</div>;

  const { config, prefs, accounts, endpoint } = setup;
  const admin = adminProviders(config);
  const allowOwn = userKeysAllowed(config);
  const ownAccount = accounts.find((a) => a.credentialId === OWN_CREDENTIALS[ownProvider] && a.connected);
  const usingOwn = !!endpoint?.own;

  const save = async (patch) => {
    await savePrefs(host(), patch);
    await reload();
    setMessage(t('settings.saved'));
  };

  const connect = async () => {
    const baseUrl = normalizeBaseUrl(ownUrl);
    if (!baseUrl) {
      setMessage(t('settings.bad_url'));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await host().proxy.connect(OWN_CREDENTIALS[ownProvider], { mode: 'password', server: baseUrl });
      if (result?.connected) {
        await save({ useOwn: true, own: { provider: ownProvider, baseUrl, model: ownModel.trim() } });
        setMessage(t('settings.connected', { host: hostOf(result.origin ?? baseUrl) }));
      }
    } catch {
      setMessage(t('settings.connect_failed'));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await host().proxy.disconnect(OWN_CREDENTIALS[ownProvider]);
      await save({ useOwn: false });
      setMessage(t('settings.disconnected'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai" style={{ display: 'grid', gap: 14, padding: '2px 0' }}>
      <Styles />
      <section aria-labelledby={`${ids.model}-status`}>
        <div id={`${ids.model}-status`} className="ai-title">{t('settings.service')}</div>
        {endpoint ? (
          <p style={{ margin: '4px 0' }} data-testid="ai-status">
            {t(usingOwn ? 'settings.status_own' : 'settings.status_admin', {
              provider: PROVIDER_LABELS[endpoint.provider], host: hostOf(endpoint.baseUrl), model: endpoint.model,
            })}
          </p>
        ) : (
          <p style={{ margin: '4px 0' }} data-testid="ai-status">{t(allowOwn ? 'settings.not_set_up_own' : 'settings.not_set_up')}</p>
        )}
        <p className="ai-muted" style={{ margin: '4px 0' }}>{t('settings.privacy')}</p>
      </section>

      {admin.length > 1 && !usingOwn && (
        <div>
          <label className="ai-label" htmlFor={ids.provider}>{t('settings.provider')}</label>
          <select
            id={ids.provider}
            className="ai-select"
            value={endpoint?.provider ?? admin[0].provider}
            onChange={(e) => void save({ provider: e.target.value })}
          >
            {admin.map((p) => <option key={p.provider} value={p.provider}>{PROVIDER_LABELS[p.provider]} ({hostOf(p.baseUrl)})</option>)}
          </select>
        </div>
      )}

      {admin.length > 0 && !usingOwn && (
        <div>
          <label className="ai-label" htmlFor={ids.model}>{t('settings.model')}</label>
          <div className="ai-row">
            <input
              id={ids.model}
              className="ai-input"
              style={{ flex: '1 1 200px' }}
              value={model}
              placeholder={endpoint?.provider ? (admin.find((p) => p.provider === endpoint.provider)?.model || DEFAULT_MODELS[endpoint.provider]) : ''}
              onChange={(e) => setModel(e.target.value)}
            />
            <button type="button" className="ai-btn" onClick={() => void save({ model: model.trim() })}>{t('settings.save')}</button>
          </div>
          <div className="ai-muted" style={{ marginTop: 3 }}>{t('settings.model_hint')}</div>
        </div>
      )}

      <label className="ai-row" htmlFor={ids.reader} style={{ gap: 8 }}>
        <input
          id={ids.reader}
          type="checkbox"
          checked={prefs.showInReader !== false}
          onChange={(e) => void save({ showInReader: e.target.checked })}
        />
        <span>{t('settings.show_in_reader')}</span>
      </label>

      {allowOwn && (
        <section className="ai-card" style={{ padding: 12, display: 'grid', gap: 10 }} aria-labelledby={`${ids.ownProvider}-title`}>
          <div id={`${ids.ownProvider}-title`} className="ai-title">{t('settings.own_title')}</div>
          <div className="ai-muted">{t('settings.own_hint')}</div>
          <div>
            <label className="ai-label" htmlFor={ids.ownProvider}>{t('settings.provider')}</label>
            <select
              id={ids.ownProvider}
              className="ai-select"
              value={ownProvider}
              disabled={usingOwn}
              onChange={(e) => {
                setOwnProvider(e.target.value);
                setOwnUrl(OFFICIAL_BASE_URLS[e.target.value]);
              }}
            >
              {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="ai-label" htmlFor={ids.ownUrl}>{t('settings.address')}</label>
            <input id={ids.ownUrl} className="ai-input" style={{ width: '100%' }} value={ownUrl} disabled={usingOwn} onChange={(e) => setOwnUrl(e.target.value)} inputMode="url" />
          </div>
          <div>
            <label className="ai-label" htmlFor={ids.ownModel}>{t('settings.model')}</label>
            <input id={ids.ownModel} className="ai-input" style={{ width: '100%' }} value={ownModel} placeholder={DEFAULT_MODELS[ownProvider]} onChange={(e) => setOwnModel(e.target.value)} />
          </div>
          <div className="ai-row">
            {usingOwn || ownAccount ? (
              <>
                <button type="button" className="ai-btn" disabled={busy} onClick={() => void save({ useOwn: true, own: { provider: ownProvider, baseUrl: normalizeBaseUrl(ownUrl) ?? OFFICIAL_BASE_URLS[ownProvider], model: ownModel.trim() } })}>{t('settings.save')}</button>
                <button type="button" className="ai-btn" disabled={busy} onClick={() => void disconnect()}>{t('settings.disconnect')}</button>
              </>
            ) : (
              <button type="button" className="ai-btn primary" disabled={busy} onClick={() => void connect()}>{t('settings.connect')}</button>
            )}
          </div>
        </section>
      )}
      <div className="ai-muted" role="status" aria-live="polite">{message}</div>
    </div>
  );
}
