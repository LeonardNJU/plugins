import { test, expect } from '@playwright/test';
import { adminApi, install } from './admin.mjs';
import { installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import { ID, configure, acceptPrivacy, composeWith, editor, editorText, openAssistant, OLLAMA_CONFIG, ollamaUp } from './common.mjs';

// Spelling fixes as suggestions accepted one by one, then put into the
// message with Replace. Against Ollama: the mock's fixed answer is not a
// correction. The model's answer varies, so the test checks the mechanics,
// not the wording.

const DRAFT = 'Hello Bob, i has two question about teh offer. Can we talk tomorow?';

for (const theme of ['light', 'dark']) {
  test(`accept spelling fixes one by one and replace the message (${theme})`, async ({ page }) => {
    test.skip(!(await ollamaUp()), 'Ollama is not running (test-env/up.ps1 -WithAI)');
    const api = await install(await adminApi(), ID, installPlugin);
    try {
      await configure(api, { ...OLLAMA_CONFIG, defaultProvider: 'openai' });
      await preparePage(page, { theme });
      await signIn(page);
      await waitForPlugin(page, ID);
      await composeWith(page, DRAFT);
      const before = await editorText(page);
      const { box, frame } = await openAssistant(page);
      await frame.getByRole('radio', { name: 'Fix spelling' }).click();
      await box.getByRole('button', { name: 'Check spelling and grammar' }).click();
      await acceptPrivacy(page, { inDialog: true });

      const accept = frame.getByRole('button', { name: /^Accept:/ });
      const none = frame.getByText('No mistakes found.');
      await expect(accept.first().or(none)).toBeVisible({ timeout: 90_000 });
      const count = await accept.count();
      test.skip(count === 0, 'the model found nothing to correct this time');
      const replace = box.getByRole('button', { name: 'Replace' });
      await expect(replace).toBeDisabled();
      await shoot(page, ID, 'composer-grammar', theme);

      await accept.first().click();
      await expect(accept).toHaveCount(count - 1);
      if (count > 1) {
        await frame.getByRole('button', { name: /^Keep:/ }).first().click();
        await expect(accept).toHaveCount(count - 2);
      }
      await expect(replace).toBeEnabled();
      await replace.click();
      await expect(box).toHaveCount(0);
      const after = await editorText(page);
      expect(after).not.toBe(before);

      const box1 = editor(page);
      await box1.click();
      await box1.press('ControlOrMeta+z');
      await expect.poll(() => editorText(page)).toBe(before);
    } finally {
      await uninstallPlugin(api, ID);
    }
  });
}
