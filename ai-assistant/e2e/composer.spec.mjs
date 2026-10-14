import { test, expect } from '@playwright/test';
import { adminApi, install } from './admin.mjs';
import { installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import { ID, configure, acceptPrivacy, composeWith, openAssistant, OLLAMA_CONFIG, mockReadsChunked, ollamaUp } from './common.mjs';

// The composer: rewrite and translate the user's draft, undo, copy; and the
// errors users see. Answers come from the test-env mocks (deterministic
// text) and from Ollama, which speaks both the OpenAI and the Anthropic API.

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const MOCK_REPLY = /Mock reply\. You asked: .*This text comes from the Bulwark test mock\./s;
const DRAFT = 'hi bob, can we meet on tuesday? i has some questions';

const SERVICES = [
  {
    name: 'the Anthropic mock', theme: 'light', available: mockReadsChunked,
    config: {}, provider: 'Anthropic at localhost:18099 (model mock-claude)', answer: MOCK_REPLY,
  },
  {
    name: 'the OpenAI mock', theme: 'dark', available: mockReadsChunked,
    config: { anthropicBaseUrl: '', anthropicKey: '', openaiBaseUrl: 'http://localhost:18099/openai/v1', openaiKey: 'test-openai-key', openaiModel: 'mock-gpt-small', defaultProvider: 'openai' },
    provider: 'OpenAI-compatible at localhost:18099 (model mock-gpt-small)', answer: MOCK_REPLY,
  },
  {
    name: 'Ollama, OpenAI-compatible', theme: 'light', available: ollamaUp,
    config: { ...OLLAMA_CONFIG, defaultProvider: 'openai' }, provider: 'OpenAI-compatible at localhost:11434', answer: /\S{2,}/,
  },
  {
    name: 'Ollama, Anthropic Messages API', theme: 'dark', available: ollamaUp,
    config: { ...OLLAMA_CONFIG, defaultProvider: 'anthropic' }, provider: 'Anthropic at localhost:11434', answer: /\S{2,}/,
  },
];

for (const service of SERVICES) {
  test(`rewrite, undo, translate and copy in the composer with ${service.name}`, async ({ page }) => {
    test.skip(!(await service.available()), `${service.name} is not reachable through the proxy (see README)`);
    const api = await install(await adminApi(), ID, installPlugin);
    try {
      await configure(api, service.config);
      await preparePage(page, { theme: service.theme });
      await signIn(page);
      await waitForPlugin(page, ID);
      await composeWith(page, DRAFT);

      const dialog = await openAssistant(page);
      const text = dialog.getByLabel('Your text');
      await expect(text).toHaveValue(DRAFT);

      await dialog.getByLabel('How to rewrite').selectOption('formal');
      await dialog.getByRole('button', { name: 'Rewrite' }).click();
      await acceptPrivacy(dialog, { expectText: service.provider });
      const result = dialog.getByTestId('ai-result');
      await expect(dialog.getByRole('button', { name: 'Use this' })).toBeVisible({ timeout: 90_000 });
      await expect(result).toContainText('Rewritten text');
      await expect(result).toContainText(service.answer);
      const suggested = (await result.locator('.ai-out').innerText()).trim();
      await shoot(page, ID, `composer-rewrite-${service.name.replace(/\W+/g, '-').toLowerCase()}`, service.theme);

      await dialog.getByRole('button', { name: 'Use this' }).click();
      await expect(text).toHaveValue(suggested);
      await dialog.getByRole('button', { name: 'Undo' }).click();
      await expect(text).toHaveValue(DRAFT);

      // The privacy notice comes only once per service.
      await dialog.getByLabel('Translate into').selectOption('fr');
      await dialog.getByRole('button', { name: 'Translate' }).click();
      await expect(dialog.getByRole('button', { name: 'Use this' })).toBeVisible({ timeout: 90_000 });
      await expect(dialog.getByRole('alertdialog')).toHaveCount(0);
      await expect(result).toContainText('Translation');
      const translated = (await result.locator('.ai-out').innerText()).trim();
      await dialog.getByRole('button', { name: 'Use this' }).click();

      await dialog.getByRole('button', { name: 'Copy and close' }).click();
      await expect(page.getByRole('dialog').filter({ hasText: 'Writing assistant' })).toHaveCount(0);
      // Reading the clipboard needs a focused document.
      await page.locator('[contenteditable="true"]').first().focus();
      expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(translated);
    } finally {
      await uninstallPlugin(api, ID);
    }
  });
}

test('write from a prompt, and stop a running answer', async ({ page }) => {
  test.skip(!(await ollamaUp()), 'Ollama is not running (docker compose --profile ai up)');
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    await configure(api, { ...OLLAMA_CONFIG, defaultProvider: 'openai' });
    await preparePage(page);
    await signIn(page);
    await waitForPlugin(page, ID);
    await composeWith(page, ' ');
    const dialog = await openAssistant(page);
    const prompt = dialog.getByLabel('What should the email say?');
    await prompt.fill('a long, detailed email thanking Anna for the workshop, with five paragraphs');
    await dialog.getByRole('button', { name: 'Write', exact: true }).click();
    await acceptPrivacy(dialog);
    const result = dialog.getByTestId('ai-result');
    // Stop while it runs. (The webmail hands a proxied answer over in one
    // piece when the request has a body, so there is no partial text here.)
    await dialog.getByRole('button', { name: 'Stop' }).click();
    await expect(result).toContainText('Stopped.');
    await expect(dialog.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    // Writing again works after a stop.
    await prompt.fill('a short thank-you note to Anna');
    await dialog.getByRole('button', { name: 'Write', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Use this' })).toBeVisible({ timeout: 90_000 });
    await dialog.getByRole('button', { name: 'Use this' }).click();
    await expect(dialog.getByLabel('Your text')).not.toHaveValue('');
  } finally {
    await uninstallPlugin(api, ID);
  }
});

const ERRORS = [
  ['a rate limit with its wait time', { anthropicKey: 'rate-limited' }, /too many requests\. You can try again in [1-7] s\./],
  ['a refused key (Anthropic)', { anthropicKey: 'wrong-key' }, /didn't accept the API key/],
  ['a refused key (OpenAI)', { anthropicBaseUrl: '', openaiBaseUrl: 'http://localhost:18099/openai/v1', openaiKey: 'wrong-key', defaultProvider: 'openai' }, /didn't accept the API key/],
];

for (const [name, config, message] of ERRORS) {
  test(`explains ${name}`, async ({ page }) => {
    const api = await install(await adminApi(), ID, installPlugin);
    try {
      await configure(api, config);
      await preparePage(page);
      await signIn(page);
      await waitForPlugin(page, ID);
      await composeWith(page, 'Hello there');
      const dialog = await openAssistant(page);
      await dialog.getByRole('button', { name: 'Rewrite' }).click();
      await acceptPrivacy(dialog);
      await expect(dialog.locator('.ai-error')).toContainText(message);
      if (name.startsWith('a rate limit')) {
        await expect(dialog.getByRole('button', { name: 'Try again' })).toBeDisabled();
        await shoot(page, ID, 'composer-rate-limit', 'light');
        await expect(dialog.getByRole('button', { name: 'Try again' })).toBeEnabled({ timeout: 10_000 });
      }
    } finally {
      await uninstallPlugin(api, ID);
    }
  });
}
