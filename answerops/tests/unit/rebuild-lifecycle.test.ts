import { describe, expect, test } from 'vitest';
import { runtimeConfig } from '../../src/runtime/config.js';
import { BackgroundTasks } from '../../src/runtime/tasks.js';

describe('runtime ownership', () => {
  test('defaults preserve the local deployment contract', () => {
    expect(runtimeConfig({})).toMatchObject({
      port: 4300,
      dbPath: 'data/miscited.sqlite',
      scheduler: true,
      tickMs: 60000,
      fetchMode: 'http',
    });
    expect(runtimeConfig({ RAILWAY_ENVIRONMENT: 'production' }).dbPath).toBe('/data/miscited.sqlite');
  });
  test('rejects invalid ports and worker intervals before opening a database', () => {
    for (const PORT of ['nope', '-1', '65536', '3.5']) expect(() => runtimeConfig({ PORT })).toThrow();
    expect(() => runtimeConfig({ MISCITED_TICK_MS: '0' })).toThrow();
  });
  test('offline and demo switches are explicit', () => {
    expect(runtimeConfig({ MISCITED_NO_SCHEDULER: '1', MISCITED_NO_FETCH: '1' })).toMatchObject({
      scheduler: false,
      fetchMode: 'off',
    });
    expect(runtimeConfig({ MISCITED_DEMO_FETCH: '1' }).fetchMode).toBe('demo');
  });
  test('shutdown waits for owned background work', async () => {
    const tasks = new BackgroundTasks();
    let release!: () => void;
    let drained = false;
    tasks.track(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const closing = tasks.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await closing;
    expect(drained).toBe(true);
  });
  test('one failed job does not stop draining the others', async () => {
    const tasks = new BackgroundTasks();
    tasks.track(Promise.reject(new Error('upstream failed')));
    await expect(tasks.drain()).resolves.toBeUndefined();
  });
});
