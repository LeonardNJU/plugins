// Test mail for alice in Stalwart: delivered over SMTP, found and removed
// over JMAP.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const JMAP = process.env.STALWART_URL || 'http://localhost:18025';
const USER = process.env.BULWARK_USER || 'alice@example.org';
const PASSWORD = process.env.BULWARK_PASSWORD || 'test-pass-123';
const AUTH = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
const USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'];

async function call(methodCalls) {
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(`${JMAP}/jmap/`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ using: USING, methodCalls }),
    });
    if (res.status !== 429 || attempt >= 10) break;
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  if (!res.ok) throw new Error(`JMAP HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()).methodResponses;
}

async function accountId() {
  const res = await fetch(`${JMAP}/jmap/session`, { headers: { Authorization: AUTH } });
  return (await res.json()).primaryAccounts['urn:ietf:params:jmap:mail'];
}

/**
 * Deliver a text + HTML message to alice over SMTP submission (see
 * send_mail.py), like a real shipping notice arrives.
 */
export function sendMail(message) {
  const res = spawnSync(process.env.PYTHON || 'python', [path.join(here, 'send_mail.py')], {
    input: JSON.stringify(message), encoding: 'utf8', timeout: 60_000,
  });
  if (res.status !== 0) throw new Error(`send_mail.py failed: ${res.stderr || res.error}`);
  return res.stdout.trim();
}

export async function destroyMail(ids) {
  const account = await accountId();
  await call([['Email/set', { accountId: account, destroy: ids }, 'd']]);
}

/** Ids of messages with exactly this subject. */
export async function findBySubject(subject) {
  const account = await accountId();
  const [[, q]] = await call([['Email/query', { accountId: account, filter: { subject } }, 'q']]);
  return q.ids ?? [];
}
