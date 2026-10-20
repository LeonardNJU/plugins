# S/MIME plugin

End-to-end S/MIME (CMS / PKCS#7) for Bulwark Webmail, implemented as a
**privileged** (same-origin) plugin. All cryptography runs locally in the
browser using a bundled `pkijs` / `asn1js` / `webcrypto-liner` stack, with no key
material ever leaves the device.

## What it does

| Capability | How |
|---|---|
| **Sign** outgoing mail | `onComposeSend` builds the MIME and signs it with CMS `SignedData`, then submits via `api.jmap.sendRaw`. The *Signature format* setting picks detached (`multipart/signed`, readable without S/MIME; the default) or opaque (`application/pkcs7-mime`). |
| **Encrypt** outgoing mail | `onComposeSend` builds CMS `EnvelopedData` to every recipient (AES-256-GCM by default; AES-128 optional) plus the sender, then submits raw. Sign + Encrypt does proper sign-then-encrypt. |
| **Verify** incoming signatures | `onRenderEmailBody` fetches the CMS blob (`api.jmap.fetchBlob`) — for detached `multipart/signed` mail the raw message, so the signed part is checked byte-for-byte — validates the signature cryptographically, checks validity dates, flags self-signed signers and signer≠From mismatches, and renders the inner body. |
| **Decrypt** incoming mail | `onRenderEmailBody` decrypts with your unlocked key: `EnvelopedData` with AES-CBC (128/192/256), 3DES or DES, and `AuthEnvelopedData` with AES-GCM (128/256) or ChaCha20-Poly1305. That covers Thunderbird, Outlook and all four modes of Stalwart's encryption at rest. The content key can be wrapped with RSAES-PKCS1-v1_5 or RSA-OAEP (SHA-256 in `EnvelopedData`; SHA-1, SHA-256, SHA-384 or SHA-512 in `AuthEnvelopedData`). Mail in anything else, such as RC2, gets a banner that names the algorithm. |
| **Key management** | `settings-section` slot: import PKCS#12 (`.p12`/`.pfx`), unlock/lock, delete, import recipient certificates, set sign/encrypt defaults. |
| **Status** | `email-banner` slot shows signature / encryption state as reader info bars; Sign and Encrypt are check items in the composer's Options menu, per message, starting from the defaults in Settings. |

## Security model

- **Privileged tier.** Declares `tier: "privileged"` + `crypto:full`. Per
  `resolvePluginTier`, the same-origin tier is only granted to a **signed,
  admin-approved (managed)** bundle after high-risk consent. A self-uploaded
  copy is refused rather than downgraded; sign and ship it through the admin channel.
- **Keys at rest.** Private keys are imported from PKCS#12 and re-wrapped with
  AES-256-GCM under a PBKDF2(SHA-256, 600 000) key derived from a passphrase
  you choose. Stored in IndexedDB; the raw key bytes are never persisted.
- **Keys in use.** Unlocking imports the key as a **non-extractable**
  `CryptoKey`. Because the background (hooks) iframe and the visible slot
  iframes are same-origin, the unlocked handle is shared through a session
  IndexedDB store. It stays non-extractable and is **wiped on app boot and on
  logout / account switch** (configurable), mirroring the former native
  "in-memory, cleared on reload" behaviour.
- **RSA PKCS#1 v1.5.** WebCrypto can't decrypt RSAES-PKCS1-v1_5, so that runs
  in JavaScript (webcrypto-liner) and needs the key bytes. For RSA keys the
  session entry also holds the PKCS#8 key, encrypted with a fresh
  non-extractable AES-GCM key made at unlock. The decrypt path rebuilds the
  liner key from it and keeps it in memory until the iframe goes away. Code
  running in the plugin's origin can recover the key while it is unlocked;
  it is wiped with the rest of the session entry.
- Returned HTML still passes through the host sanitizer.

## Build

```bash
cd repos/plugins/smime
npm install          # pulls pkijs / asn1js / pvtsutils / webcrypto-liner / @noble/ciphers + esbuild
npm run build        # → dist/index.js  (~1.7 MB, under the privileged cap)
npm run package      # → smime.zip (manifest.json + index.js) for admin upload
```

The build aliases the Node `crypto` builtin (referenced by a dead
`typeof process` branch in `asmcrypto.js`) to a browser shim so the bundle is
self-contained.

## Layout

```
src/
  index.js            entry: activate + hooks + slots (React.createElement UI)
  crypto-engine.js    pkijs CryptoEngine w/ 3DES + legacy PKCS#12 PBE
  certificate-utils.js X.509 parse + metadata + capability classification
  mime-builder.js     deterministic CRLF MIME builder + CMS RFC822 wrapper
  mime-parse.js       inner-MIME parser for decrypted/verified content
  smime-detect.js     detect CMS from Content-Type / bodyStructure / attachments
  smime-sign.js       CMS SignedData (opaque or detached)
  smime-encrypt.js    CMS EnvelopedData
  smime-decrypt.js    CMS decrypt + blob normalisation + recipient matching
  auth-enveloped.js   AuthEnvelopedData: parse, key unwrap, AES-GCM / ChaCha20-Poly1305
  smime-verify.js     CMS signature verification + signer status
  pkcs12.js           PKCS#12 import + key wrap/unlock
  key-storage.js      IndexedDB: key records, recipient certs, session keys
  util.js             uuid / hex / equality helpers
  node-crypto-shim.js browser shim for the Node "crypto" builtin
```

The crypto modules are faithful ports of the host's `lib/smime/*` (the former
native pipeline), so the plugin produces byte-compatible CMS.

## Note on host wiring

The `onComposeSend` and `onRenderEmailBody` hook buses and the privileged
`api.jmap` surface exist in the host (see `lib/plugin-hooks.ts`,
`lib/plugin-sandbox/host-api.ts`). The send/render **takeover** fires once the
host emits those buses from the composer and viewer (the migration that retires
the inline native path). The `settings-section` and `email-banner` slots
and the Options menu entries are active today.
