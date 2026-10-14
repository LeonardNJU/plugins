import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { adminApi, install } from './admin.mjs';
import { installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import { ID, configure, acceptPrivacy, OLLAMA_CONFIG, ollamaUp, mockReadsChunked } from './common.mjs';

// The reader: summary, to-dos and dates, reply ideas above a message, and a
// summary of a whole conversation. Answers come from Ollama (Anthropic
// Messages API), or from the mock when it reads the proxy's request bodies.

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
      await bar.getByRole('button', { name: 'Summarize' }).click();
      await acceptPrivacy(bar);
      const result = bar.getByTestId('ai-reader-result');
      await expect(result.getByRole('button', { name: 'Copy' })).toBeVisible({ timeout: 90_000 });
      await expect(result).toContainText('Summary');
      await expect(result).toContainText(svc.answer);
      await shoot(page, ID, 'reader-summary', theme);
      await result.getByRole('button', { name: 'Close' }).click();
      await expect(result).toHaveCount(0);
    } finally {
      await uninstallPlugin(api, ID);
    }
  });
}

test('to-dos and dates, and reply ideas', async ({ page }) => {
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    await setUp(page, api);
    await openMessage(page, 'Can we meet on Thursday?', page.getByText('send me the slides').first());
    const bar = await slotWith(page, 'To-dos and dates');
    await bar.getByRole('button', { name: 'To-dos and dates' }).click();
    await acceptPrivacy(bar);
    const result = bar.getByTestId('ai-reader-result');
    await expect(result.getByRole('button', { name: 'Copy list' }).or(result.getByText('Nothing to do'))).toBeVisible({ timeout: 90_000 });
    if (await result.getByRole('button', { name: 'Copy list' }).count()) {
      await shoot(page, ID, 'reader-todos', 'light');
      await result.getByRole('button', { name: 'Copy list' }).click();
      expect((await readClipboard(page)).replace(/\r/g, '')).toMatch(/^(To-dos|Dates):\s*\n- /);
    }

    // The notice was answered once; reply ideas go straight through.
    await bar.getByRole('button', { name: 'Reply ideas' }).click();
    await expect(bar.getByRole('alertdialog')).toHaveCount(0);
    const replies = result.getByTestId('ai-reply');
    await expect(replies.first()).toBeVisible({ timeout: 90_000 });
    expect(await replies.count()).toBeLessThanOrEqual(3);
    const first = (await replies.first().locator('div').first().innerText()).trim();
    await shoot(page, ID, 'reader-replies', 'light');
    await replies.first().getByRole('button', { name: 'Copy' }).click();
    expect((await readClipboard(page)).replace(/\r/g, '').trim()).toBe(first.replace(/\r/g, ''));
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
    await acceptPrivacy(slot);
    const result = slot.getByTestId('ai-thread-result');
    await expect(result.getByRole('button', { name: 'Copy' })).toBeVisible({ timeout: 90_000 });
    await expect(result).toContainText(/Conversation summary \(\d+ messages\)/);
    await expect(result).toContainText(svc.answer);
    await shoot(page, ID, 'thread-summary-phone', 'light');
  } finally {
    await uninstallPlugin(api, ID);
  }
});
