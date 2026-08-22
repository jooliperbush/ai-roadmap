/**
 * Measures the extractor against the held-out gold set and writes docs/extractor-eval.json.
 *
 * This is the most load-bearing number in the product and until now nothing measured it. A
 * defect alert is a claim about a customer's answers; if the layer that reads those answers is
 * 70% precise, one alert in three is an accusation about something the model never said.
 *
 * Exits non-zero on a gate breach so this can sit in CI. Predicates below the precision gate
 * are not deleted — they are marked recall-only, which means they still surface in the
 * drill-down and never page anyone.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { proposeClaims, patternProposer, heuristicProposer, PRECISION_GATE, RECALL_LIFT_GATE } from '../src/domain/extractor.js';
import { normalizeKey } from '../src/domain/truth.js';

interface Expected { predicate: string; object: string; polarity: 'affirm' | 'negate' }
interface GoldEntry { id: string; text: string; brand: string; expected: Expected[]; split: string; origin: string }

const gold = JSON.parse(readFileSync('tests/fixtures/gold-set.json', 'utf8')) as { brand: string; entries: GoldEntry[] };

/** Objects match when they normalise equal, or when one contains the other. */
function objectMatch(a: string, b: string): boolean {
  const x = normalizeKey(a);
  const y = normalizeKey(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

interface Counts { tp: number; fp: number; fn: number }

export function evaluate(entries: GoldEntry[], proposers: Array<typeof patternProposer>): {
  overall: Counts;
  byPredicate: Record<string, Counts>;
} {
  const overall: Counts = { tp: 0, fp: 0, fn: 0 };
  const byPredicate: Record<string, Counts> = {};
  const bump = (p: string, field: keyof Counts) => {
    byPredicate[p] = byPredicate[p] ?? { tp: 0, fp: 0, fn: 0 };
    byPredicate[p][field]++;
    overall[field]++;
  };

  for (const entry of entries) {
    const found = proposeClaims(entry.text, entry.brand, { proposers }).map((p) => p.claim);
    const usedExpected = new Set<number>();
    const usedFound = new Set<number>();

    for (let ei = 0; ei < entry.expected.length; ei++) {
      const e = entry.expected[ei];
      const fi = found.findIndex(
        (f, i) => !usedFound.has(i) && f.predicate === e.predicate && f.polarity === e.polarity && objectMatch(f.object, e.object),
      );
      if (fi >= 0) {
        usedExpected.add(ei);
        usedFound.add(fi);
        bump(e.predicate, 'tp');
      }
    }
    for (let ei = 0; ei < entry.expected.length; ei++) {
      if (!usedExpected.has(ei)) bump(entry.expected[ei].predicate, 'fn');
    }
    for (let fi = 0; fi < found.length; fi++) {
      if (!usedFound.has(fi)) bump(found[fi].predicate, 'fp');
    }
  }
  return { overall, byPredicate };
}

export function precision(c: Counts): number {
  return c.tp + c.fp === 0 ? 1 : c.tp / (c.tp + c.fp);
}
export function recall(c: Counts): number {
  return c.tp + c.fn === 0 ? 1 : c.tp / (c.tp + c.fn);
}
export function f1(c: Counts): number {
  const p = precision(c);
  const r = recall(c);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

const holdout = gold.entries.filter((e) => e.split === 'holdout');
const patternOnly = evaluate(holdout, [patternProposer]);
const twoStage = evaluate(holdout, [patternProposer, heuristicProposer]);

const recallLift = recall(twoStage.overall) - recall(patternOnly.overall);

const perPredicate = Object.entries(twoStage.byPredicate)
  .map(([predicate, c]) => ({
    predicate,
    precision: Number(precision(c).toFixed(4)),
    recall: Number(recall(c).toFixed(4)),
    f1: Number(f1(c).toFixed(4)),
    support: c.tp + c.fn,
    recallOnly: precision(c) < PRECISION_GATE,
  }))
  .sort((a, b) => a.predicate.localeCompare(b.predicate));

const report = {
  // The date is passed in rather than read from the clock so a rebuild is reproducible;
  // CI supplies it, and /methodology renders whatever is here.
  evaluatedAt: process.env.EVAL_DATE ?? new Date().toISOString().slice(0, 10),
  goldSetSize: gold.entries.length,
  holdoutSize: holdout.length,
  distractors: gold.entries.filter((e) => e.expected.length === 0).length,
  predicates: perPredicate.length,
  gates: { precision: PRECISION_GATE, recallLift: RECALL_LIFT_GATE },
  patternOnly: {
    precision: Number(precision(patternOnly.overall).toFixed(4)),
    recall: Number(recall(patternOnly.overall).toFixed(4)),
    f1: Number(f1(patternOnly.overall).toFixed(4)),
  },
  twoStage: {
    precision: Number(precision(twoStage.overall).toFixed(4)),
    recall: Number(recall(twoStage.overall).toFixed(4)),
    f1: Number(f1(twoStage.overall).toFixed(4)),
  },
  recallLift: Number(recallLift.toFixed(4)),
  recallOnlyPredicates: perPredicate.filter((p) => p.recallOnly).map((p) => p.predicate),
  perPredicate,
  // Stated on /methodology verbatim. A perfect score against a set the same people wrote is
  // evidence of internal consistency, not of accuracy on text nobody anticipated.
  caveat:
    'This gold set was authored alongside the extractor, so it measures whether the extractor does what its '
    + 'authors intended, not how it behaves on phrasings nobody anticipated. Numbers at or near 1.00 should be '
    + 'read as "no known regression", not as accuracy in the field. The number that would mean something is the '
    + 'same evaluation against answers sampled from live models and labelled by someone who did not write these '
    + 'rules; until that exists, treat the alerting precision gate as unverified against real traffic.',
};

// EVAL_OUT lets a test re-run this without racing the file the app reads.
const outPath = process.env.EVAL_OUT ?? 'docs/extractor-eval.json';
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

const rows = perPredicate.map((p) => `  ${p.predicate.padEnd(18)} P=${p.precision.toFixed(2)} R=${p.recall.toFixed(2)} F1=${p.f1.toFixed(2)} n=${p.support}${p.recallOnly ? '  [recall-only]' : ''}`);
console.log(`gold set ${report.goldSetSize} entries, ${report.holdoutSize} held out, ${report.distractors} distractors`);
console.log(`pattern only : P=${report.patternOnly.precision.toFixed(3)} R=${report.patternOnly.recall.toFixed(3)}`);
console.log(`two stage    : P=${report.twoStage.precision.toFixed(3)} R=${report.twoStage.recall.toFixed(3)}`);
console.log(`recall lift  : ${(recallLift * 100).toFixed(1)} points`);
console.log(rows.join('\n'));

const failures: string[] = [];
if (report.twoStage.precision < PRECISION_GATE) {
  failures.push(`overall precision ${report.twoStage.precision} is below the ${PRECISION_GATE} gate`);
}
if (recallLift < RECALL_LIFT_GATE) {
  failures.push(`recall lift ${(recallLift * 100).toFixed(1)} points is below the ${RECALL_LIFT_GATE * 100}-point gate`);
}
if (failures.length) {
  console.error(`\nGATE BREACH:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\ngates passed');
