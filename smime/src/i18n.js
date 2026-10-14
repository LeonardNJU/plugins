// Translation helpers. Every visible string lives in the manifest's locales
// and is looked up with api.i18n.t; this file only adds what the crypto code
// can't do itself.

/** `t(key, vars)` bound to a host api. */
export function translator(host) {
  return (key, vars) => host.i18n.t(key, vars);
}

/** The user's locale, for dates. undefined lets the browser pick. */
export function localeOf(host) {
  try { return (host.i18n.getLocale && host.i18n.getLocale()) || undefined; } catch { return undefined; }
}

// The crypto modules throw (and the render hook stores) plain English
// messages. The ones a user can run into get a translation here; anything
// else is a technical detail and is shown as it is.
const KNOWN_ERRORS = {
  'Incorrect passphrase': 'error.wrongPassphrase',
  'No certificate found in PKCS#12 file': 'error.p12NoCertificate',
  'No private key found in PKCS#12 file': 'error.p12NoKey',
  'Invalid PKCS#12 file: ASN.1 parsing failed': 'error.p12Invalid',
  'Signer certificate not found in CMS structure': 'error.noSignerCertificate',
  'Signature does not match the message content': 'error.signatureMismatch',
  'Signer certificate has expired': 'error.signerExpired',
  'Signer certificate is not yet valid': 'error.signerNotYetValid',
  'Malformed multipart/signed message': 'error.malformedSigned',
};

/** A thrown or stored error message in the user's language where we know it. */
export function errorText(t, message) {
  const text = String(message ?? '');
  if (KNOWN_ERRORS[text]) return t(KNOWN_ERRORS[text]);
  const unsupported = text.match(/^Unsupported S\/MIME type \((.*)\)$/);
  if (unsupported) return t('banner.unsupported', { type: unsupported[1] });
  return text;
}

/** err.message of anything thrown, translated where known. */
export function errorMessage(t, err) {
  return errorText(t, err && err.message ? err.message : String(err));
}
