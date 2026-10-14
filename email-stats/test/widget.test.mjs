// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeStatsWidget } from '../src/lib/widget.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

afterEach(cleanup);

async function show(api) {
  const Widget = makeStatsWidget(React, api);
  await act(async () => { render(React.createElement(Widget)); });
}

describe('email stats section', () => {
  it('shows each counter as a sidebar row with the count as its detail', async () => {
    const api = fakeApi();
    await api.storage.set('lifetime', { opened: 12, sent: 3, received: 1500 });
    await show(api);
    expect(screen.getByText('Opened', { exact: false }).textContent).toBe('Opened12');
    expect(screen.getByText('Sent', { exact: false }).textContent).toBe('Sent3');
    expect(screen.getByText('Received', { exact: false }).textContent).toBe(`Received${(1500).toLocaleString()}`);
    // The host draws the section header; no heading of the plugin's own.
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Email Stats/);
  });

  it('registers a sidebar section, not a widget that draws its own header', () => {
    const src = readFileSync(path.join(process.cwd(), 'email-stats', 'src', 'index.js'), 'utf8');
    expect(src).toMatch(/'sidebar-section': \{/);
    expect(src).not.toMatch(/'sidebar-widget'/);
  });

  it('counts from zero when nothing is stored yet', async () => {
    await show(fakeApi());
    expect(screen.getByText('Opened', { exact: false }).textContent).toBe('Opened0');
  });
});
