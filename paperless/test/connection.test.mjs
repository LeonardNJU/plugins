import { describe, it, expect } from 'vitest';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { connectPersonal, resolveConnection } from '../src/lib/connection.js';

const refused = (code, status = 404) => ({ status, ok: false, headers: {}, body: '', proxyError: code });

describe('resolveConnection', () => {
  it('uses the admin token when the administrator set one up', async () => {
    const api = fakeApi({
      handlers: {
        'admin.getConfig': (key) => (key === 'serverUrl' ? 'https://dms.example.com/paperless/' : null),
        'proxy.fetch': () => proxyResponse('{}'),
      },
    });
    expect(await resolveConnection(api)).toEqual({ state: 'connected', mode: 'shared', base: 'https://dms.example.com/paperless', credentialId: 'shared' });
    expect(api.calls('proxy.fetch')[0].args.slice(0, 2)).toEqual(['shared', 'https://dms.example.com/paperless/api/ui_settings/']);
  });

  it('falls back to the user\'s own token when the admin set only a server', async () => {
    const api = fakeApi({
      handlers: {
        'admin.getConfig': () => 'https://dms.example.com/paperless',
        'proxy.fetch': () => refused('no_credential'),
        'proxy.accounts': () => [{ credentialId: 'personal', origin: 'https://dms.example.com', connected: true }],
      },
    });
    // Same server: the admin's path is kept.
    expect(await resolveConnection(api)).toEqual({ state: 'connected', mode: 'personal', base: 'https://dms.example.com/paperless', credentialId: 'personal' });
  });

  it('is disconnected, with the admin\'s server to suggest, when nothing is connected', async () => {
    const api = fakeApi({
      handlers: {
        'admin.getConfig': () => 'https://dms.example.com',
        'proxy.fetch': () => refused('no_credential'),
        'proxy.accounts': () => [{ credentialId: 'personal', origin: 'https://dms.example.com', connected: false }],
      },
    });
    expect(await resolveConnection(api)).toEqual({ state: 'disconnected', suggestedServer: 'https://dms.example.com' });
  });

  it('does not ask for a shared token without a server, and reports a broken shared token', async () => {
    const none = fakeApi({ handlers: { 'admin.getConfig': () => null, 'proxy.accounts': () => [] } });
    expect(await resolveConnection(none)).toEqual({ state: 'disconnected', suggestedServer: '' });
    expect(none.calls('proxy.fetch')).toHaveLength(0);

    const broken = fakeApi({ handlers: { 'admin.getConfig': () => 'https://dms.example.com', 'proxy.fetch': () => proxyResponse('{"detail":"Invalid token."}', { status: 401 }) } });
    const result = await resolveConnection(broken);
    expect(result.state).toBe('error');
    expect(result.error.key).toBe('error.token');
  });
});

describe('connectPersonal', () => {
  it('opens the host dialog with the suggested server and checks the token', async () => {
    let connected = false;
    const api = fakeApi({
      handlers: {
        'proxy.connect': () => { connected = true; return { connected: true }; },
        'admin.getConfig': () => '',
        'proxy.accounts': () => (connected ? [{ credentialId: 'personal', origin: 'https://p.example', connected: true }] : []),
        'proxy.fetch': () => proxyResponse('{"user":{"username":"anna"}}'),
      },
    });
    const result = await connectPersonal(api, 'https://p.example');
    expect(result.connected).toBe(true);
    expect(api.calls('proxy.connect')[0].args).toEqual(['personal', { mode: 'password', server: 'https://p.example' }]);
  });

  it('forgets a token Paperless refuses', async () => {
    const api = fakeApi({
      handlers: {
        'proxy.connect': () => ({ connected: true }),
        'admin.getConfig': () => '',
        'proxy.accounts': () => [{ credentialId: 'personal', origin: 'https://p.example', connected: true }],
        'proxy.fetch': () => proxyResponse('{"detail":"Invalid token."}', { status: 401 }),
        'proxy.disconnect': async () => true,
      },
    });
    const result = await connectPersonal(api, '');
    expect(result.connected).toBe(false);
    expect(result.error.key).toBe('error.token');
    expect(api.calls('proxy.disconnect')[0].args).toEqual(['personal']);
  });
});
