import { describe, it, expect } from 'vitest';
import { resolveEndpoint, normalizeBaseUrl, adminProviders, DEFAULT_MODELS } from '../src/lib/config.js';

const both = {
  openaiBaseUrl: 'http://localhost:18099/openai/v1/',
  openaiModel: 'mock-gpt-small',
  anthropicBaseUrl: 'https://api.anthropic.com/v1',
  defaultProvider: 'anthropic',
};

describe('normalizeBaseUrl', () => {
  it('drops trailing slashes and refuses what is not an http(s) address', () => {
    expect(normalizeBaseUrl(' https://api.openai.com/v1/ ')).toBe('https://api.openai.com/v1');
    expect(normalizeBaseUrl('ftp://x/v1')).toBeNull();
    expect(normalizeBaseUrl('https://user:pw@host/v1')).toBeNull();
    expect(normalizeBaseUrl('not a url')).toBeNull();
    expect(normalizeBaseUrl('')).toBeNull();
  });
});

describe('resolveEndpoint', () => {
  it('is null when the administrator set up nothing', () => {
    expect(resolveEndpoint({ config: {} })).toBeNull();
    expect(adminProviders({ openaiKey: 'x' })).toEqual([]);
  });

  it('uses the default provider, its admin model and the admin credential', () => {
    const ep = resolveEndpoint({ config: both });
    expect(ep).toMatchObject({
      provider: 'anthropic', credentialId: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
      origin: 'https://api.anthropic.com', model: DEFAULT_MODELS.anthropic, own: false,
    });
  });

  it('follows the user\'s provider and model choice', () => {
    const ep = resolveEndpoint({ config: both, prefs: { provider: 'openai', model: ' my-model ' } });
    expect(ep).toMatchObject({ provider: 'openai', credentialId: 'openai', baseUrl: 'http://localhost:18099/openai/v1', model: 'my-model' });
    expect(resolveEndpoint({ config: both, prefs: { provider: 'openai' } }).model).toBe('mock-gpt-small');
  });

  it('uses the user\'s own key only when the admin allows it and the key is connected', () => {
    const prefs = { useOwn: true, own: { provider: 'anthropic', baseUrl: 'https://gw.example.com/anthropic/v1', model: 'm1' } };
    const accounts = [{ credentialId: 'own-anthropic', origin: 'https://gw.example.com', connected: true }];
    expect(resolveEndpoint({ config: both, prefs, accounts }).own).toBe(false);
    const allowed = { ...both, allowUserKeys: true };
    expect(resolveEndpoint({ config: allowed, prefs, accounts })).toMatchObject({
      provider: 'anthropic', credentialId: 'own-anthropic', baseUrl: 'https://gw.example.com/anthropic/v1', model: 'm1', own: true,
    });
    expect(resolveEndpoint({ config: allowed, prefs, accounts: [{ ...accounts[0], connected: false }] }).own).toBe(false);
  });

  it('keeps the own key on the server the user approved', () => {
    const prefs = { useOwn: true, own: { provider: 'openai', baseUrl: 'https://api.openai.com/v1' } };
    const accounts = [{ credentialId: 'own-openai', origin: 'https://proxy.example.org', connected: true }];
    const ep = resolveEndpoint({ config: { allowUserKeys: true }, prefs, accounts });
    expect(ep.baseUrl).toBe('https://proxy.example.org/v1');
    expect(ep.model).toBe(DEFAULT_MODELS.openai);
  });
});
