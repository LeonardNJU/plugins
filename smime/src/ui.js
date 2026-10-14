// The plugin's own UI, drawn with the app's UI kit:
//   - EmailBanner: signature / encryption status as reader info bars
//   - SettingsSection: key import, unlock/lock, recipient certificates,
//     defaults for new messages
// Sign / Encrypt in the composer are Options menu items (compose-actions.js).
//
// Built from a factory so tests can hand in a fake host and fake key storage;
// src/index.js passes the real ones.

import * as React from 'react';
import {
  Alert, BarButton, Button, EmptyState, Icon, InfoBar, List, ListRow, Badge,
  Row, RowAction, Section, SettingRow, Stack, Switch, Text,
} from '@plugin-host/ui';

const h = React.createElement;
const { useState, useEffect, useCallback, useRef } = React;

export function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}
export function fmtDateTime(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
export function isExpired(iso) {
  try { return new Date(iso).getTime() < Date.now(); } catch { return false; }
}

// Checks behind the signature verdict. Older persisted statuses lack some fields; those are skipped.
export function signatureChecks(status) {
  const checks = [];
  const cert = status.signerCert;
  if (!cert) {
    checks.push({ tone: 'bad', text: status.signatureError || 'Signer certificate not found in the message' });
    return checks;
  }
  if (status.cryptoValid === true) {
    checks.push({ tone: 'ok', text: 'Signature matches the message content — unchanged since signing' });
  } else if (status.cryptoValid === false) {
    checks.push({
      tone: 'bad',
      text: status.verifyError
        ? `Signature could not be verified: ${status.verifyError}`
        : 'Signature does not match the message content — it was changed after signing or the signature is damaged',
    });
  }
  // Older statuses lack certExpired/certNotYetValid; work them out from the dates
  // like verifyStatus does, rather than calling an expired certificate valid.
  const certExpired = status.certExpired ?? isExpired(cert.notAfter);
  const certNotYetValid = status.certNotYetValid ?? new Date(cert.notBefore).getTime() > Date.now();
  if (certExpired) checks.push({ tone: 'bad', text: `Certificate expired on ${fmtDateTime(cert.notAfter)}` });
  else if (certNotYetValid) checks.push({ tone: 'bad', text: `Certificate is not valid before ${fmtDateTime(cert.notBefore)}` });
  else checks.push({ tone: 'ok', text: `Certificate valid until ${fmtDate(cert.notAfter)}` });

  // Without a chain check anyone can mint a certificate for any address, so say
  // what the certificate claims, not who it belongs to.
  if (status.signerEmailMatch === true) {
    checks.push({ tone: 'ok', text: `Certificate is for the sender's address (${cert.email})` });
  } else if (status.signerEmailMatch === false) {
    checks.push({
      tone: 'warn',
      text: `Certificate is for ${cert.email || 'another address'}, but the message is from ${status.fromEmail || 'someone else'}`,
    });
  }

  if (status.selfSigned) {
    checks.push({ tone: 'warn', text: 'Self-signed certificate — not issued by a certificate authority' });
  } else {
    checks.push({ tone: 'info', text: 'Issuer not verified: the certificate chain is not checked against trusted authorities' });
  }
  return checks;
}

export function certificateFields(status) {
  const cert = status.signerCert || {};
  const fields = [
    ['Subject', cert.subject],
    ['E-mail', cert.email],
    ['Issuer', cert.issuer],
    ['Valid', cert.notBefore && cert.notAfter ? `${fmtDateTime(cert.notBefore)} – ${fmtDateTime(cert.notAfter)}` : null],
    ['Algorithm', cert.algorithm],
    ['Serial', cert.serialNumber],
    ['SHA-256', cert.fingerprint],
    ['Format', status.format === 'detached' ? 'Detached (multipart/signed)'
      : status.format === 'opaque' ? 'Opaque (application/pkcs7-mime)' : null],
  ];
  return fields.filter(([, v]) => v);
}

const CHECK_ICON = { ok: 'circle-check', bad: 'circle-x', warn: 'alert-triangle', info: 'info-circle' };
const CHECK_TONE = { ok: 'success', bad: 'danger', warn: 'default', info: 'muted' };

function SignatureDetails({ status }) {
  return h(Stack, { gap: 3 },
    h(Stack, { gap: 1 },
      signatureChecks(status).map((c, i) => h(Row, { key: i, gap: 2, wrap: false, align: 'start' },
        h(Icon, { name: CHECK_ICON[c.tone], size: 'sm' }),
        h(Text, { tone: CHECK_TONE[c.tone] }, c.text),
      )),
    ),
    h(Stack, { gap: 1 },
      certificateFields(status).map(([k, v]) => h(Row, { key: k, gap: 2, wrap: false, align: 'baseline' },
        h(Text, { size: 'xs', tone: 'muted' }, k),
        h(Text, { size: 'xs' }, v),
      )),
    ),
  );
}

const BANNER_TONE = { success: 'success', warning: 'warning', destructive: 'danger', info: 'info' };

/** The info bars for a stored verify status. Exported for tests. */
export function bannerRows(status, { warnSelfSigned = true } = {}) {
  const rows = [];
  if (status.isEncrypted) {
    if (status.decryptionSuccess) rows.push({ icon: 'lock-open', eyebrow: 'Encryption', text: 'Decrypted', tone: 'success' });
    else if (status.decryptionError === 'locked') rows.push({ icon: 'lock', eyebrow: 'Encryption', text: 'Encrypted — unlock your key to read', tone: 'warning', action: 'unlock' });
    else if (status.decryptionError) rows.push({ icon: 'lock', eyebrow: 'Encryption', text: 'Encrypted — couldn’t be decrypted with your keys', tone: 'destructive' });
    else rows.push({ icon: 'lock', eyebrow: 'Encryption', text: 'Encrypted message', tone: 'info' });
  }
  if (status.isSigned || status.signerCert) {
    if (status.signatureValid) {
      const who = status.signerCert && status.signerCert.email ? ` by ${status.signerCert.email}` : '';
      const mismatch = status.signerEmailMatch === false ? ' · signer ≠ From' : '';
      const selfSigned = warnSelfSigned && status.selfSigned;
      const ss = selfSigned ? ' · self-signed' : '';
      // A valid signature only reads as trusted-green when it also chains to a
      // CA and the signer matches the From. A self-signed cert or a signer≠From
      // mismatch downgrades to an amber warning (still "valid", just untrusted).
      const untrusted = status.signerEmailMatch === false || selfSigned;
      rows.push({
        icon: untrusted ? 'shield-exclamation' : 'shield-check',
        eyebrow: 'Signature',
        text: `Valid signature${who}${ss}${mismatch}`,
        tone: untrusted ? 'warning' : 'success',
        details: true,
      });
    } else if (status.signatureError) {
      rows.push({ icon: 'shield-exclamation', eyebrow: 'Signature', text: `Invalid signature: ${status.signatureError}`, tone: 'destructive', details: !!status.signerCert });
    } else {
      rows.push({ icon: 'shield-check', eyebrow: 'Signature', text: 'Signed message', tone: 'info' });
    }
  }
  if (status.unsupportedReason) rows.push({ icon: 'info-circle', eyebrow: 'S/MIME', text: status.unsupportedReason, tone: 'info' });
  return rows;
}

export function makeUi(host, deps) {
  function EmailBanner(props) {
    const email = props && props.email;
    const [status, setStatus] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);

    // "Unlock now" for the locked-encryption bar: unlock any locked key
    // (prompting for the storage passphrase), then ask the host to re-run the
    // render hook so the body decrypts in place — no reload (which would wipe
    // the just-unlocked in-memory keys).
    const unlockNow = useCallback(async () => {
      setBusy(true);
      try {
        const recs = await deps.listKeyRecords();
        const locked = [];
        for (const r of recs) {
          const s = await deps.getSessionKeys(r.id);
          if (!(s && s.decryptionKey)) locked.push(r);
        }
        let unlockedAny = false;
        for (const rec of locked) {
          const s = await deps.ensureKeyUnlocked(rec);
          if (s && s.decryptionKey) unlockedAny = true;
          else break; // cancelled or wrong passphrase — stop prompting
        }
        if (!unlockedAny) return;

        await host.ui.rerenderEmail();
        // The re-decrypt runs in the background instance and rewrites the
        // persisted verify status. Poll for the fresh status (until it's no
        // longer 'locked') and update in place.
        if (email && email.id) {
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            let next = null;
            try { next = await host.storage.get(deps.VERIFY_PREFIX + email.id); } catch { /* ignore */ }
            if (next && next.decryptionError !== 'locked') { setStatus(next); break; }
          }
        }
      } finally {
        setBusy(false);
      }
    }, [email]);

    useEffect(() => {
      let alive = true;
      (async () => {
        if (!email || !email.id) { setLoaded(true); return; }
        let s = await host.storage.get(deps.VERIFY_PREFIX + email.id);
        if (!s) {
          // No render-hook result yet — best-effort detect from headers.
          const ct = email.headers && (email.headers['Content-Type'] || email.headers['content-type']);
          const det = deps.detectSmime(Array.isArray(ct) ? ct[0] : ct, undefined, undefined);
          if (det.type === 'enveloped-data') s = { isEncrypted: true };
          else if (det.type === 'signed-data') s = { isSigned: true };
          else if (det.type === 'detached-sig') s = { isSigned: true };
        }
        if (alive) { setStatus(s || null); setLoaded(true); }
      })();
      return () => { alive = false; };
    }, [email && email.id]);

    if (!loaded || !status) return null;
    const rows = bannerRows(status, { warnSelfSigned: deps.settings().warnOnSelfSigned !== false });
    if (rows.length === 0) return null;

    return h(React.Fragment, null, rows.map((r, i) => h(InfoBar, {
      key: i,
      tone: BANNER_TONE[r.tone] || 'info',
      icon: r.icon,
      eyebrow: r.eyebrow,
      title: r.text,
    },
    (r.details || r.action === 'unlock') && h(Row, { gap: 2 },
      r.details && h(BarButton, {
        icon: detailsOpen ? 'chevron-up' : 'chevron-down',
        active: detailsOpen,
        onClick: () => setDetailsOpen(!detailsOpen),
      }, detailsOpen ? 'Hide certificate details' : 'Show certificate details'),
      r.action === 'unlock' && h(BarButton, { icon: 'lock-open', busy, onClick: unlockNow }, 'Unlock now'),
    ),
    r.details && detailsOpen && h(SignatureDetails, { status }),
    )));
  }

  function SettingsSection() {
    const [keys, setKeys] = useState([]);
    const [certs, setCerts] = useState([]);
    const [prefs, setPrefsState] = useState(deps.DEFAULT_PREFS);
    const [unlocked, setUnlocked] = useState({}); // id -> bool
    const [busy, setBusy] = useState(false);
    const [capable, setCapable] = useState(true);
    const fileRef = useRef(null);
    const certFileRef = useRef(null);

    const refresh = useCallback(async () => {
      if (!(await deps.isCapable())) { setCapable(false); return; }
      const [k, c, p] = await Promise.all([deps.listKeyRecords(), deps.listPublicCerts(), deps.getPrefs()]);
      setKeys(k); setCerts(c); setPrefsState(p);
      const u = {};
      for (const rec of k) u[rec.id] = !!(await deps.getSessionKeys(rec.id));
      setUnlocked(u);
    }, []);

    // Keys changed: reload the list and let the composer's Options menu know.
    const changed = useCallback(async () => {
      await refresh();
      try { await deps.onKeysChanged?.(); } catch { /* the menu catches up on the next composer */ }
    }, [refresh]);

    useEffect(() => { void refresh(); }, [refresh]);

    if (!capable) {
      return h(Alert, { tone: 'danger', icon: 'alert-triangle' },
        h(Text, { weight: 'medium', tone: 'danger' }, 'S/MIME is not active'),
        h(Text, { tone: 'danger' }, deps.NOT_PRIVILEGED_MSG));
    }

    async function importKeyFile() {
      const file = fileRef.current && fileRef.current.files && fileRef.current.files[0];
      if (!file) return;
      const answers = await host.ui.prompt({
        title: 'Import S/MIME key',
        message: `Importing "${file.name}".`,
        confirmLabel: 'Import',
        fields: [
          { name: 'p12pass', label: 'Passphrase protecting the .p12/.pfx file', type: 'password', placeholder: 'Leave blank if the file has none' },
          { name: 'storagePass', label: 'New passphrase to protect this key in your browser', type: 'password', required: true },
        ],
      });
      if (fileRef.current) fileRef.current.value = '';
      if (!answers) return; // cancelled
      const p12pass = answers.p12pass || '';
      const storagePass = answers.storagePass || '';
      if (!storagePass) { host.toast.error('A storage passphrase is required'); return; }
      setBusy(true);
      try {
        const buf = await file.arrayBuffer();
        const { keyRecord } = await deps.importPkcs12(buf, p12pass, storagePass);
        await deps.saveKeyRecord(keyRecord);
        host.toast.success(`Imported S/MIME key for ${keyRecord.email || 'certificate'}`);
        await changed();
      } catch (err) {
        host.toast.error(`Import failed: ${err && err.message ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    }

    async function unlock(rec) {
      const answers = await host.ui.prompt({
        title: `Unlock ${rec.email || 'S/MIME key'}`,
        confirmLabel: 'Unlock',
        fields: [
          { name: 'pass', label: 'Storage passphrase for this key', type: 'password', required: true },
        ],
      });
      if (!answers) return; // cancelled
      const pass = answers.pass || '';
      if (!pass) return;
      setBusy(true);
      try {
        const { signingKey, decryptionKey, legacyDecryptionKey } = await deps.unlockPrivateKey(rec, pass);
        await deps.saveSessionKeys({ id: rec.id, signingKey, decryptionKey, legacyDecryptionKey });
        host.toast.success(`Unlocked ${rec.email || 'key'}`);
        await refresh();
      } catch (err) {
        host.toast.error(err && err.message ? err.message : 'Unlock failed');
      } finally {
        setBusy(false);
      }
    }

    async function lock(rec) {
      await deps.deleteSessionKeys(rec.id);
      host.toast.info(`Locked ${rec.email || 'key'}`);
      await refresh();
    }

    async function removeKey(rec) {
      const ok = await host.ui.confirm({
        title: 'Delete S/MIME key',
        message: `Delete the private key and certificate for ${rec.email || 'this identity'}? You will no longer be able to decrypt mail encrypted to it.`,
        danger: true,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      await deps.deleteSessionKeys(rec.id);
      await deps.deleteKeyRecord(rec.id);
      host.toast.success('Key deleted');
      await changed();
    }

    async function importCertFile() {
      const file = certFileRef.current && certFileRef.current.files && certFileRef.current.files[0];
      if (!file) return;
      setBusy(true);
      try {
        const buf = await file.arrayBuffer();
        const cert = deps.parseCertificatePemOrDer(buf);
        const der = cert.toSchema(true).toBER(false);
        const info = await deps.extractCertificateInfo(cert, der);
        const email = (info.emailAddresses[0] || '').toLowerCase();
        if (!email) throw new Error('Certificate has no email address');
        await deps.savePublicCert({
          id: deps.generateUUID(),
          email,
          certificate: der,
          issuer: info.issuer,
          subject: info.subject,
          notBefore: info.notBefore,
          notAfter: info.notAfter,
          fingerprint: info.fingerprint,
          source: 'manual',
        });
        host.toast.success(`Imported certificate for ${email}`);
        await refresh();
      } catch (err) {
        host.toast.error(`Certificate import failed: ${err && err.message ? err.message : String(err)}`);
      } finally {
        if (certFileRef.current) certFileRef.current.value = '';
        setBusy(false);
      }
    }

    async function removeCert(c) {
      await deps.deletePublicCert(c.id);
      await refresh();
    }

    async function setPref(key, value) {
      const next = { ...prefs, [key]: value };
      setPrefsState(next);
      await deps.setPrefs(next);
      try { await deps.onKeysChanged?.(); } catch { /* ignore */ }
    }

    const capabilities = (rec) => [
      rec.capabilities && rec.capabilities.canSign ? 'sign' : '',
      rec.capabilities && rec.capabilities.canEncrypt ? 'encrypt' : '',
    ].filter(Boolean).join(' · ');

    // The browser's file picker stays hidden; the kit button opens it.
    const picker = (ref, accept, onChange, label) => h('input', {
      ref, type: 'file', accept, onChange, hidden: true, 'aria-label': label,
    });

    return h(Stack, { gap: 6 },
      h(Section, {
        title: 'Your keys',
        description: 'Import a PKCS#12 (.p12/.pfx) file containing your certificate and private key. The key is encrypted in your browser and never leaves it.',
      },
      picker(fileRef, '.p12,.pfx', importKeyFile, 'S/MIME key file'),
      h(Row, null,
        h(Button, { icon: 'upload', busy, onClick: () => fileRef.current && fileRef.current.click() }, 'Import key')),
      keys.length === 0
        ? h(EmptyState, { compact: true, icon: 'key', title: 'No keys imported yet' })
        : h(List, { label: 'Your keys' },
          keys.map((rec) => h(ListRow, {
            key: rec.id,
            icon: h(Icon, { name: unlocked[rec.id] ? 'lock-open' : 'lock' }),
            title: h(Row, { gap: 2, wrap: false },
              h('span', null, rec.email || rec.subject || 'Certificate'),
              isExpired(rec.notAfter) && h(Badge, { tone: 'danger' }, 'Expired'),
              unlocked[rec.id] && h(Badge, { tone: 'success' }, 'Unlocked')),
            subtitle: `${rec.algorithm} · valid ${fmtDate(rec.notBefore)} – ${fmtDate(rec.notAfter)} · ${capabilities(rec)}`,
            actions: h(React.Fragment, null,
              unlocked[rec.id]
                ? h(Button, { size: 'sm', variant: 'secondary', disabled: busy, onClick: () => lock(rec) }, 'Lock')
                : h(Button, { size: 'sm', variant: 'secondary', disabled: busy, onClick: () => unlock(rec) }, 'Unlock'),
              h(RowAction, { icon: 'trash', label: 'Delete key', danger: true, onClick: () => removeKey(rec) })),
          })),
        ),
      ),

      h(Section, {
        title: 'Recipient certificates',
        description: 'Public certificates (PEM/DER) of people you want to send encrypted mail to. Signer certificates from validly signed mail are saved automatically.',
      },
      picker(certFileRef, '.pem,.crt,.cer,.der', importCertFile, 'Certificate file'),
      h(Row, null,
        h(Button, { variant: 'secondary', icon: 'upload', busy, onClick: () => certFileRef.current && certFileRef.current.click() }, 'Import certificate')),
      certs.length === 0
        ? h(EmptyState, { compact: true, icon: 'certificate', title: 'No recipient certificates' })
        : h(List, { label: 'Recipient certificates' },
          certs.map((c) => h(ListRow, {
            key: c.id,
            icon: h(Icon, { name: 'certificate' }),
            title: h(Row, { gap: 2, wrap: false },
              h('span', null, c.email || c.subject),
              isExpired(c.notAfter) && h(Badge, { tone: 'danger' }, 'Expired')),
            subtitle: `${c.source} · expires ${fmtDate(c.notAfter)}`,
            actions: h(RowAction, { icon: 'trash', label: 'Remove certificate', danger: true, onClick: () => removeCert(c) }),
          })),
        ),
      ),

      h(Section, { title: 'Defaults for new messages' },
        h(SettingRow, { label: 'Sign new messages', description: 'Sign is ticked in the composer’s Options menu when a message starts.' },
          h(Switch, { label: 'Sign new messages', checked: !!prefs.defaultSign, onChange: (v) => setPref('defaultSign', v) })),
        h(SettingRow, { label: 'Encrypt new messages', description: 'Only works when every recipient has a certificate.' },
          h(Switch, { label: 'Encrypt new messages', checked: !!prefs.defaultEncrypt, onChange: (v) => setPref('defaultEncrypt', v) })),
      ),
    );
  }

  return { EmailBanner, SettingsSection };
}
