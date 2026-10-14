import { test, expect } from '@playwright/test';
import { adminApi, install } from './admin.mjs';
import { installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import { ID, configure, acceptPrivacy, composeWith, openAssistant, OLLAMA_CONFIG, ollamaUp } from './common.mjs';

// Grammar fixes as suggestions accepted one by one, against Ollama (the
// mock's fixed answer is not a correction). The model's answer varies, so
// the test checks the mechanics, not the wording.

const DRAFT = 'Hello Bob, i has two question about teh offer. Can we talk tomorow?';

for (const theme of ['light', 'dark']) {
  test(`accept grammar suggestions one by one and undo (${theme})`, async ({ page }) => {
    test.skip(!(await ollamaUp()), 'Ollama is not running (docker compose --profile ai up)');
    const api = await install(await adminApi(), ID, installPlugin);
    try {
      await configure(api, { ...OLLAMA_CONFIG, defaultProvider: 'openai' });
      await preparePage(page, { theme });
      await signIn(page);
      await waitForPlugin(page, ID);
      await composeWith(page, DRAFT);
      const dialog = await openAssistant(page);
      const text = dialog.getByLabel('Your text');
      await expect(text).toHaveValue(DRAFT);
      await dialog.getByRole('button', { name: 'Check spelling and grammar' }).click();
      await acceptPrivacy(dialog);
      const review = dialog.getByTestId('ai-grammar');
      await expect(review).toBeVisible({ timeout: 90_000 });
      const suggestions = dialog.getByTestId('ai-suggestion');
      const count = await suggestions.count();
      test.skip(count === 0, 'the model found nothing to correct this time');
      await expect(text).not.toBeEditable();
      await shoot(page, ID, 'composer-grammar', theme);

      await suggestions.first().getByRole('button', { name: /^Accept:/ }).click();
      await expect(suggestions).toHaveCount(count - 1);
      const afterFirst = await text.inputValue();
      expect(afterFirst).not.toBe(DRAFT);
      if (count > 1) {
        await suggestions.first().getByRole('button', { name: /^Keep:/ }).click();
        await expect(suggestions).toHaveCount(count - 2);
        await expect(text).toHaveValue(afterFirst);
      }
      await dialog.getByRole('button', { name: 'Undo' }).click();
      await expect(text).toHaveValue(DRAFT);
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(review).toHaveCount(0);
      await expect(text).toBeEditable();
    } finally {
      await uninstallPlugin(api, ID);
    }
  });
}
