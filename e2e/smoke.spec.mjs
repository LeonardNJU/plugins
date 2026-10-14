import { test, expect } from '@playwright/test';
import { adminApi, installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin } from './helpers.mjs';

// The harness itself: an admin-installed plugin starts for a signed-in user.
test('an admin-installed plugin starts after sign-in', async ({ page }) => {
  const api = await adminApi();
  await installPlugin(api, 'hello-world');
  try {
    await preparePage(page);
    await signIn(page);
    await waitForPlugin(page, 'hello-world');
    await expect(page).not.toHaveURL(/login/);
  } finally {
    await uninstallPlugin(api, 'hello-world');
  }
});
