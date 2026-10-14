// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeJitsiButton } from '../src/lib/button.js';

afterEach(cleanup);

describe('Add Jitsi meeting', () => {
  it('is the kit outline button and puts the new link into the event form', async () => {
    let resolve;
    const api = fakeApi({ handlers: { 'http.post': () => new Promise((r) => { resolve = r; }) } });
    const setVirtualLocation = vi.fn(async () => {});
    const Btn = makeJitsiButton(React, api);
    render(React.createElement(Btn, { eventData: { title: 'Planning' }, setVirtualLocation }));
    const button = screen.getByRole('button', { name: 'Add Jitsi meeting' });
    expect(button.getAttribute('data-variant')).toBe('secondary');
    expect(button.querySelector('[data-icon="video"]')).toBeTruthy();
    expect(button.getAttribute('style')).toBeNull();

    fireEvent.click(button);
    // Busy while the sidecar answers: the kit shows its spinner and disables it.
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => { resolve({ ok: true, status: 200, data: { url: 'https://meet.example/abc' } }); });

    expect(api.calls('http.post')[0].args).toEqual(['/api/jitsi', { eventTitle: 'Planning' }]);
    expect(setVirtualLocation).toHaveBeenCalledWith('https://meet.example/abc');
    expect(button.disabled).toBe(false);
  });

  it('reports a sidecar error as a toast', async () => {
    const api = fakeApi({ handlers: { 'http.post': async () => ({ ok: false, status: 401, data: { error: 'no token' } }) } });
    const Btn = makeJitsiButton(React, api);
    render(React.createElement(Btn, { setVirtualLocation: vi.fn() }));
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(api.calls('toast.error')[0].args[0]).toBe('Could not create Jitsi meeting: no token');
  });
});
