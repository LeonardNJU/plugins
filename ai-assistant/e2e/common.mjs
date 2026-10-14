// Shared steps of the assistant's end-to-end tests.

import { expect } from '@playwright/test';
import { setPluginConfig } from '../../e2e/helpers.mjs';

export const ID = 'ai-assistant';
export const MOCK = 'http://localhost:18099';

/** Admin config: Anthropic mock by default; pass overrides (null clears a key). */
export async function configure(api, overrides = {}) {
  const values = {
    anthropicBaseUrl: `${MOCK}/anthropic/v1`,
    anthropicKey: 'test-anthropic-key',
    anthropicModel: 'mock-claude',
    openaiBaseUrl: '',
    openaiKey: '',
    openaiModel: '',
    defaultProvider: 'anthropic',
    allowUserKeys: false,
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) await setPluginConfig(api, ID, key, value);
}

/**
 * Answer the privacy notice the first time a service is used: in the
 * reader it is the host's confirm dialog; in the assistant dialog it is
 * shown in the dialog body, with Continue in the dialog's footer.
 */
export async function acceptPrivacy(page, { expectText, inDialog = false } = {}) {
  if (inDialog) {
    const { box, frame } = assistantDialog(page);
    await expect(frame.getByText('Send text to the AI service?')).toBeVisible();
    if (expectText) await expect(frame.getByRole('status')).toContainText(expectText);
    await box.getByRole('button', { name: 'Continue' }).click();
    return;
  }
  const notice = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Send text to the AI service?' });
  await expect(notice).toBeVisible();
  if (expectText) await expect(notice).toContainText(expectText);
  await notice.getByRole('button', { name: 'Continue' }).click();
}

/** The composer's editor. */
export const editor = (page) => page.locator('[contenteditable="true"]').first();

/** Open the composer and type a message body; lines are separate paragraphs. */
export async function composeWith(page, text) {
  await page.getByRole('button', { name: 'Compose' }).first().click();
  const box = editor(page);
  await box.click();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await box.press('Enter');
    if (lines[i]) await box.pressSequentially(lines[i], { delay: 5 });
  }
  // onDraftChange (the subject) is debounced.
  await page.waitForTimeout(1500);
}

/** The editor's own text: the lines above the signature, as the user sees them. */
export async function editorText(page) {
  return (await editor(page).innerText()).replace(/\r/g, '');
}

/** The assistant dialog: the host's box (title, footer buttons) and the plugin's frame inside it. */
export function assistantDialog(page) {
  const box = page.getByRole('dialog').filter({ hasText: 'Writing assistant' });
  return { box, frame: box.frameLocator(`iframe[title="plugin-${ID}-slot"]`) };
}

export const OLLAMA = 'http://localhost:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';

/** Ollama speaks both APIs; it takes any key. */
export const OLLAMA_CONFIG = {
  openaiBaseUrl: `${OLLAMA}/v1`, openaiKey: 'ollama', openaiModel: OLLAMA_MODEL,
  anthropicBaseUrl: `${OLLAMA}/v1`, anthropicKey: 'ollama', anthropicModel: OLLAMA_MODEL,
};

/**
 * Whether the test-env mock reads chunked request bodies. The webmail's
 * proxy streams every request body, and mocks/server.py before
 * "accept chunked request bodies" answered those with 400.
 */
export async function mockReadsChunked() {
  try {
    const body = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"model":"m","max_tokens":5,"messages":[{"role":"user","content":"x"}]}')); c.close(); },
    });
    const res = await fetch(`${MOCK}/anthropic/v1/messages`, {
      method: 'POST', body, duplex: 'half',
      headers: { 'x-api-key': 'test-anthropic-key', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ollamaUp() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    const json = await res.json();
    return json.models?.some((m) => m.name === OLLAMA_MODEL) ?? false;
  } catch {
    return false;
  }
}

/** The Assistant button in the composer's bottom bar. */
export const assistantButton = (page) => page.locator(`[data-plugin-action="${ID}:assistant"]`).first();

/**
 * Open the assistant with Alt+A, or with `click: true` from its button in
 * the composer's bottom bar (the button test checks that one on its own).
 */
export async function openAssistant(page, { click = false } = {}) {
  if (click) await assistantButton(page).click();
  else await editor(page).press('Alt+a');
  const dialog = assistantDialog(page);
  await expect(dialog.box).toBeVisible();
  return dialog;
}
