// Stand-in for `@plugin-host/ui` in unit tests (vitest aliases the module
// here). The real kit is the webmail's lib/plugin-sandbox/ui-kit, which the
// sandbox hands to plugins at run time; it can't be imported outside the
// webmail. This one renders the same roles, names and states with plain
// elements, so tests find controls the way users do: by role and label.
// ui-kit.test.mjs checks that it exports the same names as the real kit.

import * as React from 'react';

const h = React.createElement;
const cls = (name) => `bk-${name}`;

export const KIT_VERSION = 1;

export function Icon({ name }) {
  return h('span', { 'data-icon': name ?? 'puzzle', 'aria-hidden': 'true' });
}

export function FileIcon({ name = '', folder = false }) {
  return h('span', { 'data-file-icon': folder ? 'folder' : name, 'aria-hidden': 'true' });
}

export function Spinner({ label }) {
  return h('span', { role: 'status', className: cls('spinner') }, label ?? '…');
}

export function Loading({ label }) {
  return h('div', { className: cls('loading') }, h(Spinner, { label }));
}

export const Button = React.forwardRef(function Button({ variant = 'primary', size = 'md', icon, busy = false, disabled, children, type = 'button', ...rest }, ref) {
  return h('button', { ref, type, disabled: disabled || busy, 'aria-busy': busy || undefined, 'data-variant': variant, 'data-size': size, ...rest },
    icon ? h(Icon, { name: icon }) : null, children);
});

export function LinkButton({ icon, children, ...rest }) {
  return h('button', { type: 'button', 'data-variant': 'link', ...rest }, icon ? h(Icon, { name: icon }) : null, children);
}

export function Link({ href, children }) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children);
}

export const Input = React.forwardRef(function Input(props, ref) {
  return h('input', { ref, ...props });
});

export const Textarea = React.forwardRef(function Textarea(props, ref) {
  return h('textarea', { ref, ...props });
});

export function Select({ options, children, onChange, block, ...rest }) {
  void block;
  return h('select', { onChange: (e) => onChange?.(e.target.value, e), ...rest },
    options?.map((o) => h('option', { key: o.value, value: o.value, disabled: o.disabled }, o.label)), children);
}

export function Checkbox({ checked, onChange, label, hint, disabled = false, id }) {
  const autoId = React.useId();
  const boxId = id ?? autoId;
  const box = h('button', { id: boxId, type: 'button', role: 'checkbox', 'aria-checked': checked, disabled, onClick: () => onChange?.(!checked) });
  if (!label) return box;
  return h('div', { className: cls('checkbox') }, box, h('label', { htmlFor: boxId }, label), hint ? h('p', null, hint) : null);
}

export function Switch({ checked, onChange, disabled = false, label, id }) {
  return h('button', { id, type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, onClick: () => onChange?.(!checked) });
}

export function Segmented({ value, options, onChange, label }) {
  return h('div', { role: 'radiogroup', 'aria-label': label },
    options.map((o) => h('button', { key: o.value, type: 'button', role: 'radio', 'aria-checked': o.value === value, onClick: () => onChange?.(o.value) }, o.label)));
}

export function Field({ label, hint, error, required = false, children }) {
  const autoId = React.useId();
  const only = React.Children.count(children) === 1 && React.isValidElement(children) ? children : null;
  const controlId = only?.props.id ?? autoId;
  return h('div', { className: cls('field') },
    h('label', { htmlFor: only ? controlId : undefined }, label, required ? ' *' : null),
    only && !only.props.id ? React.cloneElement(only, { id: controlId }) : children,
    hint && !error ? h('p', null, hint) : null,
    error ? h('p', { role: 'alert' }, error) : null);
}

export function SearchInput({ value, onChange, placeholder, label }) {
  return h('input', { type: 'search', value, placeholder, 'aria-label': label ?? placeholder, onChange: (e) => onChange(e.target.value) });
}

export function Stack({ children }) { return h('div', { className: cls('stack') }, children); }
export function Row({ children }) { return h('div', { className: cls('row') }, children); }
export function Text({ children, tone }) { return h('p', { 'data-tone': tone }, children); }
export function Heading({ children, level = 3 }) { return h(`h${level}`, null, children); }
export function Divider() { return h('div', { role: 'separator' }); }
export function Page({ children }) { return h('div', { className: cls('page') }, children); }

export function PageHeader({ title, description, actions }) {
  return h('div', { className: cls('page-header') }, h('h1', null, title), description ? h('p', null, description) : null, actions ?? null);
}

export function Section({ title, description, children }) {
  return h('section', null, title ? h('h3', null, title) : null, description ? h('p', null, description) : null, children);
}

export function SettingRow({ label, description, children, htmlFor }) {
  return h('div', { className: cls('setting') }, h('label', { htmlFor }, label), description ? h('p', null, description) : null, children);
}

export function Card({ title, actions, children }) {
  return h('div', { className: cls('card') }, title ? h('h2', null, title) : null, actions ?? null, children);
}

export function Tabs({ value, tabs, onChange, label }) {
  return h('div', { role: 'tablist', 'aria-label': label },
    tabs.map((t) => h('button', { key: t.id, type: 'button', role: 'tab', 'aria-selected': t.id === value, onClick: () => onChange(t.id) }, t.label, t.count !== undefined ? ` ${t.count}` : null)));
}

export function Toolbar({ children }) { return h('div', { role: 'toolbar' }, children); }
export function ToolbarSpacer() { return h('div', null); }

export function ToolbarButton({ icon, label, compact = false, active = false, busy = false, disabled, onClick }) {
  return h('button', { type: 'button', 'aria-label': compact ? label : undefined, 'aria-pressed': active || undefined, disabled: disabled || busy, onClick, 'data-icon': icon },
    compact ? null : label);
}

export function Breadcrumbs({ items, onSelect, label }) {
  return h('nav', { 'aria-label': label }, h('ol', null, items.map((item, i) => h('li', { key: item.id },
    h('button', { type: 'button', 'aria-current': i === items.length - 1 ? 'page' : undefined, onClick: () => onSelect(item.id) }, item.label)))));
}

export function List({ children, label }) {
  return h('div', { role: 'list', 'aria-label': label }, children);
}

export function ListRow({ title, subtitle, meta, selected = false, checked, onCheck, onClick, onDoubleClick, actions, disabled = false }) {
  return h('div', {
    role: 'listitem', 'aria-selected': selected || undefined, 'aria-disabled': disabled || undefined, tabIndex: onClick ? 0 : undefined,
    onClick: disabled ? undefined : onClick, onDoubleClick: disabled ? undefined : onDoubleClick,
  },
  checked !== undefined ? h(Checkbox, { checked, onChange: onCheck, disabled }) : null,
  h('span', null, title), subtitle ? h('span', null, subtitle) : null,
  ...(meta ?? []).map((m, i) => h('span', { key: i }, m)),
  actions ?? null);
}

export function RowAction({ icon, label, onClick }) {
  return h('button', { type: 'button', 'aria-label': label, title: label, onClick, 'data-icon': icon });
}

export function Badge({ tone = 'neutral', children }) { return h('span', { 'data-tone': tone }, children); }

export function Chip({ label, detail, onClick, onRemove, removeLabel, title }) {
  const body = [h('span', { key: 'l' }, label), detail ? h('span', { key: 'd' }, detail) : null];
  if (onClick && !onRemove) return h('button', { type: 'button', title, onClick }, ...body);
  return h('span', { title }, ...body, onRemove ? h('button', { type: 'button', 'aria-label': removeLabel ?? '×', onClick: onRemove }) : null);
}

export function InfoBar({ tone = 'neutral', eyebrow, title, children }) {
  return h('div', { 'data-tone': tone, className: cls('infobar') }, eyebrow ? h('div', null, eyebrow) : null, title ? h('div', null, title) : null, children);
}

export function BarButton({ icon, children, onClick, active = false, busy = false, disabled }) {
  return h('button', { type: 'button', onClick, disabled: disabled || busy, 'aria-pressed': active || undefined, 'data-icon': icon }, children);
}

export function Alert({ tone = 'danger', children, action }) {
  return h('div', { role: tone === 'danger' ? 'alert' : 'status', 'data-tone': tone }, children, action ?? null);
}

export function ProgressBar({ value, label }) {
  return h('div', { role: 'progressbar', 'aria-label': label, 'aria-valuenow': value === null ? undefined : Math.round(value * 100) });
}

export function EmptyState({ title, description, actions }) {
  return h('div', { className: cls('empty') }, h('h3', null, title), description ? h('p', null, description) : null, actions ?? null);
}

export function SidebarRow({ label, detail, onClick, title }) {
  return onClick
    ? h('button', { type: 'button', onClick, title }, label, detail ? h('span', null, detail) : null)
    : h('div', { title }, label, detail ? h('span', null, detail) : null);
}

export function SidebarEmpty({ children }) { return h('p', null, children); }

export const SlotPropsContext = React.createContext({});
export function useSlotProps() { return React.useContext(SlotPropsContext); }

// Like the real kit outside a host dialog: draws the buttons in place. A test
// can wrap the dialog in SlotPropsContext with setDialogButtons to see what
// the host would get.
export function DialogButtons({ buttons, onClick }) {
  const props = useSlotProps();
  const set = typeof props.setDialogButtons === 'function' ? props.setDialogButtons : null;
  const key = JSON.stringify(buttons);
  React.useEffect(() => { set?.(JSON.parse(key)); }, [key, set]);
  if (set) return null;
  return h('div', { 'data-dialog-buttons': '' }, buttons.map((b) => h(Button, {
    key: b.id, variant: b.variant ?? 'primary', disabled: b.disabled, busy: b.busy, onClick: () => onClick(b.id),
  }, b.label)));
}
