// "Add Jitsi meeting" under the event form's meeting link field: the kit's
// outline button, with its spinner while the link is made. Built from a
// factory so tests can hand in React and a fake api.

import { Button } from '@plugin-host/ui';

export function makeJitsiButton(React, api) {
  const { createElement: h, useState } = React;

  return function JitsiAddButton(props) {
    const [busy, setBusy] = useState(false);
    const eventTitle = props?.eventData?.title || 'meeting';
    const setVirtualLocation = props?.setVirtualLocation;

    async function handleClick() {
      if (busy) return;
      setBusy(true);
      try {
        // api.http.post resolves to { ok, status, data }: the parsed body is in `data`.
        const response = await api.http.post('/api/jitsi', { eventTitle });
        if (!response || !response.ok) {
          throw new Error(response?.data?.error || `HTTP ${response?.status ?? 'error'}`);
        }
        const url = response.data?.url;
        if (!url) throw new Error('No url in response');

        if (typeof setVirtualLocation === 'function') {
          // An RPC stub: await it so a host-side error surfaces here.
          await setVirtualLocation(url);
          api.toast.success('Jitsi meeting added to event');
        } else {
          // No host setter: show the URL so the user can still copy it.
          await api.ui.alert({ title: 'Jitsi meeting created', message: url });
        }
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        api.toast.error(`Could not create Jitsi meeting: ${message}`);
      } finally {
        setBusy(false);
      }
    }

    return h(Button, { variant: 'secondary', size: 'sm', icon: 'video', busy, onClick: handleClick }, 'Add Jitsi meeting');
  };
}
