// The admin sign-in allows 5 attempts per address in 15 minutes, counting
// successful ones, and several test runs share the webmail. Keep the admin
// session cookie between runs, sign in again only when it has expired, and
// wait out the limit instead of failing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import { BASE } from '../../e2e/helpers.mjs';

const STATE = process.env.BIRTHDAYS_ADMIN_STATE || path.join(os.tmpdir(), 'bulwark-birthdays-admin-state.json');
const MAX_WAIT_MS = 16 * 60 * 1000;

export async function cachedAdminApi() {
  if (fs.existsSync(STATE)) {
    const api = await playwrightRequest.newContext({ baseURL: BASE, storageState: STATE });
    const probe = await api.get('/api/admin/plugins');
    if (probe.ok()) return api;
    await api.dispose();
  }
  const password = process.env.BULWARK_ADMIN_PASSWORD;
  if (!password) throw new Error('Set BULWARK_ADMIN_PASSWORD to the webmail admin password');
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    const res = await api.post('/api/admin/auth', { data: { password } });
    if (res.ok()) break;
    if (res.status() !== 429 || Date.now() > deadline) {
      throw new Error(`Admin sign-in failed: HTTP ${res.status()} ${await res.text()}`);
    }
    const retryAfter = Number(res.headers()['retry-after']) || 30;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 60) * 1000));
  }
  await api.storageState({ path: STATE });
  return api;
}
