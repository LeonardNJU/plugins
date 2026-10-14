// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeNoteBanner, makeNotesPanel, withNote, SAVE_DELAY_MS } from '../src/lib/notes.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('note banner', () => {
  it('is a one-line info bar', () => {
    render(React.createElement(makeNoteBanner(React)));
    const bar = document.querySelector('.bk-infobar');
    expect(bar.textContent).toBe('This email has a note attached.');
    expect(document.querySelector('[style]')).toBeNull();
  });
});

describe('notes panel', () => {
  it('loads the note into the kit textarea under a labelled field and saves edits', async () => {
    const api = fakeApi();
    await api.storage.set('notes', { m1: { text: 'call back', updatedAt: '2026-10-14T09:00:00.000Z' } });
    const Panel = makeNotesPanel(React, api);
    await act(async () => { render(React.createElement(Panel, { email: { id: 'm1' } })); });
    const box = screen.getByLabelText('Note for this email');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box.value).toBe('call back');
    expect(screen.getByRole('heading', { name: 'Quick Notes' })).toBeTruthy();

    vi.useFakeTimers();
    fireEvent.change(box, { target: { value: 'call back tomorrow' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS); });
    vi.useRealTimers();
    expect((await api.storage.get('notes')).m1.text).toBe('call back tomorrow');
  });

  it('keeps only the newest notes and drops emptied ones', () => {
    const map = { a: { text: 'x', updatedAt: '2026-01-01' }, b: { text: 'y', updatedAt: '2026-02-01' } };
    expect(Object.keys(withNote(map, 'c', 'z', 2, new Date('2026-03-01')))).toEqual(['b', 'c']);
    expect(withNote(map, 'a', '  ', 10)).toEqual({ b: map.b });
  });
});
