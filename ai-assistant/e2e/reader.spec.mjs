import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { adminApi, install } from './admin.mjs';
import { installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import { ID, configure, acceptPrivacy, editor, OLLAMA_CONFIG, ollamaUp, mockReadsChunked } from './common.mjs';

// The reader: an info bar above the message with Summarize, To-dos and
// dates, and Reply ideas, the results inside the bar; a reply idea opens a
// reply that already says it; and a summary of a whole conversation.
// Answers come from the mock when it reads the proxy's request bodies, else
// from Ollama (Anthropic Messages API). The privacy notice is the host's
// confirm dialog.

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function service() {
  if (await mockReadsChunked()) return { config: {}, answer: /Mock reply/ };
  if (await ollamaUp()) return { config: { ...OLLAMA_CONFIG, defaultProvider: 'anthropic' }, answer: /\S{2,}/ };
  return null;
}

/** The frame of the plugin's slot that has this button. */
async function slotWith(page, name) {
  const frames = page.locator(`iframe[title="plugin-${ID}-slot"]`);
  await expect(async () => {
    const n = await frames.count();
    let found = false;
    for (let i = 0; i < n; i++) {
      if (await frames.nth(i).contentFrame().getByRole('button', { name }).count()) found = true;
    }
    expect(found).toBe(true);
  }).toPass({ timeout: 30_000 });
  const n = await frames.count();
  for (let i = 0; i < n; i++) {
    const frame = frames.nth(i).contentFrame();
    if (await frame.getByRole('button', { name }).count()) return frame;
  }
  throw new Error(`no slot with ${name}`);
}

async function openMessage(page, subject, target = page.getByText(subject, { exact: true }).first()) {
  // Search for it: other test suites add mail to the same inbox.
  const opener = page.getByRole('button', { name: /Search mail/ });
  if (await opener.isVisible().catch(() => false)) await opener.click();
  const search = page.getByRole('combobox', { name: /Search mail/ });
  await search.click();
  // "Re:" would be read as a search operator.
  await search.fill(subject.replace(/^Re: /, ''));
  await search.press('Enter');
  // Rows re-render while other plugins add badges, so they are never "stable".
  await target.waitFor({ timeout: 60_000 });
  await target.click({ force: true });
}

async function readClipboard(page) {
  await page.locator('body').focus().catch(() => {});
  await page.evaluate(() => window.focus());
  return page.evaluate(() => navigator.clipboard.readText());
}

async function setUp(page, api, { theme = 'light', viewport } = {}) {
  const svc = await service();
  test.skip(!svc, 'neither the mock (with chunked bodies) nor Ollama is available');
  await configure(api, svc.config);
  if (viewport) await page.setViewportSize(viewport);
  await preparePage(page, { theme });
  await signIn(page);
  await waitForPlugin(page, ID);
  return svc;
}

for (const theme of ['light', 'dark']) {
  test(`summarise a message in the reader (${theme})`, async ({ page }) => {
    const api = await install(await adminApi(), ID, installPlugin);
    try {
      const svc = await setUp(page, api, { theme });
      await openMessage(page, 'Can we meet on Thursday?', page.getByText('send me the slides').first());
      const bar = await slotWith(page, 'Summarize');
      await expect(bar.getByText('AI assistant')).toBeVisible();
      if (theme === 'light') await shoot(page, ID, 'reader-bar', theme);
      await bar.getByRole('button', { name: 'Summarize' }).click();
      await acceptPrivacy(page);
      await expect(bar.getByRole('button', { name: 'Copy' })).toBeVisible({ timeout: 90_000 });
      await expect(bar.getByText('Summary', { exact: true })).toBeVisible();
      await expect(bar.locator('body')).toContainText(svc.answer);
      await shoot(page, ID, 'reader-summary', theme);
      await bar.getByRole('button', { name: 'Close' }).click();
      await expect(bar.getByText('Summary', { exact: true })).toHaveCount(0);
      await expect(bar.getByRole('button', { name: 'Summarize' })).toBeVisible();
    } finally {
      await uninstallPlugin(api, ID);
    }
  });
}

test('to-dos and dates, and a reply idea that opens a reply', async ({ page }) => {
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    await setUp(page, api);
    await openMessage(page, 'Can we meet on Thursday?', page.getByText('send me the slides').first());
    const bar = await slotWith(page, 'To-dos and dates');
    await bar.getByRole('button', { name: 'To-dos and dates' }).click();
    await acceptPrivacy(page);
    await expect(bar.getByRole('button', { name: 'Copy list' }).or(bar.getByText(/Nothing to do/))).toBeVisible({ timeout: 90_000 });
    if (await bar.getByRole('button', { name: 'Copy list' }).count()) {
      await shoot(page, ID, 'reader-todos', 'light');
      await bar.getByRole('button', { name: 'Copy list' }).click();
      expect((await readClipboard(page)).replace(/\r/g, '')).toMatch(/^(To-dos|Dates):\s*\n- /);
    }

    // Close brings the actions back. The notice was answered once; reply ideas go straight through.
    await bar.getByRole('button', { name: 'Close' }).click();
    await bar.getByRole('button', { name: 'Reply ideas' }).click();
    const replyButtons = bar.getByRole('button', { name: 'Reply', exact: true });
    await expect(replyButtons.first()).toBeVisible({ timeout: 90_000 });
    expect(await replyButtons.count()).toBeLessThanOrEqual(3);
    // The idea is the text next to its button.
    const idea = (await replyButtons.first().locator('xpath=following-sibling::*[1]').innerText()).replace(/\r/g, '').trim();
    expect(idea.length).toBeGreaterThan(3);
    await shoot(page, ID, 'reader-replies', 'light');
    await replyButtons.first().click();
    // A reply opens with the idea already in it.
    const firstLine = idea.split('\n')[0].slice(0, 40);
    await expect(editor(page)).toContainText(firstLine, { timeout: 20_000 });
  } finally {
    await uninstallPlugin(api, ID);
  }
});

test('summarise a conversation on a phone', async ({ page }) => {
  execFileSync('python', [path.join(HERE, 'seed_thread.py')], { stdio: 'inherit' });
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    const svc = await setUp(page, api, { viewport: { width: 390, height: 844 } });
    // The list shows the conversation as one row, with the first message's text.
    await openMessage(page, 'Team offsite in November', page.getByText('Budget is 2000 EUR').first());
    const slot = await slotWith(page, /Summarize this conversation \(\d+ messages\)/);
    await slot.getByRole('button', { name: /Summarize this conversation/ }).click();
    await acceptPrivacy(page);
    await expect(slot.getByRole('button', { name: 'Copy' })).toBeVisible({ timeout: 90_000 });
    await expect(slot.getByText(/Conversation summary \(\d+ messages\)/)).toBeVisible();
    await expect(slot.locator('body')).toContainText(svc.answer);
    await shoot(page, ID, 'thread-summary-phone', 'light');
  } finally {
    await uninstallPlugin(api, ID);
  }
});
