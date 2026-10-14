// The plugin's UI, drawn with the app's UI kit (`@plugin-host/ui`). Kit
// components are the app's own controls, so the plugin looks like part of
// Bulwark in light, dark and custom themes. Don't style your own buttons,
// inputs or panels, and don't hard-code colours: the plugin iframe only has
// CSS for kit components.
//
// Components are built by factories that take React and the api, so the
// unit tests in test/ can hand in a fake api (test-utils/fake-api.mjs).

import { DialogButtons, Field, Input, SidebarEmpty, SidebarRow, Stack, Text } from '@plugin-host/ui';

export const ITEMS_KEY = 'items';

export async function readItems(api) {
  const stored = await api.storage.get(ITEMS_KEY);
  return Array.isArray(stored) ? stored : [];
}

export async function addItem(api, name) {
  const items = await readItems(api);
  const next = [...items, { id: `${Date.now()}-${items.length}`, name }];
  await api.storage.set(ITEMS_KEY, next);
  return next;
}

/** Opens the dialog below; resolves with the name, or null when cancelled. */
export async function askForItem(api) {
  const t = (key) => api.i18n.t(key);
  const name = await api.ui.openDialog({ title: t('dialog.title'), slot: 'plugin-dialog' });
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/**
 * The sidebar-section slot. The host draws the section header (the title
 * from api.ui.setSectionTitle) and folding, like Folders and Tags; the
 * plugin draws only rows: SidebarRow for entries, SidebarEmpty when there
 * are none, and an "add" row with a plus and a muted label.
 */
export function makeSection(React, api) {
  const { createElement: h, useCallback, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ItemsSection() {
    const [items, setItems] = useState(null);
    const refresh = useCallback(async () => setItems(await readItems(api)), []);

    useEffect(() => {
      void refresh();
      // Items added from the command palette are saved by the background
      // iframe; pick them up when the user comes back to the window.
      window.addEventListener('focus', refresh);
      return () => window.removeEventListener('focus', refresh);
    }, [refresh]);

    const add = async () => {
      const name = await askForItem(api);
      if (name) setItems(await addItem(api, name));
    };

    if (items === null) return null;
    return h(React.Fragment, null,
      items.length === 0 ? h(SidebarEmpty, null, t('section.empty')) : null,
      ...items.map((item) => h(SidebarRow, { key: item.id, icon: 'bookmark', label: item.name })),
      h(SidebarRow, { icon: 'plus', label: h(Text, { tone: 'muted', truncate: true }, t('action.add')), onClick: add }));
  };
}

/**
 * The plugin-dialog slot, opened with api.ui.openDialog. The host draws the
 * title, the close button and the footer; the body starts with the fields,
 * and the buttons go to the host's footer through DialogButtons (Cancel
 * first, then the main action). props.onResult(value) closes the dialog.
 */
export function makeDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function AddDialog(props) {
    const [name, setName] = useState('');
    const ready = name.trim().length > 0;
    const close = (value) => props.onResult?.(value);
    return h(Stack, { gap: 4 },
      h(Field, { label: t('dialog.name'), hint: t('dialog.hint') },
        h(Input, {
          value: name,
          autoFocus: true,
          onChange: (e) => setName(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter' && ready) close(name.trim()); },
        })),
      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'add', label: t('dialog.add'), variant: 'primary', disabled: !ready },
        ],
        onClick: (id) => close(id === 'add' ? name.trim() : null),
      }));
  };
}
