// Shared steps for the Nextcloud plugin's end-to-end tests. They run
// against the Nextcloud container from test-env (user alice).

import fs from 'node:fs';
import path from 'node:path';
import { expect, request as playwrightRequest } from '@playwright/test';
import { BASE, REPO, adminApi, waitForPlugin } from '../../e2e/helpers.mjs';

export const PLUGIN = 'nextcloud';
export const NC_URL = process.env.NEXTCLOUD_URL || 'http://localhost:18080';
export const NC_USER = 'alice';

function secretsFile() {
  const candidates = [
    process.env.NEXTCLOUD_SECRETS,
    path.join(REPO, 'test-env', '.secrets', 'nextcloud.json'),
    path.resolve(REPO, '..', 'plugins-audit', 'test-env', '.secrets', 'nextcloud.json'),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('test-env/.secrets/nextcloud.json not found; run test-env/up');
  return JSON.parse(fs.readFileSync(found, 'utf8'));
}

export const NC = secretsFile();

/** Basic-auth fetch to Nextcloud as alice with the seeded app password, to check results. */
export async function ncFetch(urlPath, init = {}) {
  const auth = Buffer.from(`${NC_USER}:${NC.appPassword}`).toString('base64');
  return fetch(`${NC_URL}${urlPath}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, 'OCS-APIRequest': 'true', ...(init.headers ?? {}) },
  });
}

export function davPath(p) {
  return `/remote.php/dav/files/${NC_USER}${p.split('/').map(encodeURIComponent).join('/')}`;
}

/** Open the plugin's page in Settings and return its frame. */
export async function openSettings(page, theme) {
  await waitForPlugin(page, PLUGIN);
  // A client-side navigation keeps the running plugins.
  await page.getByRole('link', { name: 'Settings' }).click();
  if (theme) {
    // The theme syncs through the server, so another run (or another
    // plugin's test as alice) may have changed it: pick it here.
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Nextcloud', exact: true }).click();
  return pluginFrame(page, 'text=Nextcloud account');
}

/** Forget the plugin's stored Nextcloud account for the signed-in user. */
export async function forgetAccount(page) {
  await page.evaluate(async () => {
    await fetch('/api/plugin-secrets?plugin=nextcloud', { method: 'DELETE' });
  });
}

/** The plugin frame that shows `selector`, waiting for it to appear. */
export async function pluginFrame(page, selector, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    for (const frame of page.frames()) {
      try {
        if (frame !== page.mainFrame() && await frame.locator(selector).count() > 0) return frame;
      } catch { /* detached */ }
    }
    if (Date.now() > deadline) throw new Error(`No plugin frame shows ${selector}`);
    await page.waitForTimeout(250);
  }
}

/** Approve the host's "Connect Nextcloud" dialog and Nextcloud's login flow in the popup. */
export async function connectThroughLoginFlow(page, frame, buttonName = 'Connect Nextcloud') {
  const popupPromise = page.context().waitForEvent('page', { timeout: 30_000 });
  await frame.getByRole('button', { name: buttonName }).click();
  // The host's own dialog: the server is fixed by the admin, so it only asks to continue.
  const dialog = page.getByRole('dialog').filter({ hasText: 'Nextcloud' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /continue/i }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await approveInNextcloud(popup);
  return popup;
}

/** Nextcloud's Login Flow v2 pages: Log in, credentials, Grant access. */
export async function approveInNextcloud(popup) {
  await popup.getByRole('button', { name: /log in/i }).first().click();
  // With a Nextcloud session from an earlier sign-in in this browser, the
  // credentials step is skipped.
  const user = popup.locator('input[name="user"]');
  const grant = popup.getByRole('button', { name: /grant access/i });
  await expect(user.or(grant)).toBeVisible({ timeout: 30_000 });
  if (await user.isVisible()) {
    await user.fill(NC_USER);
    await popup.locator('input[name="password"]').fill(NC.password);
    await popup.locator('button[type="submit"], input[type="submit"]').first().click();
  }
  await popup.getByRole('button', { name: /grant access/i }).click({ timeout: 30_000 });
  await expect(popup.getByText(/account connected|connected/i).first()).toBeVisible({ timeout: 30_000 });
  await popup.close();
}

export { BASE };

/**
 * An admin API client. The admin sign-in allows 5 attempts per 15 minutes
 * and other plugins' tests share it, so the session cookie is kept in a
 * scratch file between runs (NEXTCLOUD_E2E_ADMIN_STATE) and reused while it
 * still works; a 429 is waited out.
 */
export async function admin() {
  const statePath = process.env.NEXTCLOUD_E2E_ADMIN_STATE
    || path.resolve(REPO, '..', 'plugin-audit-data', 'scratch-nextcloud', 'admin-state.json');
  if (fs.existsSync(statePath)) {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE, storageState: statePath });
    const probe = await ctx.get('/api/admin/plugins');
    if (probe.ok()) return ctx;
    await ctx.dispose();
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const ctx = await adminApi();
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      await ctx.storageState({ path: statePath });
      return ctx;
    } catch (err) {
      if (!/HTTP 429/.test(String(err?.message)) || attempt >= 60) throw err;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
}

/** Connect Nextcloud through Settings if it isn't yet, then go back to mail. */
export async function ensureConnected(page, theme) {
  const frame = await openSettings(page, theme);
  const connect = frame.getByRole('button', { name: 'Connect Nextcloud' });
  const again = frame.getByRole('button', { name: 'Sign in again' });
  const connected = frame.getByText(/Connected to Nextcloud at localhost:18080/);
  await expect(connect.or(again).or(connected)).toBeVisible({ timeout: 30_000 });
  if (!(await connected.isVisible())) {
    await connectThroughLoginFlow(page, frame, (await again.isVisible()) ? 'Sign in again' : 'Connect Nextcloud');
    await expect(connected).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole('button', { name: 'Back to Mail' }).click();
}

const JMAP = process.env.STALWART_URL || 'http://localhost:18025';
const MAIL_AUTH = `Basic ${Buffer.from('alice@example.org:test-pass-123').toString('base64')}`;

/** A message alice has, by exact subject, with its text and HTML body (Stalwart JMAP). */
export async function findMail(subject, { timeout = 30_000 } = {}) {
  const session = await (await fetch(`${JMAP}/.well-known/jmap`, { headers: { Authorization: MAIL_AUTH } })).json();
  const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];
  const deadline = Date.now() + timeout;
  for (;;) {
    const res = await fetch(session.apiUrl.replace(/^https?:\/\/[^/]+/, JMAP), {
      method: 'POST',
      headers: { Authorization: MAIL_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
        methodCalls: [
          ['Email/query', { accountId, filter: { operator: 'AND', conditions: [{ subject }, { notKeyword: '$draft' }] } }, 'q'],
          ['Email/get', { accountId, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: ['subject', 'textBody', 'htmlBody', 'bodyValues', 'attachments', 'mailboxIds'], fetchAllBodyValues: true }, 'g'],
        ],
      }),
    });
    const data = await res.json();
    const list = data.methodResponses?.[1]?.[1]?.list ?? [];
    const found = list.find((m) => m.subject === subject);
    if (found) {
      const text = Object.values(found.bodyValues ?? {}).map((v) => v.value).join('\n');
      return { ...found, allText: text, accountId };
    }
    if (Date.now() > deadline) throw new Error(`No message with subject ${subject}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Delete alice's public link shares of a path (cleanup). */
export async function deleteShares(filePath) {
  const res = await ncFetch(`/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=${encodeURIComponent(filePath)}`);
  const data = await res.json();
  const shares = (data.ocs?.data ?? []).filter((s) => s.share_type === 3);
  for (const s of shares) await ncFetch(`/ocs/v2.php/apps/files_sharing/api/v1/shares/${s.id}`, { method: 'DELETE' });
  return shares;
}

/** Open a new message. */
export async function openComposer(page) {
  await page.getByRole('button', { name: 'Compose' }).first().click();
  await expect(page.getByTestId('composer-attach-menu')).toBeVisible();
}

/** Attach > From Nextcloud in the open composer: the host dialog and the picker's frame. */
export async function openPicker(page, { shot } = {}) {
  await page.getByTestId('composer-attach-menu').click();
  const entry = page.getByRole('menuitem', { name: 'From Nextcloud' });
  await expect(entry).toBeVisible();
  if (shot) await shot();
  await entry.click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Attach from Nextcloud' });
  await expect(dialog).toBeVisible();
  return { dialog, picker: () => pluginFrame(page, 'text=Choose one or more files.') };
}

/** The host's prompt for a new folder's name. */
export async function nameNewFolder(page, name) {
  const prompt = page.getByRole('dialog').filter({ hasText: 'Folder name' });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Folder name').fill(name);
  await prompt.getByRole('button', { name: 'Create' }).click();
  await expect(prompt).toBeHidden();
}
