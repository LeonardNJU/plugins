// The "Create task" dialog, rendered in the plugin-dialog slot. Plain
// React.createElement so it runs in the sandbox without a JSX step.

import * as React from 'react';
import { connectTarget, containersFor, createTasks, prepareDialog } from '../lib/dialog-model.js';
import { errorText, RECONNECT_CODES, toTaskError } from '../lib/errors.js';
import { PRIORITIES } from '../lib/priority.js';
import { savePrefs } from '../lib/task-store.js';

const h = React.createElement;
const { useEffect, useMemo, useRef, useState } = React;

const CSS = `
:root.dark { color-scheme: dark; }
.e2t { font-size: 14px; color: var(--color-popover-foreground, var(--color-foreground)); display: flex; flex-direction: column; gap: 12px; }
.e2t label.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 500; }
.e2t input[type=text], .e2t input[type=url], .e2t input[type=date], .e2t select, .e2t textarea {
  box-sizing: border-box; width: 100%; min-width: 0; font: inherit; font-size: 14px; font-weight: 400;
  color: var(--color-foreground); background: var(--color-background);
  border: 1px solid var(--color-input, var(--color-border)); border-radius: 6px; padding: 7px 9px;
}
.e2t textarea { resize: vertical; min-height: 96px; }
.e2t :focus-visible { outline: 2px solid var(--color-ring, var(--color-primary)); outline-offset: 1px; }
.e2t .row { display: flex; gap: 10px; flex-wrap: wrap; }
.e2t .row > * { flex: 1 1 160px; }
.e2t .stack { display: flex; flex-direction: column; gap: 4px; }
.e2t .hint { font-size: 12px; font-weight: 400; color: var(--color-muted-foreground); }
.e2t .note { font-size: 13px; border-radius: 6px; padding: 8px 10px; background: var(--color-muted); color: var(--color-foreground); }
.e2t .note.warn { background: color-mix(in srgb, var(--color-warning, #d97706) 14%, transparent); }
.e2t .error { font-size: 13px; border-radius: 6px; padding: 8px 10px; color: var(--color-destructive);
  background: color-mix(in srgb, var(--color-destructive) 10%, transparent); }
.e2t button { font: inherit; font-size: 14px; border-radius: 6px; padding: 7px 14px; cursor: pointer;
  border: 1px solid var(--color-border); background: var(--color-background); color: var(--color-foreground); }
.e2t button.primary { background: var(--color-primary); color: var(--color-primary-foreground); border-color: var(--color-primary); }
.e2t button:disabled { opacity: .55; cursor: default; }
.e2t button.link { border: 0; background: none; padding: 0; color: var(--color-primary); text-decoration: underline; cursor: pointer; }
.e2t .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; align-items: center; }
.e2t .actions .grow { flex: 1 1 180px; }
.e2t ul.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.e2t ul.items li { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.e2t ul.items li .title { flex: 1 1 200px; }
.e2t ul.items li input[type=date] { flex: 0 0 150px; width: 150px; }
.e2t ul.items li .item-error { flex-basis: 100%; font-size: 12px; color: var(--color-destructive); }
`;

function useStyle() {
  useEffect(() => {
    if (document.getElementById('e2t-style')) return;
    const el = document.createElement('style');
    el.id = 'e2t-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
}

const CONTAINER_LABEL = { vikunja: 'container.project', todoist: 'container.project', caldav: 'container.list' };

export function TaskDialog({ api, emailIds, onResult }) {
  useStyle();
  const t = (key, vars) => api.i18n.t(key, vars);
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [items, setItems] = useState([]);
  const [target, setTarget] = useState(null);
  const [containers, setContainers] = useState({ status: 'idle', list: [], error: null });
  const [containerId, setContainerId] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const firstField = useRef(null);
  const single = items.length === 1;

  // Load the messages, services and last choices.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await prepareDialog(api, { emailIds });
        if (cancelled) return;
        setState(s);
        setItems(s.items.map((i) => ({ ...i, include: true })));
        setTarget(s.target);
        setManualUrl(s.prefs.caldavUrl || '');
      } catch (err) {
        if (!cancelled) setLoadError(toTaskError(err));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetInfo = useMemo(() => state?.targets.find((x) => x.id === target) ?? null, [state, target]);

  // Projects or task lists of the chosen service.
  const loadContainers = async (s = state, id = target) => {
    if (!s || !id || id === 'bulwark') {
      setContainers({ status: 'ready', list: [], error: null });
      return;
    }
    if (!s.targets.find((x) => x.id === id)?.connected) {
      setContainers({ status: 'idle', list: [], error: null });
      return;
    }
    setContainers({ status: 'loading', list: [], error: null });
    try {
      const list = await containersFor(api, s, id);
      setContainers({ status: 'ready', list, error: null });
      const remembered = s.prefs.containers?.[id];
      setContainerId(list.some((c) => c.id === remembered) ? remembered : list[0]?.id ?? '');
    } catch (err) {
      setContainers({ status: 'error', list: [], error: toTaskError(err) });
      setContainerId('');
    }
  };

  useEffect(() => {
    if (state && target) void loadContainers(state, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, target]);

  useEffect(() => {
    if (state && firstField.current) firstField.current.focus();
  }, [state]);

  const serviceName = targetInfo?.name ?? '';

  const connect = async () => {
    setError(null);
    try {
      const accounts = await connectTarget(api, state, target);
      const next = {
        ...state,
        accounts,
        targets: state.targets.map((x) => (x.id === target ? { ...x, connected: x.id === 'bulwark' || !!accounts[target] } : x)),
      };
      setState(next);
    } catch (err) {
      setError(toTaskError(err));
    }
  };

  const searchAgain = async () => {
    const prefs = await savePrefs(api, { caldavUrl: manualUrl.trim() });
    const next = { ...state, prefs };
    setState(next);
  };

  const update = (emailId, patch) => setItems((now) => now.map((i) => (i.emailId === emailId ? { ...i, ...patch } : i)));

  const chosen = items.filter((i) => i.include);
  const needsContainer = target === 'vikunja';
  const canCreate = !!state && !!targetInfo?.connected && !busy && chosen.length > 0
    && containers.status !== 'loading' && (!needsContainer || !!containerId)
    && !(target === 'caldav' && !containerId);

  const create = async () => {
    setError(null);
    const form = {
      target,
      containerId,
      items: chosen,
    };
    setBusy({ done: 0, total: form.items.length });
    let result;
    try {
      result = await createTasks(api, state, form, (done, total) => setBusy({ done, total }));
    } catch (err) {
      setBusy(null);
      setError(toTaskError(err));
      return;
    }
    setBusy(null);
    const { created, failed } = result;
    if (created.length) {
      api.toast.success(created.length === 1
        ? t('created.one', { service: serviceName })
        : t('created.many', { count: created.length, service: serviceName }));
    }
    if (!failed.length) {
      onResult?.({ created: created.map((c) => c.emailId) });
      return;
    }
    // Keep the messages that failed, with what went wrong.
    const createdIds = new Set(created.map((c) => c.emailId));
    setItems((now) => now.filter((i) => !createdIds.has(i.emailId)));
    setError(failed[0].error);
  };

  if (loadError) {
    return h('div', { className: 'e2t' },
      h('p', { className: 'error', role: 'alert' }, errorText(t, loadError, '')),
      h('div', { className: 'actions' }, h('button', { type: 'button', onClick: () => onResult?.(null) }, t('dialog.close'))));
  }
  if (!state) {
    return h('div', { className: 'e2t' }, h('p', { role: 'status', className: 'hint' }, t('dialog.loading')));
  }
  if (!state.items.length) {
    return h('div', { className: 'e2t' },
      h('p', { className: 'error', role: 'alert' }, t('dialog.no_message')),
      h('div', { className: 'actions' }, h('button', { type: 'button', onClick: () => onResult?.(null) }, t('dialog.close'))));
  }


  const targetField = h('label', { className: 'field' }, t('dialog.service'),
    h('select', {
      value: target ?? '',
      disabled: !!busy,
      onChange: (e) => { setTarget(e.target.value); setError(null); },
    }, state.targets.map((x) => h('option', { key: x.id, value: x.id }, x.connected ? x.name : t('dialog.service_not_connected', { service: x.name })))));

  const connectBox = targetInfo && !targetInfo.connected && h('div', { className: 'note' },
    h('p', { style: { margin: '0 0 8px' } }, t(`connect.needed.${target}`, { service: serviceName })),
    h('button', { type: 'button', className: 'primary', onClick: connect }, t('connect.button', { service: serviceName })));

  let containerField = null;
  if (targetInfo?.connected && target !== 'bulwark') {
    if (containers.status === 'loading') {
      containerField = h('p', { role: 'status', className: 'hint' }, t('dialog.loading_lists'));
    } else if (containers.status === 'error') {
      const reconnect = RECONNECT_CODES.has(containers.error?.code);
      containerField = h('div', { className: 'error', role: 'alert' },
        errorText(t, containers.error, serviceName), ' ',
        reconnect
          ? h('button', { type: 'button', className: 'link', onClick: connect }, t('connect.again'))
          : h('button', { type: 'button', className: 'link', onClick: () => loadContainers() }, t('dialog.retry')));
    } else if (containers.list.length) {
      containerField = h('label', { className: 'field' }, t(CONTAINER_LABEL[target]),
        h('select', { value: containerId, disabled: !!busy, onChange: (e) => setContainerId(e.target.value) },
          containers.list.map((c) => h('option', { key: c.id, value: c.id }, c.name))));
    } else if (target === 'caldav' && containers.status === 'ready') {
      containerField = h('div', { className: 'note warn' },
        h('p', { style: { margin: '0 0 8px' } }, t('caldav.none_found')),
        h('label', { className: 'field' }, t('caldav.address'),
          h('input', { type: 'url', value: manualUrl, placeholder: 'https://', onChange: (e) => setManualUrl(e.target.value) })),
        h('div', { className: 'actions', style: { marginTop: '8px' } },
          h('button', { type: 'button', onClick: searchAgain }, t('caldav.search_again'))));
    }
  }


  const priorityOptions = (withAuto) => [
    ...PRIORITIES.map((p) => h('option', { key: p, value: p }, t(`priority.${p}`))),
  ];

  const fields = (() => {
    const item = items[0];
    return [
      h('label', { key: 'title', className: 'field' }, t('dialog.title'),
        h('input', { type: 'text', ref: firstField, value: item.title, maxLength: 500, onChange: (e) => update(item.emailId, { title: e.target.value }) })),
      h('div', { key: 'description', className: 'stack' },
        h('label', { className: 'field' }, t('dialog.description'),
          h('textarea', { value: item.description, rows: 6, maxLength: 10000, 'aria-describedby': 'e2t-desc-hint', onChange: (e) => update(item.emailId, { description: e.target.value }) })),
        h('span', { id: 'e2t-desc-hint', className: 'hint' }, t('dialog.description_hint', { service: serviceName }))),
      h('div', { key: 'row', className: 'row' },
        h('div', { className: 'stack' },
          h('label', { className: 'field' }, t('dialog.due'),
            h('input', { type: 'date', value: item.due, 'aria-describedby': item.dueMatch ? 'e2t-due-hint' : undefined, onChange: (e) => update(item.emailId, { due: e.target.value, dueMatch: '' }) })),
          item.dueMatch ? h('span', { id: 'e2t-due-hint', className: 'hint' }, t('dialog.due_found', { words: item.dueMatch })) : null),
        h('label', { className: 'field' }, t('dialog.priority'),
          h('select', { value: item.priority, onChange: (e) => update(item.emailId, { priority: e.target.value }) }, priorityOptions(false)))),
    ];
  })();

  const reconnect = error && RECONNECT_CODES.has(error.code);

  // Not a <form>: the sandbox frame has no allow-forms, so a submit would
  // be dropped before any handler runs. Enter in a one-line field creates.
  return h('div', {
    className: 'e2t',
    onKeyDown: (e) => {
      if (e.key === 'Enter' && e.target?.tagName === 'INPUT' && e.target.type === 'text' && canCreate) {
        e.preventDefault();
        void create();
      }
    },
  },
  targetField,
  connectBox,
  containerField,
  ...fields,
  error && h('div', { className: 'error', role: 'alert' }, errorText(t, error, serviceName),
    reconnect ? h('span', null, ' ', h('button', { type: 'button', className: 'link', onClick: connect }, t('connect.again'))) : null),
  h('div', { className: 'actions' },
    h('button', { type: 'button', disabled: !!busy, onClick: () => onResult?.(null) }, t('dialog.cancel')),
    h('button', { type: 'button', className: 'primary', disabled: !canCreate, onClick: () => { void create(); } },
      busy
        ? (busy.total > 1 ? t('dialog.creating_many', { done: busy.done, total: busy.total }) : t('dialog.creating'))
        : (chosen.length > 1 ? t('dialog.create_many', { count: chosen.length }) : t('dialog.create')))));
}
