// The connection state and the panel that shows it, shared by every slot.

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react';

import { adminServer, approveServer, disconnect, getConnection, pollLoginFlow, startLoginFlow } from '../lib/connection.js';
import { NcError, errorText, needsSignIn } from '../lib/errors.js';
import { hostOf } from '../lib/format.js';

/**
 * status: loading | disconnected | approving | waiting | connected | expired | error
 */
export function useConnection(api) {
  const [state, setState] = useState({ status: 'loading' });
  const flowRef = useRef(null);
  const mounted = useRef(true);

  const set = (next) => { if (mounted.current) setState(next); };

  const refresh = useCallback(async () => {
    let fixed = null;
    try {
      fixed = await adminServer(api);
      const conn = await getConnection(api, { fixedServer: fixed });
      set(conn ? { status: 'connected', conn, fixed } : { status: 'disconnected', fixed });
      return conn;
    } catch (err) {
      if (err instanceof NcError && err.code === 'wrong_server') set({ status: 'disconnected', fixed, error: err });
      else if (needsSignIn(err)) set({ status: 'expired', fixed, error: err });
      else set({ status: 'error', fixed, error: err });
      return null;
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      flowRef.current?.abort();
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    const fixed = await adminServer(api);
    set({ status: 'approving', fixed });
    const controller = new AbortController();
    flowRef.current?.abort();
    flowRef.current = controller;
    try {
      const origin = await approveServer(api, { fixedServer: fixed, suggestedServer: state.conn?.origin });
      if (!origin) { await refresh(); return null; }
      const flow = await startLoginFlow(api, origin);
      set({ status: 'waiting', fixed, origin, loginUrl: flow.loginUrl });
      await api.ui.openExternalUrl(flow.loginUrl).catch(() => {});
      await pollLoginFlow(api, flow, { signal: controller.signal });
      const conn = await refresh();
      if (conn) api.toast.success(api.i18n.t('connect.done', { host: hostOf(conn.origin) }));
      return conn;
    } catch (err) {
      if (err instanceof NcError && err.code === 'cancelled') { await refresh(); return null; }
      set({ status: 'error', fixed, error: err });
      return null;
    } finally {
      if (flowRef.current === controller) flowRef.current = null;
    }
  }, [api, refresh, state.conn]);

  const cancel = useCallback(() => { flowRef.current?.abort(); }, []);

  const signOut = useCallback(async () => {
    try {
      await disconnect(api);
    } catch (err) {
      api.toast.error(errorText(api.i18n.t, err));
    }
    await refresh();
  }, [api, refresh]);

  /** Call with any error from a Nextcloud request: switches to "expired" when the password stopped working. */
  const report = useCallback((err) => {
    if (needsSignIn(err)) set({ status: 'expired', fixed: state.fixed, error: err });
  }, [state.fixed]);

  return { ...state, refresh, connect, cancel, signOut, report };
}

/** What the user sees about the connection, with the buttons that fit. */
export function ConnectionPanel({ api, connection, compact = false, intro }) {
  const t = api.i18n.t;
  const c = connection;
  const fixedHost = c.fixed ? hostOf(c.fixed) : '';

  if (c.status === 'loading') {
    return h('p', { className: 'nc-muted', role: 'status' }, t('connect.checking'));
  }
  if (c.status === 'connected') {
    const who = c.conn.displayName || c.conn.userId;
    return h('div', { className: 'nc-row' },
      h('span', { className: 'nc-grow', role: 'status' }, t('connect.connected', { host: hostOf(c.conn.origin), user: who })),
      compact ? null : h('button', { type: 'button', className: 'nc-btn', onClick: () => void c.signOut() }, t('connect.disconnect')),
    );
  }
  if (c.status === 'approving') {
    return h('p', { className: 'nc-muted', role: 'status' }, t('connect.approving'));
  }
  if (c.status === 'waiting') {
    return h('div', { className: 'nc-col', role: 'status' },
      h('p', { style: { margin: 0 } }, t('connect.waiting', { host: hostOf(c.origin) })),
      h('div', { className: 'nc-row' },
        h('button', { type: 'button', className: 'nc-btn', onClick: () => void api.ui.openExternalUrl(c.loginUrl) }, t('connect.reopen')),
        h('button', { type: 'button', className: 'nc-btn', onClick: c.cancel }, t('common.cancel')),
      ),
    );
  }
  const message = c.status === 'expired'
    ? t('connect.expired')
    : c.status === 'error'
      ? errorText(t, c.error)
      : c.error?.code === 'wrong_server'
        ? t('error.wrong_server_host', { host: fixedHost })
        : intro ?? t('connect.intro');
  return h('div', { className: 'nc-col' },
    h('p', { style: { margin: 0 }, className: c.status === 'error' ? 'nc-error' : undefined, role: c.status === 'error' ? 'alert' : undefined }, message),
    fixedHost && c.status === 'disconnected' ? h('p', { className: 'nc-muted nc-small', style: { margin: 0 } }, t('connect.server', { host: fixedHost })) : null,
    h('div', { className: 'nc-row' },
      h('button', { type: 'button', className: 'nc-btn nc-primary', onClick: () => void c.connect() },
        c.status === 'expired' ? t('connect.again') : t('connect.button')),
    ),
  );
}
