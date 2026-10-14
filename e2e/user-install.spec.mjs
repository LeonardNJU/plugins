import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { adminApi, preparePage, signIn, waitForPlugin } from './helpers.mjs';

// A user installs their own plugin from a ZIP: the consent dialog lists what
// it asks for, nothing runs before "Allow", and with approvals required the
// plugin waits for the admin. The admin policy switches are put back after.

const RUN = Date.now().toString(36);

async function pluginZip(id) {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    id, name: `Consent test ${RUN}`, version: '1.0.0', author: 'e2e', description: 'Checks the consent dialog',
    type: 'hook', permissions: ['email:read', 'http:fetch', 'ui:sidebar-widget'],
    httpOrigins: ['https://api.example.org'], entrypoint: 'index.js',
  }));
  zip.file('index.js', 'module.exports = { activate(api) { api.storage.set("activated", true); } };');
  const file = path.join(os.tmpdir(), `${id}.zip`);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return file;
}

async function setFeatures(admin, features) {
  const res = await admin.get('/api/admin/policy');
  const policy = await res.json();
  const before = { ...policy.features };
  const put = await admin.put('/api/admin/policy', { data: { ...policy, features: { ...policy.features, ...features } } });
  expect(put.ok()).toBe(true);
  return before;
}

async function openPluginSettings(page) {
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Plugins', exact: true }).first().click();
  await expect(page.locator('button', { hasText: 'Install plugin' })).toBeVisible({ timeout: 60_000 });
}

async function upload(page, file) {
  // The visible button opens this hidden input.
  await page.locator('input[type="file"][aria-label="Install plugin"]').setInputFiles(file);
}

async function removeUserPlugin(page, name) {
  const card = page.getByRole('button', { name }).first();
  if (!(await card.isVisible().catch(() => false))) return;
  await card.click();
  await page.getByRole('button', { name: 'Remove' }).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Remove' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

test.describe('users installing their own plugins', () => {
  let admin;
  let before;

  test.beforeAll(async () => {
    admin = await adminApi();
    before = await setFeatures(admin, { pluginsEnabled: true, pluginsUploadEnabled: true, requirePluginApproval: false });
  });

  test.afterAll(async () => {
    await setFeatures(admin, {
      pluginsUploadEnabled: before.pluginsUploadEnabled, requirePluginApproval: before.requirePluginApproval,
    });
    await admin.dispose();
  });

  test('the consent dialog lists the permissions, and the plugin runs only after Allow', async ({ page }) => {
    const id = `consent-${RUN}`;
    const name = `Consent test ${RUN}`;
    await preparePage(page);
    await signIn(page);
    await openPluginSettings(page);
    try {
      await upload(page, await pluginZip(id));
      await expect(page.getByText('Plugin installed. Turn it on below.')).toBeVisible();

      // Turning it on asks first; declining keeps it off.
      await page.getByRole('switch', { name }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(`Allow ${name} to do this?`)).toBeVisible();
      await expect(dialog.getByText('Connect to other websites')).toBeVisible();
      await expect(dialog.getByText('https://api.example.org')).toBeVisible();
      await dialog.getByRole('button', { name: "Don't allow" }).click();
      // Long enough for an allowed plugin to have started (it takes ~1 s).
      await page.waitForTimeout(4000);
      await expect(page.locator(`iframe[title="plugin-${id}-background"]`)).toHaveCount(0);

      await page.getByRole('switch', { name }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Allow', exact: true }).click();
      await waitForPlugin(page, id);
    } finally {
      await removeUserPlugin(page, name);
    }
  });

  test('with approvals required, the plugin waits until the admin approves it', async ({ page }) => {
    await setFeatures(admin, { requirePluginApproval: true });
    const id = `approve-${RUN}`;
    const name = `Consent test ${RUN}`;
    await preparePage(page);
    await signIn(page);
    await openPluginSettings(page);
    try {
      await upload(page, await pluginZip(id));
      await expect(page.getByText('Plugin installed and sent to your administrator for approval.')).toBeVisible();
      await expect(page.getByText('Awaiting approval').first()).toBeVisible();

      const list = await (await admin.get('/api/admin/plugin-approvals')).json();
      const entry = (list.entries ?? list).find((e) => e.pluginId === id && e.status === 'pending');
      expect(entry, 'a pending approval request').toBeTruthy();
      const decide = await admin.post('/api/admin/plugin-approvals', { data: { pluginId: id, bundleHash: entry.bundleHash, decision: 'approved' } });
      expect(decide.ok()).toBe(true);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await openPluginSettings(page);
      await page.getByRole('switch', { name }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Allow', exact: true }).click();
      await waitForPlugin(page, id);
    } finally {
      await removeUserPlugin(page, name);
    }
  });
});
