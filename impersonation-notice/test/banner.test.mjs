// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ImpersonationBar } from '../src/lib/banner.js';

afterEach(cleanup);

const props = { mailbox: 'alice@example.org', actorRoleLabel: 'as Platform Admin', returnLabel: 'Back to platform' };

describe('impersonation banner', () => {
  it('is a compact warning info bar naming the mailbox', () => {
    render(React.createElement(ImpersonationBar, { ...props, showReturn: false }));
    const bar = document.querySelector('.bk-infobar');
    expect(bar.getAttribute('data-tone')).toBe('warning');
    expect(screen.getByRole('status').textContent).toBe('You are viewing alice@example.org as Platform Admin');
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('has a bar button that goes back to the platform', () => {
    const onReturn = vi.fn();
    render(React.createElement(ImpersonationBar, { ...props, showReturn: true, busy: false, onReturn }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to platform' }));
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('has no colour settings any more', () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'impersonation-notice', 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.configSchema)).toEqual(['returnUrl', 'returnLabel', 'actorRoleLabel']);
    const src = readFileSync(path.join(process.cwd(), 'impersonation-notice', 'src', 'index.js'), 'utf8');
    expect(src).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
