// Glue between the api and the pure modules: the user's choices, the
// privacy notice before the first request, and running one task.

import { hostOf, resolveEndpoint, userKeysAllowed } from './config.js';
import { buildPrompt } from './prompts.js';
import { streamCompletion } from './client.js';
import { AiError } from './errors.js';

const PREFS_KEY = 'prefs';

export const PROVIDER_LABELS = { openai: 'OpenAI-compatible', anthropic: 'Anthropic' };

export async function loadPrefs(api) {
  try {
    const value = await api.storage.get(PREFS_KEY);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export async function savePrefs(api, patch) {
  const next = { ...(await loadPrefs(api)), ...patch };
  await api.storage.set(PREFS_KEY, next);
  return next;
}

/** The admin config without secrets; {} when it can't be read. */
export async function loadConfig(api) {
  try {
    const config = await api.admin.getAllConfig();
    return config && typeof config === 'object' ? config : {};
  } catch {
    return {};
  }
}

/** Everything needed to decide where requests go. */
export async function loadSetup(api) {
  const [config, prefs] = await Promise.all([loadConfig(api), loadPrefs(api)]);
  let accounts = [];
  if (userKeysAllowed(config)) {
    try {
      accounts = (await api.proxy.accounts()) ?? [];
    } catch {
      accounts = [];
    }
  }
  return { config, prefs, accounts, endpoint: resolveEndpoint({ config, prefs, accounts }) };
}

export function consentKey(endpoint) {
  return `consent:${endpoint.provider}:${endpoint.origin}`;
}

/** The privacy notice: which service, which server, which model. */
export function privacyMessage(t, endpoint) {
  return t(endpoint.own ? 'privacy.message_own' : 'privacy.message', {
    provider: PROVIDER_LABELS[endpoint.provider],
    host: hostOf(endpoint.baseUrl),
    model: endpoint.model,
  });
}

/** Ask with the host's confirm dialog (not usable from inside a plugin dialog). */
export function confirmWithHost(api) {
  return (endpoint) => api.ui.confirm({
    title: api.i18n.t('privacy.title'),
    message: privacyMessage(api.i18n.t, endpoint),
    confirmLabel: api.i18n.t('privacy.continue'),
    cancelLabel: api.i18n.t('common.cancel'),
  });
}

/**
 * Before the first request to a service, say which one it is and where the
 * text goes, and ask. Remembered per service and server. `ask(endpoint)`
 * resolves to true to go ahead.
 */
export async function ensureConsent(api, endpoint, ask = confirmWithHost(api)) {
  const key = consentKey(endpoint);
  if (await api.storage.get(key)) return true;
  const ok = (await ask(endpoint)) === true;
  if (ok) await api.storage.set(key, true);
  return ok;
}

/**
 * Run one task after a user action. Resolves to the answer; streams it to
 * onText. Rejects with AiError (not_configured, declined, cancelled, ...).
 */
export async function runTask(api, task, input, { onText, signal, setup, askConsent, timeouts = {} } = {}) {
  const { endpoint } = setup ?? await loadSetup(api);
  if (!endpoint) throw new AiError('not_configured');
  if (!(await ensureConsent(api, endpoint, askConsent))) throw new AiError('declined');
  if (signal?.aborted) throw new AiError('cancelled');
  const prompt = buildPrompt(task, { language: api.i18n.getLocale?.() ?? 'en', ...input });
  return streamCompletion(api, endpoint, prompt, { onText, signal, ...timeouts });
}
