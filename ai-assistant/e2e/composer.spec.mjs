import { test, expect } from '@playwright/test';
import { adminApi, install } from './admin.mjs';
import { installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import {
  ID, assistantButton, assistantDialog, configure, acceptPrivacy, composeWith, editor, editorText, openAssistant,
  OLLAMA_CONFIG, mockReadsChunked, ollamaUp,
} from './common.mjs';

// The composer: the Assistant button in the composer's bottom bar opens the
// assistant for the selection or the whole message; Replace and Insert
// below change the text in the real editor, in one undo step. Answers come
// from the test-env mocks (deterministic text) and from Ollama, which
// speaks both the OpenAI and the Anthropic API.

const MOCK_REPLY = /Mock reply\. You asked: .*This text comes from the Bulwark test mock\./s;
const DRAFT = 'hi bob, can we meet on tuesday? i has some questions';

const SERVICES = [
  {
    name: 'the Anthropic mock', theme: 'light', available: mockReadsChunked,
    config: {}, provider: 'Anthropic at localhost:18099 (model mock-claude)', answer: MOCK_REPLY,
  },
  {
    name: 'the OpenAI mock', theme: 'dark', available: mockReadsChunked,
    config: { anthropicBaseUrl: '', anthropicKey: '', openaiBaseUrl: 'http://localhost:18099/openai/v1', openaiKey: 'test-openai-key', openaiModel: 'mock-gpt-small', defaultProvider: 'openai' },
    provider: 'OpenAI-compatible at localhost:18099 (model mock-gpt-small)', answer: MOCK_REPLY,
  },
  {
    name: 'Ollama, OpenAI-compatible', theme: 'light', available: ollamaUp,
    config: { ...OLLAMA_CONFIG, defaultProvider: 'openai' }, provider: 'OpenAI-compatible at localhost:11434', answer: /\S{2,}/,
  },
  {
    name: 'Ollama, Anthropic Messages API', theme: 'dark', available: ollamaUp,
    config: { ...OLLAMA_CONFIG, defaultProvider: 'anthropic' }, provider: 'Anthropic at localhost:11434', answer: /\S{2,}/,
  },
];

const slug = (s) => s.replace(/\W+/g, '-').toLowerCase();

async function start(page, api, { config = {}, theme = 'light' } = {}) {
  await configure(api, config);
  await preparePage(page, { theme });
  await signIn(page);
  await waitForPlugin(page, ID);
}

for (const service of SERVICES) {
  test(`rewrite the whole message in the composer, and undo it, with ${service.name}`, async ({ page }) => {
    test.skip(!(await service.available()), `${service.name} is not reachable (see README)`);
    const api = await install(await adminApi(), ID, installPlugin);
    try {
      await start(page, api, service);
      await composeWith(page, DRAFT);
      const before = await editorText(page);

      const { box, frame } = await openAssistant(page);
      await expect(frame.getByText('Works on your whole message, without the signature and the quoted email:')).toBeVisible();
      await expect(frame.getByText(DRAFT)).toBeVisible();
      await frame.getByRole('radio', { name: 'More formal' }).click();
      await shoot(page, ID, `composer-choose-${slug(service.name)}`, service.theme);
      await box.getByRole('button', { name: 'Rewrite' }).click();
      await acceptPrivacy(page, { inDialog: true, expectText: service.provider });

      const replace = box.getByRole('button', { name: 'Replace' });
      await expect(replace).toBeEnabled({ timeout: 90_000 });
      const preview = frame.getByLabel('Suggested change');
      await expect(preview).toContainText(service.answer);
      // The change is marked: the old words struck out, the new ones added.
      await expect(preview.locator('ins').first()).toBeVisible();
      const suggested = (await preview.locator('span, ins').allInnerTexts()).join('').trim();
      await shoot(page, ID, `composer-preview-${slug(service.name)}`, service.theme);

      await replace.click();
      await expect(box).toHaveCount(0);
      const box1 = editor(page);
      // (The mock's answer quotes the draft, so check the text as a whole.)
      await expect.poll(() => editorText(page)).not.toBe(before);
      const firstLine = suggested.split('\n')[0].slice(0, 40);
      await expect(box1).toContainText(firstLine);

      // One Ctrl+Z takes the whole change back.
      await box1.click();
      await box1.press('ControlOrMeta+z');
      await expect.poll(() => editorText(page)).toBe(before);
    } finally {
      await uninstallPlugin(api, ID);
    }
  });
}

/** Fails when a plugin button in the composer bar lies on top of Discard or Send. */
async function expectNoOverlap(page) {
  const own = page.locator('[data-plugin-action]').filter({ visible: true });
  for (const mine of await own.all()) {
    const m = await mine.boundingBox();
    if (!m) continue;
    for (const name of ['Discard', 'Send']) {
      for (const other of await page.getByRole('button', { name, exact: true }).all()) {
        if (!(await other.isVisible())) continue;
        const o = await other.boundingBox();
        const overlaps = m.x < o.x + o.width && o.x < m.x + m.width && m.y < o.y + o.height && o.y < m.y + m.height;
        expect(overlaps, `a plugin button covers ${name}`).toBe(false);
      }
    }
  }
}

test('at 1280 px the assistant is in the Options menu, and nothing covers Discard or Send', async ({ page }) => {
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    await start(page, api);
    await composeWith(page, 'Hello there');
    await expectNoOverlap(page);
    await expect(assistantButton(page)).toBeHidden();
    await page.getByRole('button', { name: 'Options' }).last().click();
    await page.getByRole('menuitem', { name: /Assistant/ }).click();
    const { box } = assistantDialog(page);
    await expect(box).toBeVisible();
  } finally {
    await uninstallPlugin(api, ID);
  }
});

test('in a wide window the Assistant button is in the composer bar and opens the assistant', async ({ page }) => {
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await start(page, api);
    await composeWith(page, 'Hello there');
    await expect(assistantButton(page)).toBeVisible();
    await expect(assistantButton(page)).toContainText('Assistant');
    await expectNoOverlap(page);
    const { box } = await openAssistant(page, { click: true });
    await expect(box).toBeVisible();
  } finally {
    await uninstallPlugin(api, ID);
  }
});

test('translate a selected line and insert it below', async ({ page }) => {
  test.skip(!(await mockReadsChunked()), 'the mock does not read chunked bodies');
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    await start(page, api);
    await composeWith(page, 'Dear team,\nGuten Tag, wir sehen uns am Dienstag.');
    // Select the second line.
    const box1 = editor(page);
    await box1.press('End');
    await box1.press('Shift+Home');

    const { box, frame } = await openAssistant(page);
    await expect(frame.getByText('Works on the text you selected:')).toBeVisible();
    await expect(frame.getByText('Guten Tag, wir sehen uns am Dienstag.')).toBeVisible();
    await frame.getByRole('radio', { name: 'Translate' }).click();
    await frame.getByLabel('Translate into').selectOption('en');
    await box.getByRole('button', { name: 'Translate' }).click();
    await acceptPrivacy(page, { inDialog: true });
    const below = box.getByRole('button', { name: 'Insert below' });
    await expect(below).toBeEnabled({ timeout: 60_000 });
    await below.click();
    await expect(box).toHaveCount(0);

    const text = await editorText(page);
    const lines = text.split('\n').filter((l) => l.trim());
    // The selection is still there, the answer follows it.
    expect(lines[0]).toBe('Dear team,');
    expect(lines[1]).toBe('Guten Tag, wir sehen uns am Dienstag.');
    expect(lines[2]).toMatch(/^Mock reply\. You asked: .*Guten Tag/);
  } finally {
    await uninstallPlugin(api, ID);
  }
});

test('replace only the selection', async ({ page }) => {
  test.skip(!(await mockReadsChunked()), 'the mock does not read chunked bodies');
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    await start(page, api);
    await composeWith(page, 'Keep this line.\nchange this line please');
    const box1 = editor(page);
    await box1.press('End');
    await box1.press('Shift+Home');
    const { box, frame } = await openAssistant(page);
    await expect(frame.getByText('Works on the text you selected:')).toBeVisible();
    await frame.getByRole('radio', { name: 'Improve' }).click();
    await box.getByRole('button', { name: 'Rewrite' }).click();
    await acceptPrivacy(page, { inDialog: true });
    await expect(box.getByRole('button', { name: 'Replace' })).toBeEnabled({ timeout: 60_000 });
    await box.getByRole('button', { name: 'Replace' }).click();
    await expect(box).toHaveCount(0);
    const lines = (await editorText(page)).split('\n').filter((l) => l.trim());
    expect(lines[0]).toBe('Keep this line.');
    expect(lines[1]).toMatch(/^Mock reply\. You asked: .*change this line please/);
    expect(lines.join('\n')).not.toContain('\nchange this line please');
  } finally {
    await uninstallPlugin(api, ID);
  }
});

test('write an empty message from a description', async ({ page }) => {
  test.skip(!(await mockReadsChunked()), 'the mock does not read chunked bodies');
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    await start(page, api);
    await composeWith(page, '');
    const { box, frame } = await openAssistant(page);
    await frame.getByLabel('What should the email say?').fill('thank Anna for the workshop');
    await shoot(page, ID, 'composer-write', 'light');
    await box.getByRole('button', { name: 'Write', exact: true }).click();
    await acceptPrivacy(page, { inDialog: true });
    const insert = box.getByRole('button', { name: 'Insert', exact: true });
    await expect(insert).toBeEnabled({ timeout: 60_000 });
    await insert.click();
    await expect(box).toHaveCount(0);
    await expect(editor(page)).toContainText(/Mock reply\. You asked: "Instructions: thank Anna for the workshop/);
  } finally {
    await uninstallPlugin(api, ID);
  }
});

test('Discard stops a running answer and goes back to the choice', async ({ page }) => {
  test.skip(!(await ollamaUp()), 'Ollama is not running (test-env/up.ps1 -WithAI)');
  const api = await install(await adminApi(), ID, installPlugin);
  try {
    await start(page, api, { config: { ...OLLAMA_CONFIG, defaultProvider: 'openai' } });
    await composeWith(page, 'Thanks for the workshop, Anna. It was great.');
    const before = await editorText(page);
    const { box, frame } = await openAssistant(page);
    await frame.getByRole('radio', { name: 'Own instruction' }).click();
    await frame.getByLabel('Instruction').fill('make it a long letter with five paragraphs');
    await box.getByRole('button', { name: 'Rewrite' }).click();
    await acceptPrivacy(page, { inDialog: true });
    await expect(box.getByRole('button', { name: 'Replace' })).toBeDisabled();
    await expect(box.getByRole('button', { name: 'Insert below' })).toBeDisabled();
    await box.getByRole('button', { name: 'Discard' }).click();
    await expect(frame.getByRole('radio', { name: 'Own instruction' })).toBeVisible();
    await box.getByRole('button', { name: 'Cancel' }).click();
    await expect(box).toHaveCount(0);
    expect(await editorText(page)).toBe(before);
  } finally {
    await uninstallPlugin(api, ID);
  }
});

const ERRORS = [
  ['a rate limit with its wait time', { anthropicKey: 'rate-limited' }, /too many requests\. You can try again in [1-7] s\./],
  ['a refused key (Anthropic)', { anthropicKey: 'wrong-key' }, /didn't accept the API key/],
  ['a refused key (OpenAI)', { anthropicBaseUrl: '', openaiBaseUrl: 'http://localhost:18099/openai/v1', openaiKey: 'wrong-key', defaultProvider: 'openai' }, /didn't accept the API key/],
];

for (const [name, config, message] of ERRORS) {
  test(`explains ${name}`, async ({ page }) => {
    const api = await install(await adminApi(), ID, installPlugin);
    try {
      await start(page, api, { config });
      await composeWith(page, 'Hello there');
      const { box, frame } = await openAssistant(page);
      await box.getByRole('button', { name: 'Rewrite' }).click();
      await acceptPrivacy(page, { inDialog: true });
      await expect(frame.getByRole('alert').filter({ hasText: message })).toBeVisible();
      await expect(box.getByRole('button', { name: 'Replace' })).toBeDisabled();
      if (name.startsWith('a rate limit')) {
        await expect(frame.getByRole('button', { name: 'Try again' })).toBeDisabled();
        await shoot(page, ID, 'composer-rate-limit', 'light');
        await expect(frame.getByRole('button', { name: 'Try again' })).toBeEnabled({ timeout: 10_000 });
      }
    } finally {
      await uninstallPlugin(api, ID);
    }
  });
}
