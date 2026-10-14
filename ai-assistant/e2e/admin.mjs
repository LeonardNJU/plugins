// An admin API client that signs in once and reuses the session.
//
// The webmail allows 5 admin sign-ins per client address in 15 minutes, and
// several plugin test suites share one webmail. This client keeps its admin
// cookie in a temporary file and uses its own client address
// (X-Forwarded-For), so a test run doesn't spend everyone's attempts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import { BASE } from '../../e2e/helpers.mjs';

const STATE = process.env.AI_ASSISTANT_ADMIN_STATE || path.join(os.tmpdir(), 'bulwark-e2e-ai-assistant-admin.json');
const HEADERS = { 'x-forwarded-for': '10.77.41.9' };

async function signedIn(api) {
  const res = await api.get('/api/admin/plugins');
  return res.ok();
}

export async function adminApi() {
  const password = process.env.BULWARK_ADMIN_PASSWORD;
  if (!password) throw new Error('Set BULWARK_ADMIN_PASSWORD to the webmail admin password');
  if (fs.existsSync(STATE)) {
    const api = await playwrightRequest.newContext({ baseURL: BASE, storageState: STATE, extraHTTPHeaders: HEADERS });
    if (await signedIn(api)) return api;
    await api.dispose();
  }
  const api = await playwrightRequest.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS });
  const res = await api.post('/api/admin/auth', { data: { password } });
  if (!res.ok()) throw new Error(`Admin sign-in failed: HTTP ${res.status()} ${await res.text()}`);
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  await api.storageState({ path: STATE });
  return api;
}
