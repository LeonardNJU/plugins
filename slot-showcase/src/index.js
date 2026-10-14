// Slot showcase: fills every plugin surface of the webmail with something you
// can see, for the docs screenshots and for checking a layout by hand.
//
// - Every frame slot renders a labelled box that names the slot and the props
//   it received (names only, and the length of any list).
// - Every action surface gets one or two buttons; a click shows a toast with
//   the surface and the context keys the host passed.
// - Day labels on today and a few days after, and one page of its own.
//
// The lists below follow lib/plugin-slot-catalog.ts in the webmail.

import { createElement as h } from 'react';

const api = require('@plugin-host');

// Frame slots. `inline` ones sit in a row of host buttons, so they get a
// small chip instead of a box.
const FRAME_SLOTS = {
  'app-top-banner': {},
  'plugin-dialog': {},
  'navigation-rail-bottom': { compact: true },
  'sidebar-widget': {},
  'sidebar-section': {},
  'app-page': { page: true },
  'message-list-header': {},
  'message-list-empty': {},
  'context-menu-email': {},
  'toolbar-actions': { inline: true },
  'reader-header': {},
  'reader-below-subject': {},
  'email-banner': {},
  'reader-above-quote': {},
  'email-footer': {},
  'thread-summary': {},
  'email-detail-sidebar': {},
  'email-details-section': {},
  'attachment-actions': { inline: true },
  'composer-toolbar': { inline: true },
  'composer-above-body': {},
  'composer-below-body': {},
  'composer-sidebar': {},
  'composer-sidebar-right': {},
  'composer-attachment-source': { inline: true },
  'calendar-event-actions': { inline: true },
  'calendar-event-detail': {},
  'calendar-event-form': {},
  'contact-cryptokeys': {},
  'contact-detail-section': {},
  'task-detail-section': {},
  'file-preview-section': {},
  'settings-section': {},
  'settings-page': {},
  'admin-plugin-page': {},
};

// Action surfaces and the buttons the showcase puts on each.
const ACTIONS = {
  'command-palette': [
    { id: 'open-dialog', label: 'Slot showcase: open the dialog', icon: 'layout-grid' },
    { id: 'notify', label: 'Slot showcase: send a notification', icon: 'bell' },
  ],
  'top-bar-actions': [{ id: 'top', label: 'Showcase', icon: 'flask-2' }],
  'message-row-actions': [{ id: 'row', label: 'Showcase row action', icon: 'flask-2' }],
  'message-bulk-actions': [
    { id: 'bulk', label: 'Showcase', icon: 'flask-2' },
    { id: 'bulk-danger', label: 'Showcase (danger)', icon: 'bug', danger: true },
  ],
  'reader-actions': [{ id: 'reader', label: 'Showcase', icon: 'flask-2' }],
  'attachment-menu': [{ id: 'attachment', label: 'Showcase attachment action', icon: 'flask-2' }],
  'composer-send-menu': [{ id: 'send', label: 'Showcase send option', icon: 'flask-2' }],
  'composer-attach-menu': [{ id: 'attach', label: 'Showcase attach source', icon: 'flask-2' }],
  'contact-list-actions': [{ id: 'contacts', label: 'Showcase', icon: 'flask-2' }],
  'task-list-actions': [{ id: 'tasks', label: 'Showcase', icon: 'flask-2' }],
  'file-actions': [{ id: 'files', label: 'Showcase file action', icon: 'flask-2' }],
};

/** "email", "emailIds[3]", "onResult()" */
function describeProps(props) {
  return Object.keys(props || {}).sort().map((key) => {
    const value = props[key];
    if (Array.isArray(value)) return `${key}[${value.length}]`;
    if (typeof value === 'function') return `${key}()`;
    return key;
  });
}

const BOX = {
  boxSizing: 'border-box',
  border: '1px dashed var(--color-primary)',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--color-primary) 8%, var(--color-background))',
  color: 'var(--color-foreground)',
  padding: '6px 10px',
  fontSize: 12,
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
};

function SlotBox({ name, spec, props }) {
  const keys = describeProps(props);
  if (spec.inline) {
    return h('span', {
      style: { ...BOX, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', whiteSpace: 'nowrap' },
      title: keys.length ? `props: ${keys.join(', ')}` : 'no props',
    },
    h('strong', null, `slot: ${name}`),
    keys.length ? h('span', { style: { color: 'var(--color-muted-foreground)' } }, keys.join(', ')) : null);
  }
  if (spec.compact) {
    return h('div', { style: { ...BOX, padding: 4, fontSize: 10, textAlign: 'center' }, title: `slot: ${name}` }, 'slot: rail');
  }
  // Padding, not margin: the host measures this element, and an outer margin
  // would not count towards the slot's height.
  const box = h('div', { style: { ...BOX, ...(spec.page ? { padding: 16, fontSize: 14 } : {}) } },
    h('div', { style: { fontWeight: 600 } }, `slot: ${name}`),
    h('div', { style: { color: 'var(--color-muted-foreground)' } },
      keys.length ? `props: ${keys.join(', ')}` : 'no props'),
    name === 'plugin-dialog' && typeof props.onResult === 'function'
      ? h('button', {
          type: 'button',
          onClick: () => props.onResult('closed by the showcase'),
          style: {
            marginTop: 8, font: 'inherit', padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-foreground)',
          },
        }, 'Close with onResult')
      : null);
  return spec.page ? h('div', { style: { padding: 16 } }, box) : box;
}

const slots = {};
for (const [name, spec] of Object.entries(FRAME_SLOTS)) {
  slots[name] = { component: (props) => h(SlotBox, { name, spec, props }) };
}
// The details panel asks once per category; show the box once, at the bottom.
slots['email-details-section'].shouldShow = (ctx) => ctx?.category == null;

function isoDay(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function activate() {
  for (const [surface, actions] of Object.entries(ACTIONS)) {
    try {
      await api.ui.setActions(surface, actions);
    } catch (err) {
      api.log.warn(`setActions(${surface}) failed: ${err.message}`);
    }
  }
  await api.ui.setDayLabels([
    { date: isoDay(0), text: 'Showcase today', title: 'Day label from the slot showcase', dot: true },
    { date: isoDay(1), text: 'Label + dot', dot: true },
    { date: isoDay(3), text: 'Label only' },
    { date: isoDay(5), dot: true, title: 'Dot only' },
  ]);
  await api.ui.setPages([{ id: 'showcase', title: 'Showcase', icon: 'layout-grid' }]);
}

export const hooks = {
  async onAction({ surface, actionId, context }) {
    if (actionId === 'open-dialog') {
      const result = await api.ui.openDialog({ title: 'Slot showcase', slot: 'plugin-dialog', extraProps: { opened: 'from the command palette' } });
      api.toast.info(`plugin-dialog resolved: ${JSON.stringify(result)}`);
      return;
    }
    if (actionId === 'notify') {
      await api.notifications.show({ title: 'Slot showcase', body: 'A notification from api.notifications.show', tag: 'showcase' });
      return;
    }
    const keys = describeProps(context);
    api.toast.info(`${surface} (${actionId}): ${keys.length ? keys.join(', ') : 'no context'}`);
  },
  onNotificationClick({ tag }) {
    api.toast.info(`Notification clicked: ${tag}`);
  },
};

export { slots };
