// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Markdown, parseBlocks, stripMarkdown } from '../src/ui/Markdown.jsx';

// The answers' Markdown: built as elements, never as HTML.

afterEach(cleanup);

describe('parseBlocks', () => {
  it('finds headings, lists, quotes, code, tables and paragraphs', () => {
    const blocks = parseBlocks('## Busy\n- Lernblock 12:30\n- Abends\n\n1. one\n2. two\n\n> quoted\n\n```\ncode here\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nPlain text\nsecond line');
    expect(blocks.map((b) => b.kind)).toEqual(['h', 'ul', 'ol', 'quote', 'code', 'table', 'p']);
    expect(blocks[1].items).toEqual(['Lernblock 12:30', 'Abends']);
    expect(blocks[4].text).toBe('code here');
    expect(blocks[5]).toMatchObject({ columns: ['A', 'B'], rows: [['1', '2']] });
    expect(blocks[6].lines).toEqual(['Plain text', 'second line']);
  });
});

describe('Markdown', () => {
  it('renders bold, code and links as elements and never injects HTML', () => {
    const open = vi.fn();
    render(React.createElement(Markdown, { text: '**Busy** at `12:30`, see [the plan](https://example.org/p) <img src=x onerror=alert(1)>', onOpenLink: open }));
    expect(document.querySelector('strong').textContent).toBe('Busy');
    expect(document.querySelector('code').textContent).toBe('12:30');
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
    expect(open).toHaveBeenCalledWith('https://example.org/p');
  });

  it('renders lists and headings', () => {
    render(React.createElement(Markdown, { text: '### Free\n- Sat 24\n- Sun 25' }));
    expect(screen.getByRole('heading').textContent).toBe('Free');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sat 24', 'Sun 25']);
    // Real bullets despite the frame's CSS reset, and no margin after the last block.
    const ul = document.querySelector('ul');
    expect(ul.style.listStyleType).toBe('disc');
    expect(ul.style.marginBottom).toBe('0px');
    expect(screen.getByRole('heading').style.marginTop).toBe('0px');
  });
});

describe('stripMarkdown', () => {
  it('leaves readable plain text for the clipboard and the message', () => {
    expect(stripMarkdown('**Busy**\n- a `b`\n- c\n\nSee [x](https://e.org)')).toBe('Busy\n\n- a b\n- c\n\nSee x (https://e.org)');
  });
});
