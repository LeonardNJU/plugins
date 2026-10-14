// The banner across the top of the app: the kit's one-line info bar in the
// warning tone, with the return button as a bar button. Colours come from
// the app's theme, like every other info bar.

import * as React from 'react';
import { BarButton, InfoBar } from '@plugin-host/ui';

const h = React.createElement;

export function ImpersonationBar({ mailbox, actorRoleLabel, returnLabel, showReturn, busy, onReturn }) {
  return h('div', { role: 'status', 'aria-live': 'polite' },
    h(InfoBar, {
      compact: true,
      tone: 'warning',
      icon: 'spy',
      title: h(React.Fragment, null, 'You are viewing ', h('strong', null, mailbox), ` ${actorRoleLabel}`),
    },
    showReturn ? h(BarButton, { icon: 'arrow-left', busy, onClick: onReturn }, returnLabel) : null));
}
