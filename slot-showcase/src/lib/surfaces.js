// What the showcase draws in each frame slot: the kit component an author
// would use there, so the docs screenshots show the real look. Every surface
// names its slot and the props it received (names only, and the length of
// any list).
//
// The list follows lib/plugin-slot-catalog.ts in the webmail.

import * as React from 'react';
import {
  Alert, Badge, BarButton, Button, Card, Checkbox, Chip, DialogButtons, EmptyState, Field, Heading, Icon,
  InfoBar, Input, List, ListRow, Page, PageHeader, Row, RowAction, Section, Select, SettingRow, SidebarEmpty,
  SidebarRow, Stack, Switch, Text, Textarea, Toolbar, ToolbarButton, ToolbarSpacer, SearchInput, Breadcrumbs,
} from '@plugin-host/ui';

const h = React.createElement;
const { useState } = React;

/** "email", "emailIds[3]", "onResult()" */
export function describeProps(props) {
  return Object.keys(props || {}).sort()
    .filter((key) => key !== 'setDialogButtons' && key !== 'dialogButtonClick')
    .map((key) => {
      const value = props[key];
      if (Array.isArray(value)) return `${key}[${value.length}]`;
      if (typeof value === 'function') return `${key}()`;
      return key;
    });
}

const propsLine = (props) => {
  const keys = describeProps(props);
  return keys.length ? `props: ${keys.join(', ')}` : 'no props';
};

const ICON = 'flask-2';

// ─── Shapes, by kind of place ─────────────────────────────────

/** Reader and list bars: the info bar the app uses above a message. */
function Bar({ name, props, compact = true, tone = 'primary' }) {
  return h(InfoBar, { compact, tone, icon: ICON, eyebrow: `slot: ${name}`, title: propsLine(props) },
    compact ? null : h(Row, { gap: 2 },
      h(BarButton, { icon: 'check' }, 'Bar button'),
      h(BarButton, { icon: 'x', active: true }, 'Active')));
}

/** A button in a row of host buttons. */
function Inline({ name, props, variant = 'ghost' }) {
  return h(Button, { variant, size: 'sm', icon: ICON, title: propsLine(props) }, `slot: ${name}`);
}

/** A section in a details pane (event, contact, task, file, message details). */
function DetailSection({ name, props }) {
  return h(Stack, { gap: 2 },
    h(Row, { gap: 2 }, h(Heading, { level: 4 }, `slot: ${name}`), h(Badge, { tone: 'primary' }, 'Showcase')),
    h(Text, { size: 'xs', tone: 'muted' }, propsLine(props)),
    h(Row, { gap: 2 }, h(Chip, { icon: 'file-text', label: 'chip.pdf', detail: '12 KB' }), h(Chip, { icon: 'link', label: 'Chip' })));
}

/** A side panel (message, composer): heading, a field, a list. */
function Panel({ name, props }) {
  const [text, setText] = useState('');
  return h(Page, null, h(Stack, { gap: 4 },
    h(Stack, { gap: 1 }, h(Heading, { level: 3 }, `slot: ${name}`), h(Text, { size: 'xs', tone: 'muted' }, propsLine(props))),
    h(Field, { label: 'Field', hint: 'A hint under the field' },
      h(Textarea, { rows: 3, value: text, placeholder: 'Textarea', onChange: (e) => setText(e.target.value) })),
    h(Alert, { tone: 'info', icon: 'info-circle' }, 'An info alert'),
    h(Row, { gap: 2 }, h(Button, { size: 'sm' }, 'Primary'), h(Button, { size: 'sm', variant: 'secondary' }, 'Secondary'))));
}

// ─── One component per frame slot ─────────────────────────────

function Dialog({ props }) {
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(true);
  const [choice, setChoice] = useState('one');
  const close = (value) => props.onResult?.(value);
  return h(Stack, { gap: 4 },
    h(Text, { tone: 'muted' }, `slot: plugin-dialog · ${propsLine(props)}`),
    h(Field, { label: 'Name', hint: 'A text field in a dialog' },
      h(Input, { value: name, placeholder: 'Type something', onChange: (e) => setName(e.target.value) })),
    h(Field, { label: 'Choice' },
      h(Select, { block: true, value: choice, onChange: setChoice, options: [{ value: 'one', label: 'Option one' }, { value: 'two', label: 'Option two' }] })),
    h(Checkbox, { checked: agree, onChange: setAgree, label: 'A checkbox', hint: 'With a hint below' }),
    h(Alert, { tone: 'warning', icon: 'alert-triangle' }, 'A warning alert'),
    h(DialogButtons, {
      buttons: [
        { id: 'cancel', label: 'Cancel', variant: 'secondary' },
        { id: 'ok', label: 'Close with onResult', variant: 'primary', disabled: !agree },
      ],
      onClick: (id) => close(id === 'ok' ? 'closed by the showcase' : null),
    }));
}

function SidebarSection({ props }) {
  return h(React.Fragment, null,
    h(SidebarRow, { icon: ICON, label: 'slot: sidebar-section', detail: '3', title: propsLine(props) }),
    h(SidebarRow, { icon: 'bookmark', label: propsLine(props) }),
    h(SidebarEmpty, null, 'SidebarEmpty line'),
    h(SidebarRow, { icon: 'plus', label: h(Text, { tone: 'muted', truncate: true }, 'Add row'), onClick: () => {} }));
}

function SidebarWidget({ props }) {
  return h(SidebarRow, { icon: ICON, label: 'slot: sidebar-widget', detail: '1', title: propsLine(props) });
}

function Rail() {
  return h(Row, { justify: 'center' }, h(Badge, { tone: 'primary' }, 'rail'));
}

function AppPage({ props }) {
  const [query, setQuery] = useState('');
  const [on, setOn] = useState(true);
  return h(Page, { flush: true },
    h(Toolbar, null,
      h(Breadcrumbs, { items: [{ id: 'root', label: 'Showcase' }, { id: 'page', label: 'slot: app-page' }], onSelect: () => {} }),
      h(ToolbarSpacer),
      h(SearchInput, { value: query, onChange: setQuery, placeholder: 'Search' }),
      h(ToolbarButton, { icon: 'plus', label: 'New' }),
      h(ToolbarButton, { icon: 'refresh', label: 'Refresh', compact: true })),
    h(List, { label: 'Showcase list', columns: [{ label: 'Name' }, { label: 'Size', align: 'end' }, { label: 'Modified', align: 'end', hideNarrow: true }] },
      h(ListRow, { folder: true, title: 'A folder', meta: ['—', 'Today'] }),
      h(ListRow, { icon: 'report.pdf', title: 'report.pdf', meta: ['1.2 MB', 'Yesterday'], selected: true, actions: h(RowAction, { icon: 'download', label: 'Download' }) }),
      h(ListRow, { icon: 'notes.txt', title: 'notes.txt', subtitle: propsLine(props), meta: ['4 KB', 'Oct 1'] })),
    h(Page, null,
      h(PageHeader, { icon: ICON, title: 'slot: app-page', description: 'Page + PageHeader for a document-like page', actions: h(Button, { icon: 'plus' }, 'Action') }),
      h(Card, { title: 'Card', actions: h(Badge, { tone: 'success' }, 'Badge') },
        h(SettingRow, { label: 'A setting', description: 'Setting rows in a card' }, h(Switch, { label: 'A setting', checked: on, onChange: setOn }))),
      h(EmptyState, { compact: true, icon: ICON, title: 'EmptyState', description: 'For empty and not-connected states', actions: h(Button, null, 'Connect') })));
}

function SettingsSection({ name, props }) {
  const [on, setOn] = useState(true);
  const [choice, setChoice] = useState('a');
  return h(Section, { title: `slot: ${name}`, description: propsLine(props) },
    h(SettingRow, { label: 'A switch', description: 'Switch for on and off' }, h(Switch, { label: 'A switch', checked: on, onChange: setOn })),
    h(SettingRow, { label: 'A choice', description: 'Select for choices' },
      h(Select, { value: choice, onChange: setChoice, options: [{ value: 'a', label: 'Choice A' }, { value: 'b', label: 'Choice B' }] })));
}

function AdminPage({ props }) {
  return h(Stack, { gap: 4 },
    h(Card, { title: 'slot: admin-plugin-page', actions: h(Button, { size: 'sm', variant: 'secondary' }, 'Action') },
      h(SettingRow, { label: 'Organisation setting', description: propsLine(props) }, h(Input, { placeholder: 'Value', defaultValue: '' }))));
}

function MessageListEmpty({ props }) {
  return h(EmptyState, { compact: true, icon: ICON, title: 'slot: message-list-empty', description: propsLine(props) });
}

function ContextMenu({ props }) {
  return h(Row, { gap: 2, wrap: false }, h(Icon, { name: ICON, size: 'sm' }), h(Text, { size: 'xs', tone: 'muted', truncate: true }, `slot: context-menu-email · ${propsLine(props)}`));
}

function ComposerArea({ name, props }) {
  return h(Alert, { tone: 'info', icon: ICON }, `slot: ${name} · ${propsLine(props)}`);
}

function AttachmentAction({ props }) {
  return h(Chip, { icon: ICON, label: 'slot: attachment-actions', title: propsLine(props), onClick: () => {} });
}

function EventForm({ props }) {
  return h(Field, { label: 'slot: calendar-event-form', hint: propsLine(props) }, h(Input, { placeholder: 'A field in the event form' }));
}

/** name → { component(props), shouldShow? } */
export const SURFACES = {
  'app-top-banner': (p) => h(Bar, { name: 'app-top-banner', props: p }),
  'plugin-dialog': (p) => h(Dialog, { props: p }),
  'navigation-rail-bottom': (p) => h(Rail, { props: p }),
  'sidebar-widget': (p) => h(SidebarWidget, { props: p }),
  'sidebar-section': (p) => h(SidebarSection, { props: p }),
  'app-page': (p) => h(AppPage, { props: p }),
  'message-list-header': (p) => h(Bar, { name: 'message-list-header', props: p }),
  'message-list-empty': (p) => h(MessageListEmpty, { props: p }),
  'context-menu-email': (p) => h(ContextMenu, { props: p }),
  'toolbar-actions': (p) => h(ToolbarButton, { icon: ICON, label: `slot: toolbar-actions (${describeProps(p).length} props)` }),
  'reader-header': (p) => h(Bar, { name: 'reader-header', props: p }),
  'reader-below-subject': (p) => h(Bar, { name: 'reader-below-subject', props: p }),
  'email-banner': (p) => h(Bar, { name: 'email-banner', props: p, compact: false, tone: 'info' }),
  'reader-above-quote': (p) => h(Bar, { name: 'reader-above-quote', props: p }),
  'email-footer': (p) => h(Bar, { name: 'email-footer', props: p, tone: 'neutral' }),
  'thread-summary': (p) => h(Bar, { name: 'thread-summary', props: p, compact: false, tone: 'primary' }),
  'email-detail-sidebar': (p) => h(Panel, { name: 'email-detail-sidebar', props: p }),
  'email-details-section': (p) => h(DetailSection, { name: 'email-details-section', props: p }),
  'attachment-actions': (p) => h(AttachmentAction, { props: p }),
  'composer-toolbar': (p) => h(Inline, { name: 'composer-toolbar', props: p }),
  'composer-above-body': (p) => h(ComposerArea, { name: 'composer-above-body', props: p }),
  'composer-below-body': (p) => h(ComposerArea, { name: 'composer-below-body', props: p }),
  'composer-sidebar': (p) => h(Panel, { name: 'composer-sidebar', props: p }),
  'composer-sidebar-right': (p) => h(Panel, { name: 'composer-sidebar-right', props: p }),
  'composer-attachment-source': (p) => h(Inline, { name: 'composer-attachment-source', props: p }),
  'calendar-event-actions': (p) => h(Inline, { name: 'calendar-event-actions', props: p, variant: 'secondary' }),
  'calendar-event-detail': (p) => h(DetailSection, { name: 'calendar-event-detail', props: p }),
  'calendar-event-form': (p) => h(EventForm, { props: p }),
  'contact-cryptokeys': (p) => h(DetailSection, { name: 'contact-cryptokeys', props: p }),
  'contact-detail-section': (p) => h(DetailSection, { name: 'contact-detail-section', props: p }),
  'task-detail-section': (p) => h(DetailSection, { name: 'task-detail-section', props: p }),
  'file-preview-section': (p) => h(DetailSection, { name: 'file-preview-section', props: p }),
  'settings-section': (p) => h(SettingsSection, { name: 'settings-section', props: p }),
  'settings-page': (p) => h(SettingsSection, { name: 'settings-page', props: p }),
  'admin-plugin-page': (p) => h(AdminPage, { props: p }),
};
