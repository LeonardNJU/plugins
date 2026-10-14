// The reader info bar for an external sender or failed authentication. It
// stacks with the app's own bars (external content, invitations) and looks
// like them: the kit's InfoBar in the warning tone.

import * as React from 'react';
import { InfoBar } from '@plugin-host/ui';

function formatSender(s) {
  if (!s) return '';
  if (s.name && s.email) return `${s.name} <${s.email}>`;
  return s.email || s.name || '';
}

/** "External sender · SPF, DKIM failed" */
export function warningLabel(externals, fails) {
  const parts = [];
  if (externals.length > 0) parts.push(externals.length === 1 ? 'External sender' : 'External senders');
  if (fails.length > 0) parts.push(`${fails.join(', ')} failed`);
  return parts.join(' · ');
}

export function SenderWarning({ externals, fails }) {
  if (externals.length === 0 && fails.length === 0) return null;
  const from = externals.map(formatSender).join(', ');
  return React.createElement(InfoBar, {
    tone: 'warning',
    icon: 'alert-triangle',
    eyebrow: warningLabel(externals, fails),
    title: from || undefined,
  });
}
