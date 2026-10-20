// Decrypting real CMS messages the way the plugin does it: import the
// fixture .p12, unlock it, keep the unlocked keys in the session store
// (IndexedDB, here a structured-clone stand-in) and decrypt with what comes
// back out. Fixtures: test/fixtures/README.md.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fakeIndexedDB } from './helpers/fake-indexeddb.mjs';
import { importPkcs12, unlockPrivateKey } from '../src/pkcs12.js';
import { saveKeyRecord, saveSessionKeys, deleteSessionKeys } from '../src/key-storage.js';
import { unlockedDecryptMaps } from '../src/session-keys.js';
import { smimeDecrypt, normalizeCmsBytes, SmimeKeyLockedError } from '../src/smime-decrypt.js';

const fixture = (name) => {
  const buf = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};
const PLAINTEXT = 'Hello from the S/MIME test fixture.';
const STORAGE_PASS = 'storage passphrase';

let keyRecord;
let idb;

beforeAll(async () => {
  ({ keyRecord } = await importPkcs12(fixture('test.p12'), 'fixture', STORAGE_PASS));
}, 60_000);

beforeEach(async () => {
  idb = fakeIndexedDB();
  globalThis.indexedDB = idb;
  await saveKeyRecord(keyRecord);
});

async function unlock() {
  const unlocked = await unlockPrivateKey(keyRecord, STORAGE_PASS);
  await saveSessionKeys({ id: keyRecord.id, ...unlocked });
}

async function decrypt(cms) {
  const { mimeBytes } = await smimeDecrypt({ cmsBytes: normalizeCmsBytes(cms), ...(await unlockedDecryptMaps()) });
  return new TextDecoder().decode(mimeBytes);
}

describe('decrypting after the session store round trip', () => {
  it('reads AES-256-CBC mail whose key is wrapped with RSA PKCS#1 v1.5', async () => {
    await unlock();
    const text = await decrypt(fixture('cbc.p7m'));
    expect(text).toMatch(/^Content-Type: text\/plain; charset=utf-8\r\n\r\n/);
    expect(text).toContain(PLAINTEXT);
  }, 30_000);

  it('keeps no webcrypto-liner key in the session store', async () => {
    await unlock();
    await decrypt(fixture('cbc.p7m'));
    const stored = idb.rows('smime-plugin-store', 'session-keys').get(keyRecord.id);
    expect(stored).toBeDefined();
    // The liner key is a plain JS object holding the raw RSA key.
    expect(stored).not.toHaveProperty('legacyDecryptionKey');
    expect(stored.sealedPkcs8.key).toBeInstanceOf(CryptoKey);
    expect(stored.sealedPkcs8.key.extractable).toBe(false);
  }, 30_000);

  it('asks to unlock again once the key is locked, although this iframe decrypted with it before', async () => {
    await unlock();
    await decrypt(fixture('cbc.p7m'));
    await deleteSessionKeys(keyRecord.id);
    await expect(decrypt(fixture('cbc.p7m'))).rejects.toBeInstanceOf(SmimeKeyLockedError);
  }, 30_000);

  it('treats a session entry written by an older version as locked', async () => {
    const { signingKey, decryptionKey } = await unlockPrivateKey(keyRecord, STORAGE_PASS);
    idb.rows('smime-plugin-store', 'session-keys').set(keyRecord.id, {
      id: keyRecord.id, signingKey, decryptionKey, legacyDecryptionKey: { algorithm: { name: 'RSAES-PKCS1-v1_5' } },
    });
    await expect(decrypt(fixture('cbc.p7m'))).rejects.toBeInstanceOf(SmimeKeyLockedError);
  }, 30_000);
});
