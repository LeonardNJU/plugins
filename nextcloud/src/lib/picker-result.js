// What happens after the "From Nextcloud" picker closes. The picker frame
// attaches copies itself (api.composer.attach with the click's composerId);
// share links wait in storage until the message is sent.

import { addPending } from './links.js';

export async function applyPickerResult(api, result) {
  const t = api.i18n.t;
  if (!result || typeof result !== 'object') return { attached: 0, links: 0 };
  if (result.action === 'attach') {
    const attached = Number(result.attached) || 0;
    if (attached) api.toast.success(t('composer.attached', { count: attached }));
    return { attached, links: 0 };
  }
  if (result.action === 'links' && Array.isArray(result.links) && result.links.length) {
    await addPending(api.storage, result.links);
    api.toast.success(t('composer.linksAdded', { count: result.links.length }));
    return { attached: 0, links: result.links.length };
  }
  return { attached: 0, links: 0 };
}
