import { test, expect } from '@playwright/test';
import { adminApi, install } from './admin.mjs';
import { installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import { ID, configure, acceptPrivacy, composeWith, editor, editorText, lastProposal, openAssistant, waitDone, OLLAMA_CONFIG, ollamaUp } from './common.mjs';

// Spelling fixes as suggestions accepted one by one in the panel, then put
// into the message with Replace. Against Ollama: the mock's fixed answer is
// not a correction. The model's answer varies, so the test checks the
// mechanics, not the wording.

const DRAFT = 'Hello Bob, i has two question about teh offer. Can we talk tomorow?';

for (const theme of ['light', 'dark']) {
  test(`accept spelling fixes one by one and replace the message (${theme})`, async ({ page }) => {
    test.skip(!(await ollamaUp()), 'Ollama is not running (test-env/up.ps1 -WithAI)');
    const api = await install(await adminApi(), ID, installPlugin);
    try {
      await configure(api, { ...OLLAMA_CONFIG, defaultProvider: 'openai' });
      await page.setViewportSize({ width: 1600, height: 900 });
      await preparePage(page, { theme });
      await signIn(page);
      await waitForPlugin(page, ID);
      await composeWith(page, DRAFT);
      const before = await editorText(page);
      const { frame } = await openAssistant(page);
      await frame.getByRole('button', { name: 'Actions' }).click();
      await frame.getByRole('menuitem', { name: 'Fix spelling' }).click();
      await acceptPrivacy(page, { frame });
      await waitDone(frame);

      const accept = frame.getByRole('button', { name: /^Accept:/ });
      const none = frame.getByText('No mistakes found.');
      await expect(accept.first().or(none)).toBeVisible();
      const count = await accept.count();
      test.skip(count === 0, 'the model found nothing to correct this time');
      const { card } = lastProposal(frame);
      const replace = card.getByRole('button', { name: 'Replace' });
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
      await expect(card.getByText('Replaced')).toBeVisible();
      const after = await editorText(page);
      expect(after).not.toBe(before);

      const box = editor(page);
      await box.click();
      await box.press('ControlOrMeta+z');
      await expect.poll(() => editorText(page)).toBe(before);
    } finally {
      await uninstallPlugin(api, ID);
    }
  });
}
