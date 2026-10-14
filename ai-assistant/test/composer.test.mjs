import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { createBackground, DRAFT_KEY } from '../src/lib/background.js';
import { ownText, createHistory } from '../src/lib/draft.js';
import { buildPrompt, clip, REWRITE_STYLES } from '../src/lib/prompts.js';
import { defaultTarget, languageOptions } from '../src/lib/languages.js';
import plugin from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };

const configured = { 'admin.getAllConfig': async () => ({ openaiBaseUrl: 'http://localhost:11434/v1' }) };

describe('ownText', () => {
  it('drops the quoted message of a reply and its "wrote:" line', () => {
    const text = 'Hi Bob,\n\nsounds good.\n\nOn Tue, 13 Oct 2026, Bob <bob@example.org> wrote:\n> Can we meet?\n> Bob';
    expect(ownText(text)).toBe('Hi Bob,\n\nsounds good.');
  });

  it('drops the signature and a forwarded message', () => {
    expect(ownText('Thanks!\n-- \nAlice\nACME')).toBe('Thanks!');
    expect(ownText('FYI\n\n---------- Forwarded message ---------\nFrom: x')).toBe('FYI');
  });

  it('keeps text without any of those', () => {
    expect(ownText('Line one\r\nLine two: details')).toBe('Line one\nLine two: details');
  });
});

describe('createHistory', () => {
  it('undoes applied changes one at a time, but not typing', () => {
    const h = createHistory('a');
    h.set('ab');
    expect(h.canUndo).toBe(false);
    h.apply('AB');
    h.apply('AB!');
    expect(h.undo()).toBe('AB');
    expect(h.undo()).toBe('ab');
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBe('ab');
  });
});

describe('composer prompts', () => {
  it('asks for the body only, in the user\'s language, with the subject', () => {
    const p = buildPrompt('write', { prompt: 'thank Anna', subject: 'Workshop', language: 'de' });
    expect(p.system).toContain('Write in German');
    expect(p.messages[0].content).toContain('thank Anna');
    expect(p.messages[0].content).toContain('Subject of the email: Workshop');
  });

  it('has a distinct instruction for every rewrite style and keeps the draft in tags', () => {
    const systems = REWRITE_STYLES.map((style) => buildPrompt('rewrite', { text: 'Hello', style }).system);
    expect(new Set(systems).size).toBe(REWRITE_STYLES.length);
    expect(buildPrompt('rewrite', { text: 'Hello', style: 'shorter' }).messages[0].content).toBe('<draft>\nHello\n</draft>');
  });

  it('translates into the chosen language', () => {
    expect(buildPrompt('translate', { text: 'Hallo', target: 'fr' }).system).toContain('into French');
  });

  it('cuts very long text', () => {
    const long = 'x'.repeat(40_000);
    expect(clip(long).length).toBeLessThan(31_000);
    expect(clip('short')).toBe('short');
  });
});

describe('translation languages', () => {
  it('suggests the last language used, else English, else German for English users', () => {
    expect(defaultTarget('fr', 'it')).toBe('it');
    expect(defaultTarget('fr')).toBe('en');
    expect(defaultTarget('en-GB')).toBe('de');
    const options = languageOptions('de');
    expect(options.find((o) => o.tag === 'fr').label).toBe('Französisch');
  });
});

describe('background', () => {
  it('keeps the open draft for the dialog and forgets it when the composer closes', async () => {
    const api = fakeApi({ handlers: configured });
    const bg = createBackground(api);
    await bg.activate();
    await bg.hooks.onDraftChange({ subject: 'Hi', textBody: 'Hello there', to: ['a@b.c'] });
    expect(await api.storage.get(DRAFT_KEY)).toMatchObject({ subject: 'Hi', text: 'Hello there' });
    expect(Object.keys(await api.storage.get(DRAFT_KEY))).not.toContain('to');
    await bg.hooks.onComposerClose({ sent: false });
    expect(await api.storage.get(DRAFT_KEY)).toBeNull();
  });

  it('forgets a draft left from an earlier session when it starts', async () => {
    const api = fakeApi({ handlers: configured });
    await api.storage.set(DRAFT_KEY, { text: 'old' });
    await createBackground(api).activate();
    expect(await api.storage.get(DRAFT_KEY)).toBeNull();
  });

  it('shows the composer button only when a service is set up', async () => {
    const off = createBackground(fakeApi({ handlers: { 'admin.getAllConfig': async () => ({}) } }));
    await off.activate();
    expect(off.shouldShow.composer()).toBe(false);
    const on = createBackground(fakeApi({ handlers: configured }));
    await on.activate();
    expect(on.shouldShow.composer()).toBe(true);
  });

  it('notices a newly set up service when the composer opens, at most every 30 s', async () => {
    let config = {};
    let now = 1_000_000;
    const api = fakeApi({ handlers: { 'admin.getAllConfig': async () => config } });
    const bg = createBackground(api, { now: () => now });
    await bg.activate();
    config = { anthropicBaseUrl: 'https://api.anthropic.com/v1' };
    now += 5_000;
    await bg.hooks.onComposerOpen();
    expect(bg.shouldShow.composer()).toBe(false);
    now += 30_000;
    await bg.hooks.onComposerOpen();
    expect(bg.shouldShow.composer()).toBe(true);
  });
});

describe('plugin wiring', () => {
  it('declares a slot or hook for each permission it asks for', () => {
    expect(Object.keys(plugin.slots)).toEqual(expect.arrayContaining(['composer-toolbar', 'plugin-dialog', 'settings-section']));
    expect(Object.keys(plugin.hooks)).toEqual(expect.arrayContaining(['onDraftChange', 'onComposerOpen', 'onComposerClose']));
    expect(manifest.permissions).toEqual(expect.arrayContaining(['email:read', 'ui:composer-toolbar']));
  });

  it('routes the hooks to the background after activate', async () => {
    const api = fakeApi({ handlers: configured });
    await plugin.activate(api);
    await plugin.hooks.onDraftChange({ subject: 'S', textBody: 'T' });
    expect(await api.storage.get(DRAFT_KEY)).toMatchObject({ text: 'T' });
    expect(plugin.slots['composer-toolbar'].shouldShow()).toBe(true);
  });
});
