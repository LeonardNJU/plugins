// Mount a slot component in jsdom (test files using this need
// `// @vitest-environment jsdom`), with effects run and promises settled.

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export async function mount(Component, props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(Component, props)); });
  await settle();
  return {
    container,
    text: () => container.textContent,
    $: (sel) => container.querySelector(sel),
    $$: (sel) => [...container.querySelectorAll(sel)],
    rerender: async (next) => { await act(async () => { root.render(createElement(Component, next)); }); await settle(); },
    unmount: () => act(() => root.unmount()),
  };
}

export async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Type into an input the way React notices. */
export async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
}

export function button(container, name) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name || b.getAttribute('aria-label') === name);
}

/** The control a label (found by its text) points to. */
export function byLabel(container, text) {
  const label = [...container.querySelectorAll('label')].find((l) => l.textContent.trim() === text);
  if (!label) return null;
  return label.htmlFor ? label.ownerDocument.getElementById(label.htmlFor) : null;
}
