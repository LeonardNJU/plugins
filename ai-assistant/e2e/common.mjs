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

/** Click Continue in the privacy notice (shown in the plugin's frame) the first time a service is used. */
export async function acceptPrivacy(frame, { expectText } = {}) {
  const notice = frame.getByRole('alertdialog').filter({ hasText: 'Send text to the AI service?' });
  await expect(notice).toBeVisible();
  if (expectText) await expect(notice).toContainText(expectText);
  await notice.getByRole('button', { name: 'Continue' }).click();
}

/** Open the composer and type a message body. */
export async function composeWith(page, text) {
  await page.getByRole('button', { name: 'Compose' }).first().click();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await editor.pressSequentially(text, { delay: 5 });
  // onDraftChange is debounced.
  await page.waitForTimeout(2500);
}

/** The assistant dialog's frame. */
export function assistantDialog(page) {
  return page.getByRole('dialog').filter({ hasText: 'Writing assistant' }).frameLocator(`iframe[title="plugin-${ID}-slot"]`);
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

/** Open the assistant dialog from the composer's plugin row. */
export async function openAssistant(page) {
  await page.locator(`[data-composer-plugin-row] iframe[title="plugin-${ID}-slot"]`).first()
    .contentFrame().getByRole('button', { name: 'Assistant' }).click();
  return assistantDialog(page);
}
