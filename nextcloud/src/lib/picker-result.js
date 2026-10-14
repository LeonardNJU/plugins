// What happens after the "From Nextcloud" picker closes. The picker frame
// attaches copies itself (api.composer.attach with the click's composerId);
// share links go into the message at the caret as the link block, where the
// user sees and edits them like any text (one Ctrl+Z takes them out again).

import { errorText } from './errors.js';
import { linkBlock } from './links.js';

export async function applyPickerResult(api, result, composerId) {
  const t = api.i18n.t;
  if (!result || typeof result !== 'object') return { attached: 0, links: 0 };
  if (result.action === 'attach') {
    const attached = Number(result.attached) || 0;
    if (attached) api.toast.success(t('composer.attached', { count: attached }));
    return { attached, links: 0 };
  }
  if (result.action === 'links' && Array.isArray(result.links) && result.links.length) {
    const block = linkBlock(t, result.links, api.i18n.getLocale());
    if (!block.html) return { attached: 0, links: 0 };
    try {
      await api.composer.replaceSelection(composerId, { html: block.html });
    } catch (err) {
      api.toast.error(errorText(t, err));
      return { attached: 0, links: 0 };
    }
    api.toast.success(t('composer.linksInserted', { count: result.links.length }));
    return { attached: 0, links: result.links.length };
  }
  return { attached: 0, links: 0 };
}
