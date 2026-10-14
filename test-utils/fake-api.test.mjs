import { describe, it, expect } from 'vitest';
import { fakeApi, proxyResponse } from './fake-api.mjs';

describe('fakeApi', () => {
  it('records calls on any namespace and answers with handlers', async () => {
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => proxyResponse('hi') } });

    const res = await api.proxy.fetch('cloud', 'https://a.example', {});
    api.ui.setActions('message-row-actions', []);

    expect(res).toEqual({ status: 200, ok: true, headers: {}, body: 'hi' });
    expect(api.calls().map((c) => c.method)).toEqual(['proxy.fetch', 'ui.setActions']);
  });

  it('keeps storage, settings and translations working', async () => {
    const api = fakeApi({ settings: { a: 1 }, locale: 'de-CH', translations: { de: { hello: 'Hallo {name}' }, en: { bye: 'Bye' } } });
    await api.storage.set('k', { v: 1 });

    expect(await api.storage.get('k')).toEqual({ v: 1 });
    expect(api.i18n.t('hello', { name: 'Ada' })).toBe('Hallo Ada');
    expect(api.i18n.t('bye')).toBe('Bye');
    let seen = null;
    api.plugin.onSettingsChange((s) => { seen = s; });
    api.changeSettings({ a: 2 });
    expect(seen).toEqual({ a: 2 });
  });
});
