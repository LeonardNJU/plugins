// Helpers for end-to-end tests of plugins against a running webmail.
//
// The webmail must be running and signed in to a mail server (see
// test-env/README.md). Configure with environment variables:
//   BULWARK_URL             webmail address (default http://localhost:3100)
//   BULWARK_ADMIN_PASSWORD  admin dashboard password
//   BULWARK_USER / BULWARK_PASSWORD  mail account (default alice@example.org / test-pass-123)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as playwrightRequest, expect } from '@playwright/test';

export const BASE = process.env.BULWARK_URL || 'http://localhost:3100';
export const USER = process.env.BULWARK_USER || 'alice@example.org';
export const PASSWORD = process.env.BULWARK_PASSWORD || 'test-pass-123';
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** An API client signed in to the admin dashboard. */
export async function adminApi() {
  const password = process.env.BULWARK_ADMIN_PASSWORD;
  if (!password) throw new Error('Set BULWARK_ADMIN_PASSWORD to the webmail admin password');
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/admin/auth', { data: { password } });
  if (!res.ok()) throw new Error(`Admin sign-in failed: HTTP ${res.status()} ${await res.text()}`);
  return api;
}

/** Upload `<plugin>/<plugin>.zip` as an admin plugin, enabled and turned on for everyone. */
export async function installPlugin(api, pluginId, { force = true } = {}) {
  const zip = path.join(REPO, pluginId, `${pluginId}.zip`);
  if (!fs.existsSync(zip)) throw new Error(`${zip} is missing; run npm run build -- ${pluginId}`);
  const res = await api.post('/api/admin/plugins', {
    multipart: { file: { name: `${pluginId}.zip`, mimeType: 'application/zip', buffer: fs.readFileSync(zip) } },
  });
  if (!res.ok()) throw new Error(`Install of ${pluginId} failed: HTTP ${res.status()} ${await res.text()}`);
  const patch = await api.patch('/api/admin/plugins', { data: { id: pluginId, enabled: true, forceEnabled: force } });
  if (!patch.ok()) throw new Error(`Enabling ${pluginId} failed: HTTP ${patch.status()} ${await patch.text()}`);
}

export async function uninstallPlugin(api, pluginId) {
  await api.delete('/api/admin/plugins', { data: { id: pluginId } });
}

/** Set one admin config value of a plugin (configSchema). */
export async function setPluginConfig(api, pluginId, key, value) {
  const res = await api.put(`/api/admin/plugins/${pluginId}/config`, { data: { key, value } });
  if (!res.ok()) throw new Error(`Config ${pluginId}.${key} failed: HTTP ${res.status()} ${await res.text()}`);
}

/** Skip tours and banners and pin the language, before the first page load. */
export async function preparePage(page, { theme = 'light' } = {}) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('theme', t);
      localStorage.setItem('theme-storage', JSON.stringify({ state: { theme: t }, version: 0 }));
      for (const k of ['bulwark-tour-completed', 'tour-completed', 'onboarding-completed', 'welcome-dismissed', 'pwa-install-dismissed', 'pwa-prompt-dismissed']) {
        localStorage.setItem(k, 'true');
      }
    } catch { /* storage blocked */ }
  }, theme);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
}

/** Sign in through the login form and wait for the mail view. */
export async function signIn(page, { user = USER, password = PASSWORD } = {}) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"])').first().fill(user);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90_000 });
}

/** Wait until a plugin's background sandbox is running. */
export async function waitForPlugin(page, pluginId, timeout = 60_000) {
  await expect(page.locator(`iframe[title="plugin-${pluginId}-background"]`)).toHaveCount(1, { timeout });
}

/** Screenshot into `<plugin>/screenshots/<name>-<theme>.png` (used in the README). */
export async function shoot(page, pluginId, name, theme = 'light') {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
  await page.waitForTimeout(500);
  const dir = path.join(REPO, pluginId, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
}
