// The built zip, loaded the way the webmail loads it: CommonJS evaluated
// with a require that only knows React and '@plugin-host'.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import * as React from 'react';
import { fakeApi } from '../../test-utils/fake-api.mjs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

async function load(api) {
  const zip = await JSZip.loadAsync(readFileSync(new URL('../birthdays.zip', import.meta.url)));
  expect(JSON.parse(await zip.file('manifest.json').async('string'))).toEqual(manifest);
  const code = await zip.file('index.js').async('string');
  const mod = { exports: {} };
  const known = { react: React, '@plugin-host': api };
  const require = (name) => {
    if (name in known) return known[name];
    throw new Error(`module ${name} is not available`);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports.default ?? mod.exports;
}

// Hook → the permission the webmail requires for it (lib/plugin-hook-catalog.ts).
const HOOK_PERMISSIONS = {
  onAppReady: 'app:lifecycle',
  onInterval: 'app:lifecycle',
  onAfterContactCreate: 'contacts:read',
  onAfterContactUpdate: 'contacts:read',
  onAfterContactDelete: 'contacts:read',
  onContactsImport: 'contacts:read',
  onNotificationClick: 'ui:notifications',
};
const IMPLICIT = ['app:lifecycle', 'ui:observe'];

describe('built plugin', () => {
  it('exports the sidebar widget, its hooks and activate, each with a declared permission', async () => {
    const api = fakeApi({ translations: manifest.locales, handlers: { 'contacts.list': async () => [] } });
    const plugin = await load(api);
    expect(Object.keys(plugin.slots)).toEqual(['sidebar-widget']);
    expect(typeof plugin.slots['sidebar-widget'].component).toBe('function');
    expect(manifest.permissions).toContain('ui:sidebar-widget');
    for (const name of Object.keys(plugin.hooks)) {
      const permission = HOOK_PERMISSIONS[name];
      expect(permission, `${name} is not a known hook`).toBeTruthy();
      expect([...manifest.permissions, ...IMPLICIT], name).toContain(permission);
    }
    await plugin.activate(api);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls('contacts.list')).toHaveLength(1);
  });

  it('asks for no permission it does not use', () => {
    const allowed = ['contacts:read', 'ui:sidebar-widget', 'ui:notifications', 'compose:open', 'calendar:read', 'calendar:write'];
    for (const p of manifest.permissions) expect(allowed, p).toContain(p);
  });
});
