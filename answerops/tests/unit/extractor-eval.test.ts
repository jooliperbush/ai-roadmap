/**
 * The published accuracy numbers.
 *
 * This is the most load-bearing unmeasured number in the product, so the gate lives in the
 * test suite rather than only in a script somebody remembers to run.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRECISION_GATE, RECALL_LIFT_GATE } from '../../src/domain/extractor.js';

const EVAL_PATH = 'docs/extractor-eval.json';
const GOLD_PATH = 'tests/fixtures/gold-set.json';

function report(): any {
  expect(existsSync(EVAL_PATH), 'run npm run eval:extractor').toBe(true);
  return JSON.parse(readFileSync(EVAL_PATH, 'utf8'));
}

describe('the gold set', () => {
  const gold = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));

  it('covers every predicate the extractor can propose', () => {
    const covered = new Set(gold.entries.flatMap((e: any) => e.expected.map((x: any) => x.predicate)));
    expect(covered.size).toBeGreaterThanOrEqual(16);
  });

  it('contains distractors, so it measures precision and not only recall', () => {
    const distractors = gold.entries.filter((e: any) => e.expected.length === 0);
    expect(distractors.length, 'a gold set of only positives measures recall and calls it accuracy')
      .toBeGreaterThanOrEqual(40);
  });

  it('holds out roughly a third, deterministically', () => {
    const holdout = gold.entries.filter((e: any) => e.split === 'holdout').length;
    expect(holdout / gold.entries.length).toBeGreaterThan(0.25);
    expect(holdout / gold.entries.length).toBeLessThan(0.4);
  });

  it('labels the origin of every entry', () => {
    for (const e of gold.entries) expect(['handwritten', 'systematic']).toContain(e.origin);
  });
});

describe('the published evaluation', () => {
  it('exists and reports both stages', () => {
    const r = report();
    expect(r.patternOnly.recall).toBeGreaterThan(0);
    expect(r.twoStage.recall).toBeGreaterThanOrEqual(r.patternOnly.recall);
  });

  it('meets the precision gate', () => {
    expect(report().twoStage.precision).toBeGreaterThanOrEqual(PRECISION_GATE);
  });

  it('meets the recall-lift gate that justifies the second stage existing', () => {
    expect(report().recallLift).toBeGreaterThanOrEqual(RECALL_LIFT_GATE);
  });

  it('marks any predicate below the precision gate as recall-only', () => {
    const r = report();
    for (const p of r.perPredicate) {
      expect(p.recallOnly).toBe(p.precision < PRECISION_GATE);
    }
    expect(r.recallOnlyPredicates.sort()).toEqual(
      r.perPredicate.filter((p: any) => p.recallOnly).map((p: any) => p.predicate).sort(),
    );
  });

  it('carries the caveat that a self-authored gold set is not field accuracy', () => {
    const r = report();
    expect(r.caveat).toMatch(/authored alongside the extractor/);
    expect(r.caveat).toMatch(/unverified against real traffic/);
  });

  it('is not older than ninety days', () => {
    const r = report();
    const age = (Date.now() - Date.parse(r.evaluatedAt)) / 86_400_000;
    expect(age, 'a published accuracy figure that has stopped being re-measured is a claim, not a measurement')
      .toBeLessThan(90);
  });

  it('is reproducible: re-running the eval produces the same numbers', () => {
    const before = readFileSync(EVAL_PATH, 'utf8');
    const out = join(tmpdir(), `miscited-eval-${process.pid}.json`);
    // Written elsewhere so this never races the file the app reads while other tests run.
    execFileSync('npx', ['tsx', 'scripts/eval-extractor.mts'], {
      stdio: 'ignore',
      env: { ...process.env, EVAL_DATE: JSON.parse(before).evaluatedAt, EVAL_OUT: out },
    });
    expect(readFileSync(out, 'utf8')).toBe(before);
    rmSync(out, { force: true });
  });
});
