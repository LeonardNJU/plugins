import { useEffect, useState } from 'react';
import { getApi, t, hostOf } from './host.js';
import { ConnectPanel, ErrorBox, Styles, useConnection } from './common.jsx';
import { PERSONAL } from '../lib/connection.js';

/** The plugin's page in Settings: the connection. */
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
    </div>
  );
}
