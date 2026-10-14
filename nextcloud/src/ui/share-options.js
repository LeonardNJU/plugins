// The share options form (password and expiry), used by the picker, the
// large-file offer and the Files page's share dialog.

import { createElement as h, useEffect, useRef } from 'react';
import { Checkbox, Field, Input, Stack } from '@plugin-host/ui';
import { dateInDays } from '../lib/format.js';

export function ShareOptions({ api, client, value, onChange }) {
  const t = api.i18n.t;
  const set = (patch) => onChange({ ...value, ...patch });
  const latest = useRef(value);
  latest.current = value;
  // A password that fits the server's rules, made when the box is ticked.
  useEffect(() => {
    if (!value.usePassword || value.password) return undefined;
    let live = true;
    client.generatePassword().then((password) => {
      if (live && latest.current.usePassword && !latest.current.password) onChange({ ...latest.current, password });
    });
    return () => { live = false; };
  }, [value.usePassword]);
  return h(Stack, { gap: 4 },
    h(Checkbox, { checked: value.usePassword, onChange: (on) => set({ usePassword: on }), label: t('share.usePassword') }),
    value.usePassword ? h(Field, { label: t('share.password') },
      h(Input, { type: 'text', autoComplete: 'off', spellCheck: false, value: value.password, onChange: (e) => set({ password: e.target.value }) })) : null,
    value.usePassword ? h(Checkbox, {
      checked: value.includePassword, onChange: (on) => set({ includePassword: on }),
      label: t('share.includePassword'), hint: value.includePassword ? undefined : t('share.sendSeparately'),
    }) : null,
    h(Field, { label: t('share.expiry'), hint: value.expireDate ? t('share.expiryHint') : t('share.noExpiry') },
      h(Input, { type: 'date', value: value.expireDate, min: dateInDays(1), onChange: (e) => set({ expireDate: e.target.value }) })),
  );
}

/** Starting share options from the user's settings. */
export function defaultShareOptions(settings) {
  return {
    usePassword: settings?.passwordProtect === true,
    password: '',
    includePassword: false,
    expireDate: dateInDays(Number(settings?.expiryDays ?? 14)),
  };
}
