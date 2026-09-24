/**
 * Every sampling run is paid, so the JSON route that starts one bounds its budget like the console form does:
 * at least 5 answers and at most 600, and 60 when the budget is missing or not a number.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runSamplingRound, type SampleRoundResult } from '../../src/services/observatory.js';
import { makeHarness, postJson, type Harness } from './helpers.js';

// Calls through while the harness seeds; the test then records each budget instead of sampling it.
vi.mock('../../src/services/observatory.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/services/observatory.js')>();
  return { ...original, runSamplingRound: vi.fn(original.runSamplingRound) };
});
const sampled = vi.mocked(runSamplingRound);

let h: Harness;
beforeAll(async () => {
  h = await makeHarness();
  sampled.mockClear();
  sampled.mockImplementation(async () => ({ runsCreated: 0 }) as SampleRoundResult);
});
afterAll(async () => {
  await h.app.close();
  h.db.close();
});

describe('POST /api/runs/sample', () => {
  it('holds the budget to the bounds of the /sampling/run form', async () => {
    const cases: Array<[unknown, number]> = [[100000, 600], [250, 250], [1, 5], ['lots', 60], [undefined, 60]];
    for (const [budget, expected] of cases) {
      const res = await postJson(h.app, '/api/runs/sample', h.cookie, { budget });
      expect(res.statusCode, String(budget)).toBeLessThan(300);
      expect(sampled.mock.calls.at(-1)?.[1].budget, String(budget)).toBe(expected);
    }
    expect(sampled).toHaveBeenCalledTimes(cases.length);
  });
});
