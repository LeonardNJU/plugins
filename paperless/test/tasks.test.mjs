import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { createPoller, createTaskTracker, TASKS_KEY } from '../src/lib/tasks.js';
import { PaperlessError } from '../src/lib/errors.js';

function setup(answers, { now = () => 1000, idWaitMs } = {}) {
  const api = fakeApi();
  const done = [];
  const tracker = createTaskTracker({
    storage: api.storage,
    clientFor: async () => ({ task: async (id) => { const a = answers[id]; if (a instanceof Error) throw a; return a; } }),
    onDone: (entry, outcome) => done.push({ id: entry.taskId, ...outcome }),
    now,
    timeoutMs: 5000,
    ...(idWaitMs !== undefined ? { idWaitMs } : {}),
  });
  return { api, tracker, done };
}

describe('task tracker', () => {
  it('reports success and failure, and forgets finished tasks', async () => {
    const { api, tracker, done } = setup({
      a: { state: 'success', documentId: 7 },
      b: { state: 'failure', error: 'Unsupported mime type', duplicateOf: null },
      c: { state: 'pending' },
    });
    for (const id of ['a', 'b', 'c']) await tracker.add({ taskId: id, name: id, base: 'https://p', credentialId: 'shared' });
    expect(await tracker.pollOnce()).toBe(1);
    expect(done).toEqual([
      { id: 'a', state: 'success', documentId: 7 },
      { id: 'b', state: 'failure', error: 'Unsupported mime type', duplicateOf: null },
    ]);
    expect((await api.storage.get(TASKS_KEY)).map((e) => e.taskId)).toEqual(['c']);
  });

  it('gives up on a task that stays pending too long', async () => {
    let t = 1000;
    const { tracker, done } = setup({ a: { state: 'pending' } }, { now: () => t });
    await tracker.add({ taskId: 'a' });
    expect(await tracker.pollOnce()).toBe(1);
    t = 7000;
    expect(await tracker.pollOnce()).toBe(0);
    expect(done).toEqual([{ id: 'a', state: 'timeout' }]);
  });

  it('stops on a revoked token but keeps trying through a network error', async () => {
    const { tracker, done } = setup({ a: new PaperlessError('error.token'), b: new PaperlessError('error.unreachable') });
    await tracker.add({ taskId: 'a' });
    await tracker.add({ taskId: 'b' });
    expect(await tracker.pollOnce()).toBe(1);
    expect(done).toEqual([{ id: 'a', state: 'error', errorKey: 'error.token' }]);
  });

  it('keeps asking for the document id after success, and reports it once it is there', async () => {
    let t = 1000;
    const answers = { a: { state: 'success', documentId: null } };
    const { api, tracker, done } = setup(answers, { now: () => t, idWaitMs: 3000 });
    await tracker.add({ taskId: 'a' });
    expect(await tracker.pollOnce()).toBe(1);
    expect(done).toEqual([]);
    expect((await api.storage.get(TASKS_KEY))[0].succeededAt).toBe(1000);
    t = 2000;
    answers.a = { state: 'success', documentId: 12 };
    expect(await tracker.pollOnce()).toBe(0);
    expect(done).toEqual([{ id: 'a', state: 'success', documentId: 12 }]);
  });

  it('reports success without an id when the id never comes', async () => {
    let t = 1000;
    const { tracker, done } = setup({ a: { state: 'success', documentId: null } }, { now: () => t, idWaitMs: 3000 });
    await tracker.add({ taskId: 'a' });
    expect(await tracker.pollOnce()).toBe(1);
    t = 2000;
    expect(await tracker.pollOnce()).toBe(1);
    expect(done).toEqual([]);
    t = 4000;
    expect(await tracker.pollOnce()).toBe(0);
    expect(done).toEqual([{ id: 'a', state: 'success', documentId: null }]);
  });

  it('counts a filed task as filed, not timed out, when the overall time runs out first', async () => {
    let t = 1000;
    const answers = { a: { state: 'success', documentId: null } };
    const { tracker, done } = setup(answers, { now: () => t, idWaitMs: 60_000 });
    await tracker.add({ taskId: 'a' });
    await tracker.pollOnce();
    t = 7000;
    answers.a = new PaperlessError('error.unreachable');
    expect(await tracker.pollOnce()).toBe(0);
    expect(done).toEqual([{ id: 'a', state: 'success', documentId: null }]);
  });

  it('does not lose tasks added at the same time', async () => {
    const { tracker } = setup({});
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => tracker.add({ taskId: id })));
    expect((await tracker.pending()).map((e) => e.taskId).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('poller', () => {
  it('polls until nothing is open, fast first and then slower', async () => {
    const timers = [];
    let open = 3;
    const poller = createPoller({ pollOnce: async () => --open }, { setTimer: (fn, ms) => timers.push({ fn, ms }), fastMs: 1, slowMs: 9, fastFor: 1 });
    poller.start();
    poller.start(); // only one loop
    expect(timers).toHaveLength(1);
    while (timers.length) { const { fn } = timers.shift(); await fn(); }
    expect(open).toBe(0);
    expect(poller.running).toBe(false);
  });

  it('switches to the slow interval', async () => {
    const delays = [];
    const pending = [];
    let open = 4;
    const poller = createPoller({ pollOnce: async () => --open }, { setTimer: (fn, ms) => { delays.push(ms); pending.push(fn); }, fastMs: 1, slowMs: 9, fastFor: 2 });
    poller.start();
    while (pending.length) await pending.shift()();
    expect(delays).toEqual([1, 1, 9, 9]);
  });
});
