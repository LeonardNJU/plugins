/**
 * The decrypt side of the session store.
 *
 * Native WebCrypto has no RSAES-PKCS1-v1_5, which Thunderbird, Outlook and
 * Stalwart's AES-CBC encryption at rest use to wrap the content key. That
 * needs a webcrypto-liner key, and a liner key is a JS object: IndexedDB
 * hands it back as a plain Object that liner rejects. So unlocking stores
 * the PKCS#8 bytes sealed under a fresh non-extractable AES-GCM key instead
 * (both clone fine), and the decrypt path rebuilds the liner key from them
 * when it needs one, keeping it in memory for the iframe's lifetime.
 */

import { listKeyRecords, getSessionKeys } from './key-storage.js';
import { getLinerCrypto } from './crypto-engine.js';
import { toHex } from './util.js';

/** Seal PKCS#8 bytes under an AES-GCM key that exists only for this session. */
export async function sealPkcs8(pkcs8Bytes) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pkcs8Bytes);
  return { key, iv, data };
}

async function unsealPkcs8(sealed) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, sealed.key, sealed.data);
}

// Liner keys rebuilt in this iframe, by key record id. Each unlock seals
// with a new IV, so a cached key from an earlier unlock is never reused.
const linerKeys = new Map();

async function legacyDecryptionKey(entry) {
  const sealed = entry.sealedPkcs8;
  if (!sealed) return undefined;
  const tag = toHex(sealed.iv);
  const cached = linerKeys.get(entry.id);
  if (cached && cached.tag === tag) return cached.key;
  const pkcs8 = await unsealPkcs8(sealed);
  const key = await getLinerCrypto().subtle.importKey('pkcs8', pkcs8, { name: 'RSAES-PKCS1-v1_5' }, false, ['decrypt']);
  linerKeys.set(entry.id, { tag, key });
  return key;
}

/** Drop the liner keys this iframe rebuilt (with the session store on lock-all). */
export function forgetLegacyKeys() {
  linerKeys.clear();
}

/** Decrypt keys from the session store, across all key records. */
export async function unlockedDecryptMaps() {
  const keyRecords = await listKeyRecords();
  const unlockedKeys = new Map();
  const legacyUnlockedKeys = new Map();
  for (const r of keyRecords) {
    const s = await getSessionKeys(r.id);
    if (!s) {
      linerKeys.delete(r.id); // locked in another iframe
      continue;
    }
    if (s.decryptionKey) unlockedKeys.set(r.id, s.decryptionKey);
    try {
      const legacy = await legacyDecryptionKey(s);
      if (legacy) legacyUnlockedKeys.set(r.id, legacy);
    } catch { /* liner unavailable; native OAEP may still work */ }
  }
  return { keyRecords, unlockedKeys, legacyUnlockedKeys };
}
