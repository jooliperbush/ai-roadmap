/**
 * What a critical alert says about the checks behind it: the rules alone, both checks, or the
 * model check alone. It never claims two checks when only one ran.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import { seed, type SeedInfo } from '../../src/seed.js';
import * as sched from '../../src/db/repo/unattended.js';
import { runSamplingRound } from '../../src/services/observatory.js';
import { buildDashboard } from '../../src/services/dashboard.js';
import { generateAlerts } from '../../src/services/alerts.js';
import { TestClock } from '../../src/domain/clock.js';
import { CHECK_COPY } from '../../src/domain/jev.js';
import { SimulatedProvider } from '../../src/providers/simulated.js';
import { VANAR_AFTER } from '../../seed/simulation.js';

let db: DB;
let info: SeedInfo;
let clock: TestClock;

beforeEach(async () => {
  db = openDb(':memory:');
  info = await seed(db);
  clock = new TestClock('2026-06-01T05:00:00.000Z');
  await runSamplingRound(db, {
    tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'w-post', budget: 200,
    actor: 'test', beliefs: VANAR_AFTER, providers: [new SimulatedProvider()], clock, seedOffset: 999,
  });
});

function criticalDetails(): string[] {
  db.prepare('DELETE FROM alerts').run();
  const data = buildDashboard(db, info.tenantId, info.brandId, 'w-post');
  generateAlerts(db, info.tenantId, info.brandId, 'w-post', data, clock);
  return sched
    .listAlertsFor(db, info.tenantId, info.brandId)
    .filter((alert) => alert.kind === 'critical_defect')
    .map((alert) => alert.detail);
}

/** Rewrite every rules-only verdict as if the model check had run on it. */
function recordModelCheck(adjudication: string, votes: string) {
  db.prepare(`UPDATE observed_claims SET adjudication = ?, evaluator_votes = ${votes} WHERE adjudication = 'rules_only'`).run(adjudication);
}
const RULES_VOTE = "json_object('evaluator', 'rules', 'verdict', verdict)";
const JEV_VOTE = "json_object('evaluator', 'jev', 'verdict', verdict, 'confidence', 0.93, 'model', 'jev-test')";

describe('the checks named in a critical alert', () => {
  it('says the rules decided alone when the model check did not run', () => {
    const details = criticalDetails();
    expect(details.length).toBeGreaterThan(0);
    for (const detail of details) {
      expect(detail).toContain(CHECK_COPY.rules_only);
      expect(detail).not.toMatch(/two independent|evaluators|Jev model judgment/i);
    }
  });

  it('says both checks agreed only when both votes are on record', () => {
    recordModelCheck('agreed', `json_array(${RULES_VOTE}, ${JEV_VOTE})`);
    const details = criticalDetails();
    expect(details.length).toBeGreaterThan(0);
    for (const detail of details) expect(detail).toContain(CHECK_COPY.agreed);
  });

  it('says the model check decided when it overruled a different rules verdict', () => {
    recordModelCheck('model_decided', `json_array(json_object('evaluator', 'rules', 'verdict', 'STALE'), ${JEV_VOTE})`);
    const details = criticalDetails();
    expect(details.length).toBeGreaterThan(0);
    for (const detail of details) expect(detail).toContain(CHECK_COPY.model_decided);
  });

  it('says the model check alone found a defect the rules did not flag', () => {
    recordModelCheck('model_decided', `json_array(${JEV_VOTE})`);
    const details = criticalDetails();
    expect(details.length).toBeGreaterThan(0);
    for (const detail of details) {
      expect(detail).toContain(CHECK_COPY.model_found);
      expect(detail).not.toContain(CHECK_COPY.agreed);
    }
  });

  it('counts each kind when the statements behind one alert were checked differently', () => {
    db.prepare(
      `UPDATE observed_claims SET adjudication = 'agreed', evaluator_votes = json_array(${RULES_VOTE}, ${JEV_VOTE})
       WHERE adjudication = 'rules_only' AND rowid % 2 = 0`,
    ).run();
    const details = criticalDetails();
    expect(details.some((detail) => /Checks behind these \d+ statements: \d+ confirmed by both the registry rules and the Jev model check; \d+ rule-based check only, model check unavailable\./.test(detail))).toBe(true);
  });
});
