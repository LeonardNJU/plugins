// @vitest-environment jsdom
// The connected account is named as a Nextcloud account (display name and
// login), so it can't be taken for the mail account, and can be switched.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { accountName, connectedText } from '../src/lib/account.js';
import { setApi } from '../src/lib/host.js';
import { SettingsSection } from '../src/ui/settings-section.js';
import manifest from '../manifest.json' with { type: 'json' };

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const ORIGIN = 'http://localhost:18080';

describe('naming the Nextcloud account', () => {
  it('shows the display name with the login when they differ', () => {
    expect(accountName({ displayName: 'Alice Example', userId: 'alice' })).toBe('Alice Example (alice)');
  });

  it('shows one of them when they are the same or one is missing', () => {
    expect(accountName({ displayName: 'admin', userId: 'admin' })).toBe('admin');
    expect(accountName({ displayName: 'Admin', userId: 'admin' })).toBe('Admin');
    expect(accountName({ displayName: '', userId: 'admin' })).toBe('admin');
    expect(accountName({ displayName: '', userId: '', username: 'bob@example.org' })).toBe('bob@example.org');
  });

  it('says it is the Nextcloud account and where', () => {
    const t = fakeApi({ translations: manifest.locales }).i18n.t;
    expect(connectedText(t, { origin: ORIGIN, displayName: 'Alice Example', userId: 'alice' }))
      .toBe('Connected to Nextcloud at localhost:18080 as Alice Example (alice).');
  });
});

describe('the settings section', () => {
  function makeApi() {
    let connected = true;
    const api = fakeApi({
      translations: manifest.locales,
      handlers: {
        'config.get': async () => ({ serverUrl: ORIGIN }),
        'proxy.accounts': async () => [{ credentialId: 'nextcloud', origin: ORIGIN, username: 'admin', connected }],
        'proxy.fetch': async (id, url) => (url.includes('/cloud/user')
          ? proxyResponse(JSON.stringify({ ocs: { data: { id: 'admin', displayname: 'admin' } } }))
          : proxyResponse('{}')),
        'proxy.disconnect': async () => { connected = false; return true; },
        // The user cancels the host's server dialog: nothing else happens.
        'proxy.connect': async () => ({ connected: false }),
      },
    });
    setApi(api);
    return api;
  }

  it('names the Nextcloud account with a hint and offers another account', async () => {
    const api = makeApi();
    await act(async () => { render(React.createElement(SettingsSection)); });
    await screen.findByText('Connected to Nextcloud at localhost:18080 as admin.');
    expect(screen.getByText(/signed in on Nextcloud's page when you connected, not necessarily your mail account/)).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use another Nextcloud account' })); });
    // Disconnect (revoking the app password), then the sign-in starts again on the same server.
    expect(api.calls('proxy.disconnect')).toHaveLength(1);
    expect(api.calls('proxy.connect')[0].args).toEqual(['nextcloud', { mode: 'signin', server: ORIGIN }]);
    await screen.findByRole('button', { name: 'Connect Nextcloud' });
  });
});
