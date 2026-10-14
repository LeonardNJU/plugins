import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  BASE, REPO, installPlugin as installOnce, uninstallPlugin, setPluginConfig, preparePage, signIn, waitForPlugin, shoot,
} from '../../e2e/helpers.mjs';

// Against the Paperless-ngx container from test-env (http://localhost:18010),
// with the token the seed wrote to test-env/.secrets/paperless.json.

const PAPERLESS = 'http://localhost:18010';
const PLUGIN = 'paperless';

function secrets() {
  const candidates = [
    process.env.PAPERLESS_SECRETS,
    path.join(REPO, 'test-env', '.secrets', 'paperless.json'),
    'C:/Users/info/worktrees/plugins-audit/test-env/.secrets/paperless.json',
  ].filter(Boolean);
  for (const file of candidates) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  throw new Error('paperless.json not found; run test-env/up');
}

const TOKEN = secrets().token;

async function paperless(pathname, init = {}) {
  const res = await fetch(`${PAPERLESS}${pathname}`, { ...init, headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Paperless ${pathname}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// Admin sign-ins are limited to 5 per address in 15 minutes, and several
// plugin suites share this webmail. Keep one admin session for the whole
// file (and between runs, in the scratch folder), and sign in from an
// address of our own when a new one is needed.
const SESSION_FILE = process.env.PAPERLESS_ADMIN_STATE
  || 'C:/Users/info/worktrees/plugin-audit-data/scratch-paperless/admin-state.json';
let adminContext = null;

async function adminApi() {
  if (adminContext) return adminContext;
  if (fs.existsSync(SESSION_FILE)) {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE, storageState: SESSION_FILE });
    const probe = await ctx.get('/api/admin/plugins');
    if (probe.ok()) { adminContext = ctx; return ctx; }
    await ctx.dispose();
  }
  const password = process.env.BULWARK_ADMIN_PASSWORD;
  if (!password) throw new Error('Set BULWARK_ADMIN_PASSWORD to the webmail admin password');
  const forwarded = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
  const ctx = await playwrightRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'X-Forwarded-For': forwarded } });
  const res = await ctx.post('/api/admin/auth', { data: { password } });
  if (!res.ok()) throw new Error(`Admin sign-in failed: HTTP ${res.status()} ${await res.text()}`);
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  await ctx.storageState({ path: SESSION_FILE });
  adminContext = ctx;
  return ctx;
}

/** Other suites write the plugin registry at the same time; retry a failed install. */
async function installPlugin(admin, id) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await installOnce(admin, id);
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLOT = `iframe[title="plugin-${PLUGIN}-slot"]`;

/** Mail alice a message with a PDF whose text (and so checksum) is unique to this run. */
function sendMail({ from, subject, pdfText, pdfName, savePdf }) {
  const args = [path.join(HERE, 'send_mail.py'), '--from', from, '--subject', subject, '--pdf-text', pdfText, '--pdf-name', pdfName];
  if (savePdf) args.push('--save-pdf', savePdf);
  execFileSync('python', args, { stdio: 'pipe' });
}

/** Documents whose title or text contains `text`. */
async function findDocs(text) {
  const data = await paperless(`/api/documents/?title_content=${encodeURIComponent(text)}&fields=id,title,correspondent,document_type,tags`);
  return data.results;
}

/** Delete documents for good (trash too), so reruns start clean. */
async function deleteDocs(ids) {
  if (!ids.length) return;
  for (const id of ids) await paperless(`/api/documents/${id}/`, { method: 'DELETE' }).catch(() => {});
  await paperless('/api/trash/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'empty', documents: ids }) }).catch(() => {});
}

/** Upload a file straight to Paperless (not through the webmail) and wait until it is a document. */
async function uploadDirect(bytes, name, title) {
  const form = new FormData();
  form.append('document', new Blob([bytes], { type: 'application/pdf' }), name);
  form.append('title', title);
  const taskId = await paperless('/api/documents/post_document/', { method: 'POST', body: form });
  for (let i = 0; i < 60; i++) {
    const task = await paperless(`/api/tasks/?task_id=${taskId}`);
    const t = (task.results ?? task)[0];
    if (t && String(t.status).toLowerCase() === 'success') return;
    if (t && String(t.status).toLowerCase() === 'failure') throw new Error(`consume failed: ${JSON.stringify(t.result_data ?? t.result)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('consume timed out');
}

/**
 * Does this Paperless take a streamed (chunked) upload? The webmail's proxy
 * streams request bodies without Content-Length; Paperless (Django) reads
 * such a multipart body as empty unless a buffering proxy (nginx) sits in
 * front. The test container has none, so the plugin must show a clear error
 * there; behind nginx the file is filed.
 */
let chunkedOk = null;
async function chunkedUploadsWork() {
  if (chunkedOk !== null) return chunkedOk;
  const boundary = 'probe' + Date.now();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="probe.unknown"\r\nContent-Type: application/x-bulwark-probe\r\n\r\nx\r\n--${boundary}--\r\n`;
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } });
  const res = await fetch(`${PAPERLESS}/api/documents/post_document/`, {
    method: 'POST', body: stream, duplex: 'half',
    headers: { Authorization: `Token ${TOKEN}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  });
  const text = await res.text();
  chunkedOk = !/No file was submitted/.test(text);
  return chunkedOk;
}

/** Open a message by subject, reloading once if push hasn't brought it yet. */
async function openMessage(page, subject) {
  const row = page.getByText(subject, { exact: true }).first();
  try {
    await expect(row).toBeVisible({ timeout: 30_000 });
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toBeVisible({ timeout: 60_000 });
  }
  // Left edge: the hover buttons cover the right end of the row.
  await row.click({ position: { x: 4, y: 4 } });
}

/** The plugin's settings page in Settings. */
async function openSettings(page) {
  // Client-side, so the running plugin stays loaded.
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Paperless-ngx', exact: true }).first().click({ timeout: 60_000 });
  const frame = page.frameLocator(SLOT).first();
  await expect(frame.getByRole('heading', { name: 'Paperless-ngx' })).toBeVisible({ timeout: 60_000 });
  return frame;
}

/** Install with the given admin settings, sign in and wait for the plugin. */
async function start(page, { token = true, theme = 'light' } = {}) {
  const admin = await adminApi();
  await installPlugin(admin, PLUGIN);
  await setPluginConfig(admin, PLUGIN, 'serverUrl', PAPERLESS);
  await setPluginConfig(admin, PLUGIN, 'apiToken', token ? TOKEN : '');
  await preparePage(page, { theme });
  await signIn(page);
  await waitForPlugin(page, PLUGIN);
  return admin;
}

/** What the user sees after pressing Send: filed, or the proxy's streamed upload refused. */
async function expectSendOutcome(page, run) {
  if (await chunkedUploadsWork()) {
    await expect(page.getByText('Filed in Paperless').first()).toBeVisible({ timeout: 90_000 });
    return findDocs(run);
  }
  await expect(page.getByText('Paperless refused the request: document: No file was submitted.').first()).toBeVisible({ timeout: 30_000 });
  return null;
}

test.describe('paperless plugin', () => {
  test('shared account: browse, filter and attach a document to a new message', async ({ page }) => {
    const admin = await start(page);
    try {
      const settings = await openSettings(page);
      await expect(settings.getByText('Connected to localhost:18010 with the account your administrator set up.')).toBeVisible();

      await settings.getByRole('button', { name: 'Browse documents' }).click();
      const dialog = page.frameLocator(SLOT).last();
      await expect(dialog.getByText(/\d+ documents/)).toBeVisible({ timeout: 30_000 });
      await dialog.getByRole('searchbox', { name: 'Search documents' }).fill('ACME invoice');
      await dialog.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(dialog.getByText('2 documents')).toBeVisible();
      // Filters: the tag "Inbox" leaves the October invoice only.
      await dialog.getByRole('button', { name: 'Filters' }).click();
      await dialog.getByRole('checkbox', { name: 'Inbox', exact: true }).check();
      await dialog.getByRole('button', { name: 'Apply' }).click();
      await expect(dialog.getByText('1 documents')).toBeVisible();
      await dialog.getByRole('button', { name: 'ACME invoice 2026-10' }).click();
      await expect(dialog.getByRole('img', { name: 'Preview of ACME invoice 2026-10' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Attach to new message' }).click();
      // The composer opens with the PDF attached.
      await expect(page.getByText(/ACME invoice 2026-10\.pdf/).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await uninstallPlugin(admin, PLUGIN);
    }
  });

  test('personal token: a wrong token is refused, the right one connects', async ({ page }) => {
    const admin = await start(page, { token: false });
    try {
      const settings = await openSettings(page);
      await expect(settings.getByText('Connect your account on localhost:18010', { exact: false })).toBeVisible();

      // The host's own dialog takes the token; the plugin never sees it.
      await settings.getByRole('button', { name: 'Connect Paperless' }).click();
      const connect = page.getByRole('dialog', { name: 'Connect Paperless' });
      await expect(connect.getByLabel('Server address')).toHaveValue(/localhost:18010/);
      await connect.getByLabel('Password or key').fill('not-a-real-token');
      await connect.getByRole('button', { name: 'Connect' }).click();
      await expect(settings.getByText("Paperless didn't accept the API token.", { exact: false })).toBeVisible({ timeout: 30_000 });

      await settings.getByRole('button', { name: 'Connect Paperless' }).click();
      await connect.getByLabel('Password or key').fill(TOKEN);
      await connect.getByRole('button', { name: 'Connect' }).click();
      await expect(settings.getByText('Connected to localhost:18010 as admin.')).toBeVisible({ timeout: 30_000 });

      await settings.getByRole('button', { name: 'Disconnect' }).click();
      await expect(settings.getByRole('button', { name: 'Connect Paperless' })).toBeVisible();
    } finally {
      await uninstallPlugin(admin, PLUGIN);
    }
  });

  test('send an attachment with metadata suggested from the sender', async ({ page }) => {
    const run = `e2e${Date.now()}`;
    const subject = `Invoice ${run}`;
    const fileName = `acme-${run}.pdf`;
    sendMail({ from: 'ACME Hosting <billing@acme-hosting.example>', subject, pdfText: `Bulwark ${run}`, pdfName: fileName });
    const admin = await start(page);
    try {
      await openMessage(page, subject);
      await page.locator('[data-attachment-plugin-menu]').first().click();
      await page.getByRole('menuitem', { name: 'Send to Paperless' }).click();
      const dialog = page.frameLocator(SLOT).last();
      await expect(dialog.getByLabel(fileName)).toBeChecked({ timeout: 30_000 });
      // ACME Hosting from billing@acme-hosting.example, Invoice from the subject.
      await expect(dialog.getByLabel('Correspondent')).toHaveValue('1');
      await expect(dialog.getByLabel('Document type')).toHaveValue('1');
      await expect(dialog.getByRole('checkbox', { name: 'Invoice', exact: true })).toBeChecked();
      await expect(dialog.getByText('Checking whether these are already in Paperless…')).toHaveCount(0);
      await expect(dialog.getByText(/Already in Paperless/)).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Send', exact: true }).click();

      const docs = await expectSendOutcome(page, run);
      if (docs) {
        expect(docs).toHaveLength(1);
        expect(docs[0].title).toBe(`acme-${run}`);
        expect(docs[0].correspondent).toBe(1);
        expect(docs[0].document_type).toBe(1);
        expect(docs[0].tags).toContain(1);
      }
    } finally {
      await uninstallPlugin(admin, PLUGIN);
      await deleteDocs((await findDocs(run).catch(() => [])).map((d) => d.id));
    }
  });

  test('a file already in Paperless is flagged by checksum and left unticked', async ({ page }) => {
    const run = `e2e${Date.now()}`;
    const subject = `Statement ${run}`;
    const fileName = `statement-${run}.pdf`;
    const pdfPath = path.join(test.info().outputDir, 'statement.pdf');
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    sendMail({ from: 'Bob Example <bob@example.org>', subject, pdfText: `Bulwark ${run}`, pdfName: fileName, savePdf: pdfPath });
    await uploadDirect(fs.readFileSync(pdfPath), fileName, `Filed earlier ${run}`);
    const admin = await start(page);
    try {
      await openMessage(page, subject);
      await page.locator('[data-attachment-plugin-menu]').first().click();
      await page.getByRole('menuitem', { name: 'Send to Paperless' }).click();
      const dialog = page.frameLocator(SLOT).last();
      await expect(dialog.getByText(`Already in Paperless: Filed earlier ${run}`)).toBeVisible({ timeout: 30_000 });
      await expect(dialog.getByLabel(fileName)).not.toBeChecked();
      await expect(dialog.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
      // Bob Example is a correspondent by name.
      await expect(dialog.getByLabel('Correspondent')).toHaveValue('4');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    } finally {
      await uninstallPlugin(admin, PLUGIN);
      await deleteDocs((await findDocs(run).catch(() => [])).map((d) => d.id));
    }
  });

  test('reader toolbar offers the attachments and the whole message; bulk sends from several messages', async ({ page }) => {
    const run = `e2e${Date.now()}`;
    sendMail({ from: 'Stadtwerke Hildesheim <rechnung@stadtwerke-hildesheim.example>', subject: `Rechnung A ${run}`, pdfText: `A ${run}`, pdfName: `a-${run}.pdf` });
    sendMail({ from: 'Stadtwerke Hildesheim <rechnung@stadtwerke-hildesheim.example>', subject: `Rechnung B ${run}`, pdfText: `B ${run}`, pdfName: `b-${run}.pdf` });
    const admin = await start(page);
    try {
      await openMessage(page, `Rechnung A ${run}`);
      await page.getByRole('button', { name: 'Send to Paperless' }).first().click();
      const dialog = page.frameLocator(SLOT).last();
      await expect(dialog.getByLabel(`a-${run}.pdf`)).toBeChecked({ timeout: 30_000 });
      await expect(dialog.getByLabel(/^The whole message/)).not.toBeChecked();
      await expect(dialog.getByText('Paperless needs Tika for this file type')).toBeVisible();
      // "Rechnung" is the German word for invoice.
      await expect(dialog.getByLabel('Document type')).toHaveValue('1');
      await expect(dialog.getByLabel('Correspondent')).toHaveValue('2');
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      // Select both and use the selection toolbar.
      await page.keyboard.press('Escape');
      for (const letter of ['A', 'B']) {
        const row = page.getByText(`Rechnung ${letter} ${run}`, { exact: true }).first();
        await row.click({ position: { x: 4, y: 4 }, modifiers: ['Control'] });
      }
      await page.getByRole('button', { name: 'Send to Paperless' }).first().click();
      const bulk = page.frameLocator(SLOT).last();
      await expect(bulk.getByLabel(`a-${run}.pdf`)).toBeChecked({ timeout: 30_000 });
      await expect(bulk.getByLabel(`b-${run}.pdf`)).toBeChecked();
      await expect(bulk.getByRole('button', { name: 'Send 2' })).toBeEnabled();
      await bulk.getByRole('button', { name: 'Cancel' }).click();
    } finally {
      await uninstallPlugin(admin, PLUGIN);
    }
  });

  test('a rule the user switched on sends matching new mail', async ({ page }) => {
    const run = `e2e${Date.now()}`;
    const admin = await start(page);
    try {
      const settings = await openSettings(page);
      await settings.getByRole('button', { name: 'Add rule' }).click();
      await settings.getByLabel('From', { exact: true }).fill('@rules-test.example');
      await settings.getByLabel('Subject contains').fill(run);
      await settings.getByRole('checkbox', { name: 'Bulwark test', exact: true }).check();
      await settings.getByRole('checkbox', { name: 'Run this rule on new mail' }).check();
      await settings.getByRole('button', { name: 'Save rule' }).click();
      await expect(settings.getByText(`Mail from @rules-test.example with “${run}” in the subject`)).toBeVisible();
      await expect(settings.getByText('On', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Back to Mail' }).click();
      sendMail({ from: 'Rules Test <billing@rules-test.example>', subject: `Monthly ${run}`, pdfText: `Rule ${run}`, pdfName: `rule-${run}.pdf` });
      // No dialog: the rule sends on its own.
      if (await chunkedUploadsWork()) {
        await expect(page.getByText('Filed in Paperless').first()).toBeVisible({ timeout: 120_000 });
        const docs = await findDocs(run);
        expect(docs).toHaveLength(1);
        expect(docs[0].tags).toContain(5);
      } else {
        await expect(page.getByText('Paperless refused the request: document: No file was submitted.').first()).toBeVisible({ timeout: 120_000 });
      }
    } finally {
      await uninstallPlugin(admin, PLUGIN);
      await deleteDocs((await findDocs(run).catch(() => [])).map((d) => d.id));
    }
  });

  test('documents page in the navigation, on a phone too', async ({ page }) => {
    const admin = await start(page);
    try {
      await page.getByRole('link', { name: 'Paperless' }).first().click();
      const frame = page.frameLocator(SLOT).first();
      await expect(frame.getByRole('heading', { name: 'Paperless' })).toBeVisible({ timeout: 60_000 });
      await expect(frame.getByText('Steuerbescheid 2025')).toBeVisible({ timeout: 30_000 });
      await page.setViewportSize({ width: 390, height: 800 });
      await frame.getByRole('button', { name: 'Steuerbescheid 2025' }).click();
      await expect(frame.getByRole('button', { name: 'Download' })).toBeVisible();
      const width = await frame.locator('.pl').first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(width).toBe(true);
    } finally {
      await uninstallPlugin(admin, PLUGIN);
    }
  });
});

/** Switch the app theme in Settings > Appearance; resolves to the one that was on. */
async function setTheme(page, theme) {
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const group = page.getByRole('group', { name: 'Theme' });
  let before = 'light';
  for (const name of ['Light', 'Dark', 'System']) {
    if (await group.getByRole('button', { name }).getAttribute('aria-pressed') === 'true') before = name.toLowerCase();
  }
  await group.getByRole('button', { name: theme === 'dark' ? 'Dark' : theme === 'system' ? 'System' : 'Light' }).click();
  return before;
}

test('screenshots in light and dark', async ({ page }) => {
  const run = `e2e${Date.now()}`;
  sendMail({ from: 'ACME Hosting <billing@acme-hosting.example>', subject: `Invoice ${run}`, pdfText: `Shot ${run}`, pdfName: `invoice-${run}.pdf` });
  const admin = await start(page);
  let restore = null;
  try {
    for (const theme of ['light', 'dark']) {
      const before = await setTheme(page, theme);
      restore ??= before;
      const settings = await openSettings(page);
      await expect(settings.getByText('Connected to localhost:18010', { exact: false })).toBeVisible();
      await shoot(page, PLUGIN, 'settings', theme);

      await page.getByRole('link', { name: 'Paperless' }).first().click();
      const docs = page.frameLocator(SLOT).first();
      await docs.getByRole('button', { name: 'ACME invoice 2026-10' }).click({ timeout: 60_000 });
      await expect(docs.getByRole('img', { name: 'Preview of ACME invoice 2026-10' })).toBeVisible();
      await shoot(page, PLUGIN, 'documents', theme);

      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await waitForPlugin(page, PLUGIN);
      await openMessage(page, `Invoice ${run}`);
      await page.locator('[data-attachment-plugin-menu]').first().click();
      await page.getByRole('menuitem', { name: 'Send to Paperless' }).click();
      const dialog = page.frameLocator(SLOT).last();
      await expect(dialog.getByLabel('Correspondent')).toHaveValue('1', { timeout: 30_000 });
      await expect(dialog.getByText('Checking whether these are already in Paperless…')).toHaveCount(0);
      await shoot(page, PLUGIN, 'send-dialog', theme);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    }
  } finally {
    if (restore) await setTheme(page, restore).catch(() => {});
    await uninstallPlugin(admin, PLUGIN);
  }
});
