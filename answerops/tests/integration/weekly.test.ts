import { describe, it, expect, afterEach } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import * as repo from '../../src/db/repo/index.js';
import * as sched from '../../src/db/repo/unattended.js';
import { TestClock } from '../../src/domain/clock.js';
import { tick } from '../../src/services/scheduler.js';
import { enableWeekly, weeklyQuestions } from '../../src/services/weekly.js';
import type { ProviderAdapter } from '../../src/providers/types.js';
let db: DB;
afterEach(() => db?.close());
function fixture() {
  db = openDb(':memory:');
  const t = repo.createTenant(db, 'Test', 'operate');
  const b = repo.createBrand(db, t.id, 'Example', 'example.com', 'software');
  const c = repo.createCluster(db, t.id, b.id, {
    label: 'What does Example cost?',
    intent_family: 'pricing',
    buyer_stage: 'consideration',
    demand_volume: 10,
    demand_weight: 1,
    economic_value: 1,
    volatility: 0.3,
    demand_basis: 'estimated',
  });
  repo.createPromptVariant(db, t.id, c.id, c.label);
  const clock = new TestClock('2026-09-07T06:00:00Z');
  const s = enableWeekly(db, t.id, b.id, clock);
  return { t, b, c, s, clock };
}
const surface = {
  provider: 'openai',
  modelId: 'gpt-5.1',
  modelVersion: 'gpt-5.1',
  surface: 'api' as const,
  grounding: 'grounded_search' as const,
  searchMode: 'web_search',
  label: 'OpenAI',
};
function provider(calls: string[], simulated = false): ProviderAdapter {
  return {
    key: simulated ? 'simulated' : 'openai',
    displayName: 'Test',
    surfaces: [surface],
    available: () => true,
    run: async (r) => {
      calls.push(r.prompt);
      return {
        answerText: 'Example is a software company.',
        citations: [],
        searchQueries: [],
        latencyMs: 1,
        costUsd: 0.01,
        simulated,
        systemConfigHash: 'test',
        modelVersion: 'gpt-5.1',
      };
    },
  };
}
describe('weekly workflow', () => {
  it('plans before running, freezes the questions, runs live five times and does not repeat', async () => {
    const { t, s, clock } = fixture();
    sched.updateScheduleNextRun(db, t.id, s.id, clock.now().toISOString());
    const calls: string[] = [];
    await tick(db, { clock, providers: [provider(calls), provider(calls, true)] });
    expect(calls).toEqual([]);
    expect(db.prepare('SELECT status FROM weekly_jobs').get()).toEqual({ status: 'planned' });
    expect(weeklyQuestions(db, t.id, s.id)).toHaveLength(1);
    clock.advance(3600000);
    await tick(db, { clock, providers: [provider(calls), provider(calls, true)] });
    expect(calls).toHaveLength(5);
    const job = db.prepare('SELECT status,result FROM weekly_jobs').get() as any;
    expect(job.status).toBe('complete');
    expect(JSON.parse(job.result).samples).toBe(5);
    await tick(db, { clock, providers: [provider(calls)] });
    expect(calls).toHaveLength(5);
  });
  it('fails honestly when no live provider exists', async () => {
    const { t, s, clock } = fixture();
    sched.updateScheduleNextRun(db, t.id, s.id, clock.now().toISOString());
    await tick(db, { clock, providers: [] });
    clock.advance(3600000);
    await tick(db, { clock, providers: [] });
    const j = db.prepare('SELECT status,result FROM weekly_jobs').get() as any;
    expect(j.status).toBe('failed');
    expect(j.result).toContain('No live provider');
  });
  it('does not expose another tenant question set', () => {
    const { s } = fixture();
    expect(weeklyQuestions(db, 'other', s.id)).toEqual([]);
  });
});

describe('weekly reliability', () => {
  it('rejects simulated output even when an adapter claims to be live', async () => {
    const { t, s, clock } = fixture();
    sched.updateScheduleNextRun(db, t.id, s.id, clock.now().toISOString());
    const fake = provider([], true);
    fake.key = 'openai';
    await tick(db, { clock, providers: [fake] });
    clock.advance(3600000);
    await tick(db, { clock, providers: [fake] });
    const job = db.prepare('SELECT result,status FROM weekly_jobs').get() as any;
    expect(job.status).toBe('failed');
    expect(JSON.parse(job.result).samples).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM model_runs').get()).toEqual({ n: 0 });
  });
  it('freezes question text for a pending check despite underlying prompt edits', async () => {
    const { t, s, c, clock } = fixture();
    sched.updateScheduleNextRun(db, t.id, s.id, clock.now().toISOString());
    const calls: string[] = [];
    await tick(db, { clock, providers: [provider(calls)] });
    db.prepare('UPDATE prompt_variants SET prompt=? WHERE cluster_id=?').run('A different question?', c.id);
    clock.advance(3600000);
    await tick(db, { clock, providers: [provider(calls)] });
    expect(new Set(calls)).toEqual(new Set(['What does Example cost?']));
  });
  it('pausing prevents sampling', async () => {
    const { t, s, clock } = fixture();
    sched.updateScheduleNextRun(db, t.id, s.id, clock.now().toISOString());
    await tick(db, { clock, providers: [] });
    sched.setScheduleEnabled(db, t.id, s.id, 0);
    clock.advance(3600000);
    const calls: string[] = [];
    await tick(db, { clock, providers: [provider(calls)] });
    expect(calls).toEqual([]);
  });
  it('retries delivery with the same idempotency key without rerunning samples', async () => {
    const { t, s, clock } = fixture();
    db.prepare('UPDATE schedules SET weekly_email=? WHERE id=?').run('owner@example.com', s.id);
    sched.updateScheduleNextRun(db, t.id, s.id, clock.now().toISOString());
    const calls: string[] = [];
    const delivered: any[] = [];
    const email = {
      kind: 'email',
      send: async (p: any) => {
        delivered.push(p);
        return { ok: delivered.length > 1, error: delivered.length > 1 ? undefined : 'temporary failure' };
      },
    };
    await tick(db, { clock, providers: [provider(calls)], transports: { email } });
    expect(delivered).toHaveLength(1);
    await tick(db, { clock, providers: [provider(calls)], transports: { email } });
    expect(delivered).toHaveLength(1);
    clock.advance(3600000);
    await tick(db, { clock, providers: [provider(calls)], transports: { email } });
    expect(calls).toHaveLength(5);
    expect(delivered[0].idempotencyKey).toBe(delivered[1].idempotencyKey);
    expect(delivered).toHaveLength(3);
    await tick(db, { clock, providers: [provider(calls)], transports: { email } });
    expect(delivered).toHaveLength(3);
  });
});

it('marks a stale interrupted run failed instead of charging for it twice', async () => {
  const { t, s, clock } = fixture();
  const calls: string[] = [];
  sched.updateScheduleNextRun(db, t.id, s.id, clock.now().toISOString());
  await tick(db, { clock, providers: [provider(calls)] });
  db.prepare("UPDATE weekly_jobs SET status='running'").run();
  clock.advance(3600000);
  await tick(db, { clock, providers: [provider(calls)] });
  expect(calls).toEqual([]);
  expect((db.prepare('SELECT result FROM weekly_jobs').get() as any).result).toContain('Interrupted run');
});
it('recovers a missed week into an explicit failure and publishes the new week plan', async () => {
  const { t, s, clock } = fixture();
  sched.updateScheduleNextRun(db, t.id, s.id, clock.now().toISOString());
  await tick(db, { clock, providers: [] });
  clock.advanceDays(7);
  await tick(db, { clock, providers: [] });
  expect(db.prepare('SELECT status FROM weekly_jobs ORDER BY created_at').all()).toEqual([
    { status: 'failed' },
    { status: 'planned' },
  ]);
});
