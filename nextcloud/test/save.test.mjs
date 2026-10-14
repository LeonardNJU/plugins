import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { emlName, saveAttachment, saveMessage, planUpload } from '../src/lib/save.js';
import { onAction, registerActions, hooks, activate } from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };

const conn = { origin: 'https://c.example', userId: 'alice' };

function client(taken = []) {
  return { ...conn, mkdirp: async () => {}, names: async () => taken };
}

function apiFor(extra = {}) {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'proxy.fetch': async () => ({ status: 201, ok: true, headers: {} }),
      'email.getAttachment': async () => ({ name: 'invoice.pdf', type: 'application/pdf', size: 4, data: new Uint8Array([1, 2, 3, 4]).buffer }),
      'email.getRaw': async () => new TextEncoder().encode('Subject: Hi\r\n\r\nBody').buffer,
      ...extra,
    },
  });
}

describe('saving mail to Nextcloud', () => {
  it('names a message after its subject', () => {
    expect(emlName('Re: Invoice 10/2026')).toBe('Re_ Invoice 10_2026.eml');
    expect(emlName('')).toBe('message.eml');
    expect(emlName(undefined)).toBe('message.eml');
    expect(emlName('x'.repeat(300))).toHaveLength(124);
  });

  it('uploads the attachment bytes under a free name', async () => {
    const api = apiFor();
    const path = await saveAttachment(api, client(['invoice.pdf']), { emailId: 'e1', blobId: 'b1', name: 'invoice.pdf' }, '/Docs');
    expect(path).toBe('/Docs/invoice (2).pdf');
    expect(api.calls('email.getAttachment')[0].args).toEqual(['e1', 'b1']);
    const [, url, init] = api.calls('proxy.fetch')[0].args;
    expect(url).toBe('https://c.example/remote.php/dav/files/alice/Docs/invoice%20(2).pdf');
    expect(init.method).toBe('PUT');
    expect(init.body.size).toBe(4);
    expect(init.headers['Content-Type']).toBe('application/pdf');
  });

  it('uploads the message source as .eml', async () => {
    const api = apiFor();
    const path = await saveMessage(api, client(), { emailId: 'e1', name: 'Hi.eml' }, '/');
    expect(path).toBe('/Hi.eml');
    const init = api.calls('proxy.fetch')[0].args[2];
    expect(init.headers['Content-Type']).toBe('message/rfc822');
    expect(await init.body.text()).toBe('Subject: Hi\r\n\r\nBody');
  });

  it('creates the folder before picking a name', async () => {
    const order = [];
    const c = { mkdirp: async (p) => order.push(`mkdirp ${p}`), names: async (p) => { order.push(`names ${p}`); return []; } };
    await planUpload(c, '/New', 'a.txt');
    expect(order).toEqual(['mkdirp /New', 'names /New']);
  });
});

describe('the save actions', () => {
  it('adds "Save to Nextcloud" to attachments and to the open message', async () => {
    const api = apiFor();
    await registerActions(api);
    const calls = api.calls('ui.setActions').map((c) => [c.args[0], c.args[1].map((a) => [a.id, a.label])])
      .filter(([surface]) => surface !== 'composer-attach-menu');
    expect(calls).toEqual([
      ['attachment-menu', [['save-attachment', 'Save to Nextcloud']]],
      ['reader-actions', [['save-message', 'Save message to Nextcloud']]],
    ]);
  });

  it('opens the folder dialog for an attachment and says where it went', async () => {
    const api = apiFor({ 'ui.openDialog': async () => ({ path: '/Docs/invoice.pdf' }) });
    await onAction(api, { surface: 'attachment-menu', actionId: 'save-attachment', context: { emailId: 'e1', blobId: 'b1', name: 'invoice.pdf', size: 4 } });
    expect(api.calls('ui.openDialog')[0].args[0]).toMatchObject({
      title: 'Save invoice.pdf to Nextcloud', slot: 'plugin-dialog',
      extraProps: { view: 'save', kind: 'attachment', emailId: 'e1', blobId: 'b1', name: 'invoice.pdf', size: 4 },
    });
    expect(api.calls('toast.success')[0].args[0]).toBe('Saved to Nextcloud: /Docs/invoice.pdf');
  });

  it('names a saved message after its subject', async () => {
    const api = apiFor({ 'email.get': async () => ({ subject: 'Meeting' }), 'ui.openDialog': async () => null });
    await activate(api);
    await hooks.onAction({ surface: 'reader-actions', actionId: 'save-message', context: { emailId: 'e2' } });
    expect(api.calls('ui.openDialog')[0].args[0].extraProps).toMatchObject({ view: 'save', kind: 'message', emailId: 'e2', name: 'Meeting.eml' });
    expect(api.calls('toast.success')).toHaveLength(0);
  });

  it('ignores clicks that are not its own', async () => {
    const api = apiFor();
    await onAction(api, { surface: 'attachment-menu', actionId: 'other', context: { emailId: 'e', blobId: 'b' } });
    await onAction(api, { surface: 'attachment-menu', actionId: 'save-attachment', context: { emailId: 'e' } });
    expect(api.calls('ui.openDialog')).toHaveLength(0);
  });
});
