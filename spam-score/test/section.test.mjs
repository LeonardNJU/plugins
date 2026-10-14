// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { SpamSection } from '../src/index.js';

afterEach(cleanup);

const email = (status) => ({ id: 'm', headers: { 'X-Spam-Status': status } });

describe('spam analysis section', () => {
  it('shows the verdict as a status badge in the theme tone, without colours of its own', () => {
    render(React.createElement(SpamSection, { email: email('Yes, score=9.20 required=5.00'), category: null }));
    const badge = screen.getByText('Spam');
    expect(badge.getAttribute('data-tone')).toBe('danger');
    expect(document.body.textContent).toMatch(/9\.20 \/ 5\.00 threshold/);
    for (const el of document.querySelectorAll('[style]')) {
      expect(el.getAttribute('style')).not.toMatch(/color|background|border|var\(--/);
    }
  });

  it('marks clean mail as success', () => {
    render(React.createElement(SpamSection, { email: email('No, score=0.10 required=5.00'), category: null }));
    expect(screen.getByText('Clean').getAttribute('data-tone')).toBe('success');
  });

  it('renders nothing without spam headers', () => {
    render(React.createElement(SpamSection, { email: { id: 'm', headers: {} }, category: null }));
    expect(document.body.textContent).toBe('');
  });
});
