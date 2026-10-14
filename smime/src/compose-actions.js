// The per-message Sign / Encrypt switches, as check items in the composer's
// Options menu (api.ui.setActions('composer-options-menu')). The host draws
// them like its own "Plain text" and "Read receipt" items; a click comes back
// as onAction and flips the stored intent, which onComposeSend reads.
//
// The intent is stored once for the plugin (INTENT_KEY), not per composer:
// the send hook gets no composer id to look it up by. A new composer starts
// from the defaults in Settings again (resetComposeIntent).

export const OPTIONS_SURFACE = 'composer-options-menu';
export const INTENT_KEY = 'composeIntent.v1';

const NO_KEY = 'Import your S/MIME key under Settings → Plugins → S/MIME first.';

/** The Options menu entries for an intent. `ready` is false without a key. */
export function composeActions({ intent, ready, detached }) {
  if (!ready) {
    return [
      { id: 'sign', label: 'Sign (S/MIME)', icon: 'signature', checked: false, description: NO_KEY, order: 70 },
      { id: 'encrypt', label: 'Encrypt (S/MIME)', icon: 'lock', checked: false, description: NO_KEY, order: 71 },
    ];
  }
  const signHow = intent.encrypt
    ? 'Signature goes inside the encryption.'
    : detached
      ? 'Detached: readable in mail apps without S/MIME.'
      : 'Opaque: only S/MIME mail apps show the text.';
  return [
    { id: 'sign', label: 'Sign (S/MIME)', icon: 'signature', checked: !!intent.sign, description: signHow, order: 70 },
    {
      id: 'encrypt',
      label: 'Encrypt (S/MIME)',
      icon: 'lock',
      checked: !!intent.encrypt,
      description: 'Needs a certificate for every recipient.',
      order: 71,
    },
  ];
}

/**
 * Reads the stored intent (or the defaults) and whether a key exists, and
 * publishes the entries. `deps`: getPrefs, listKeyRecords, detached().
 */
export async function publishComposeActions(host, deps) {
  const stored = (await host.storage.get(INTENT_KEY)) || {};
  const prefs = await deps.getPrefs();
  const intent = {
    sign: typeof stored.sign === 'boolean' ? stored.sign : !!prefs.defaultSign,
    encrypt: typeof stored.encrypt === 'boolean' ? stored.encrypt : !!prefs.defaultEncrypt,
  };
  let ready = false;
  try { ready = (await deps.listKeyRecords()).length > 0; } catch { ready = false; }
  await host.ui.setActions(OPTIONS_SURFACE, composeActions({ intent, ready, detached: deps.detached() }));
  return { intent, ready };
}

/** A new message starts from the defaults in Settings. */
export async function resetComposeIntent(host, deps) {
  await host.storage.remove(INTENT_KEY);
  return publishComposeActions(host, deps);
}

/** onAction for the Options entries. Returns true when it handled the click. */
export async function handleComposeAction(host, deps, { surface, actionId }) {
  if (surface !== OPTIONS_SURFACE || (actionId !== 'sign' && actionId !== 'encrypt')) return false;
  const { intent, ready } = await publishComposeActions(host, deps);
  if (!ready) {
    host.toast.info(NO_KEY);
    return true;
  }
  const next = { ...intent, [actionId]: !intent[actionId] };
  await host.storage.set(INTENT_KEY, next);
  await publishComposeActions(host, deps);
  return true;
}
