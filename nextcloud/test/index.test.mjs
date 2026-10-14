import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { offerFirstRun, slots } from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };

describe('first run', () => {
  it('points a user without a Nextcloud account to Settings once', async () => {
    const api = fakeApi({ translations: manifest.locales, handlers: { 'proxy.accounts': async () => [] } });
    expect(await offerFirstRun(api)).toBe(true);
    expect(api.calls('toast.info')[0].args[0]).toBe(manifest.locales.en['firstrun.offer']);
    expect(await offerFirstRun(api)).toBe(false);
    expect(api.calls('toast.info')).toHaveLength(1);
  });

  it('says nothing when Nextcloud is already connected', async () => {
    const api = fakeApi({ handlers: { 'proxy.accounts': async () => [{ credentialId: 'nextcloud', origin: 'https://c', connected: true }] } });
    expect(await offerFirstRun(api)).toBe(false);
    expect(api.calls('toast.info')).toHaveLength(0);
  });
});

describe('manifest', () => {
  it('keeps the app password in a user credential, never in settings', () => {
    expect(manifest.credentials.nextcloud).toEqual({ label: 'Nextcloud', scope: 'user', inject: { type: 'basic' } });
    const fields = JSON.stringify({ ...manifest.settingsSchema, ...manifest.configSchema }).toLowerCase();
    expect(fields).not.toMatch(/password"\s*:\s*\{\s*"type"\s*:\s*"string"/);
    expect(Object.keys(manifest.configSchema)).toContain('serverUrl');
  });

  it('offers a settings section', () => {
    expect(typeof slots['settings-section'].component).toBe('function');
    expect(manifest.permissions).toContain('ui:settings-section');
  });
});
