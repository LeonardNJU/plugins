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
 *
 * The native RSA-OAEP key is bound to SHA-256 at import. A message using
 * another OAEP hash gets its own key from the same sealed bytes.
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

// Keys rebuilt in this iframe, by key record id. Each unlock seals with a
// new IV, so a cached key from an earlier unlock is never reused.
const rebuiltKeys = new Map(); // id -> Map(kind -> { tag, key })

async function fromSeal(entry, kind, importKey) {
  const sealed = entry.sealedPkcs8;
  if (!sealed) return undefined;
  const tag = toHex(sealed.iv);
  let keys = rebuiltKeys.get(entry.id);
  if (!keys) rebuiltKeys.set(entry.id, (keys = new Map()));
  const cached = keys.get(kind);
  if (cached && cached.tag === tag) return cached.key;
  const key = await importKey(await unsealPkcs8(sealed));
  keys.set(kind, { tag, key });
  return key;
}

function legacyDecryptionKey(entry) {
  return fromSeal(entry, 'RSAES-PKCS1-v1_5', (pkcs8) => getLinerCrypto().subtle.importKey(
    'pkcs8', pkcs8, { name: 'RSAES-PKCS1-v1_5' }, false, ['decrypt'],
  ));
}

function rsaOaepKey(entry, hash) {
  const native = entry.decryptionKey;
  if (native && native.algorithm.name === 'RSA-OAEP' && native.algorithm.hash.name === hash) return native;
  return fromSeal(entry, `RSA-OAEP ${hash}`, (pkcs8) => crypto.subtle.importKey(
    'pkcs8', pkcs8, { name: 'RSA-OAEP', hash }, false, ['decrypt'],
  ));
}

/** Drop the keys this iframe rebuilt (with the session store on lock-all). */
export function forgetRebuiltKeys() {
  rebuiltKeys.clear();
}

/** Decrypt keys from the session store, across all key records. */
export async function unlockedDecryptMaps() {
  const keyRecords = await listKeyRecords();
  const unlockedKeys = new Map();
  const legacyUnlockedKeys = new Map();
  const entries = new Map();
  for (const r of keyRecords) {
    const s = await getSessionKeys(r.id);
    if (!s) {
      rebuiltKeys.delete(r.id); // locked in another iframe
      continue;
    }
    entries.set(r.id, s);
    if (s.decryptionKey) unlockedKeys.set(r.id, s.decryptionKey);
    try {
      const legacy = await legacyDecryptionKey(s);
      if (legacy) legacyUnlockedKeys.set(r.id, legacy);
    } catch { /* liner unavailable; native OAEP may still work */ }
  }
  const oaepKey = async (id, hash) => {
    const s = entries.get(id);
    return s && s.decryptionKey ? rsaOaepKey(s, hash) : undefined;
  };
  return { keyRecords, unlockedKeys, legacyUnlockedKeys, rsaOaepKey: oaepKey };
}
