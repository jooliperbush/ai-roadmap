/**
 * Experiment ledger analysis.
 *
 * "We changed the page and the number went up" is not evidence. This produces a verdict with
 * a control comparison, a p-value, an explicit power check, and the alternative explanations
 * we could not rule out — every time, including when the answer is inconvenient.
 */

import {
  ALPHA,
  MIN_EFFECT,
  MIN_SAMPLES,
  differenceInDifferences,
  didTest,
  probabilityReal,
  twoProportionTest,
  measure,
  Measurement,
} from './stats.js';
import { parallelTrends, versionChangeExplanation, type PreWindow, type VersionGroup, type TrendCheck } from './sequential.js';

export type ExperimentVerdict = 'pending' | 'confirmed' | 'rejected' | 'inconclusive';

export interface ExperimentCounts {
  baselineK: number;
  baselineN: number;
  postK: number;
  postN: number;
  controlBaselineK?: number | null;
  controlBaselineN?: number | null;
  controlPostK?: number | null;
  controlPostN?: number | null;
  /** pre-intervention windows, oldest first, used to test the parallel-trends assumption */
  preWindows?: PreWindow[];
  /** per-model-version breakdown of the post window, used to refuse pooling across versions */
  postVersions?: VersionGroup[];
}

export interface ExperimentAnalysis {
  baseline: Measurement;
  post: Measurement;
  control: { baseline: Measurement; post: Measurement } | null;
  rawDelta: number;
  didEffect: number;
  pValue: number;
  probabilityReal: number;
  verdict: ExperimentVerdict;
  underpowered: boolean;
  alternativeExplanations: string[];
  narrative: string;
  /** null when there is no control, so parallel trends is not a question that applies */
  trends: TrendCheck | null;
  versionsPooled: boolean;
}

const BASE_ALTERNATIVES = [
  'A provider model or version change during the window could move answers independently of your edit.',
  'Seasonality or a news cycle could shift what grounded search surfaces.',
  'A competitor publishing or removing content changes the retrieval pool you compete in.',
  'Sampling drift: the prompt variants or geos exercised may not be identical across windows.',
];

export function analyzeExperiment(counts: ExperimentCounts, hasControl: boolean): ExperimentAnalysis {
  const baseline = measure(counts.baselineK, counts.baselineN);
  const post = measure(counts.postK, counts.postN);

  const controlAvailable =
    hasControl &&
    counts.controlBaselineN != null &&
    counts.controlPostN != null &&
    counts.controlBaselineN > 0 &&
    counts.controlPostN > 0;

  const control = controlAvailable
    ? {
        baseline: measure(counts.controlBaselineK ?? 0, counts.controlBaselineN ?? 0),
        post: measure(counts.controlPostK ?? 0, counts.controlPostN ?? 0),
      }
    : null;

  const rawDelta =
    counts.baselineN > 0 && counts.postN > 0 ? counts.postK / counts.postN - counts.baselineK / counts.baselineN : 0;

  const didEffect = differenceInDifferences(
    { preK: counts.baselineK, preN: counts.baselineN, postK: counts.postK, postN: counts.postN },
    controlAvailable
      ? {
          preK: counts.controlBaselineK ?? 0,
          preN: counts.controlBaselineN ?? 0,
          postK: counts.controlPostK ?? 0,
          postN: counts.controlPostN ?? 0,
        }
      : null,
  );

  const rawTest = twoProportionTest(counts.baselineK, counts.baselineN, counts.postK, counts.postN);
  const underpowered = counts.baselineN < MIN_SAMPLES || counts.postN < MIN_SAMPLES;

  // With a control, every number a customer sees comes from the controlled comparison —
  // including "probability the improvement is real". Reporting a confident probability from
  // the raw movement beside an inconclusive verdict is precisely the misreading this
  // product exists to prevent.
  const controlled = controlAvailable
    ? didTest(
        { preK: counts.baselineK, preN: counts.baselineN, postK: counts.postK, postN: counts.postN },
        {
          preK: counts.controlBaselineK ?? 0, preN: counts.controlBaselineN ?? 0,
          postK: counts.controlPostK ?? 0, postN: counts.controlPostN ?? 0,
        },
      )
    : null;

  const test = { pValue: controlled ? controlled.pValue : rawTest.pValue };
  const pReal = controlled
    ? Math.min(1, Math.max(0, 1 - controlled.pValueOneSided))
    : probabilityReal(counts.baselineK, counts.baselineN, counts.postK, counts.postN);

  // When a control exists, the verdict rests on the difference-in-differences, not on the
  // treatment's raw movement. A treatment that rose 25 points while its matched control rose
  // 15 is a category-wide shift with a 10-point residual — not a 25-point win, and not
  // something to put in front of a customer as one.
  const effectForVerdict = controlAvailable ? didEffect : rawDelta;
  const clearsMinimumEffect = Math.abs(effectForVerdict) >= MIN_EFFECT;

  // Difference-in-differences is only causal if the two arms were already moving together.
  // We have the pre-periods, so we check rather than assume, and a visible pre-trend
  // divergence downgrades the verdict the same way being underpowered does.
  const trends = controlAvailable && counts.preWindows && counts.preWindows.length >= 2
    ? parallelTrends(counts.preWindows)
    : null;
  const trendsBroken = trends !== null && !trends.parallel;

  let verdict: ExperimentVerdict;
  if (underpowered) verdict = 'inconclusive';
  else if (trendsBroken) verdict = 'inconclusive';
  else if (test.pValue < ALPHA && clearsMinimumEffect && effectForVerdict > 0) verdict = 'confirmed';
  else if (test.pValue < ALPHA && clearsMinimumEffect && effectForVerdict < 0) verdict = 'rejected';
  else verdict = 'inconclusive';

  const alternatives = [...BASE_ALTERNATIVES];
  if (!controlAvailable) {
    alternatives.unshift(
      'No matched control cluster was available, so a category-wide movement cannot be separated from your change.',
    );
  }
  if (underpowered) {
    alternatives.unshift(`Sample sizes below the ${MIN_SAMPLES}-run floor cannot support a causal reading.`);
  }
  if (trendsBroken && trends) alternatives.unshift(trends.reason);
  const versionNote = counts.postVersions ? versionChangeExplanation(counts.postVersions) : null;
  if (versionNote) alternatives.unshift(versionNote);

  const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
  const narrative =
    verdict === 'confirmed'
      ? `Rose from ${pct(baseline.point)} to ${pct(post.point)}${controlAvailable ? ` while matched controls moved ${signed(controlDelta(counts))}` : ''}; probability the improvement is real: ${Math.round(pReal * 100)}%.`
      : verdict === 'rejected'
        ? `Moved from ${pct(baseline.point)} to ${pct(post.point)} — the change did not help and may have hurt.`
        : trendsBroken && trends
          ? `Moved from ${pct(baseline.point)} to ${pct(post.point)}, but treatment and control were not on parallel paths before the change (worst pre-period gap ${Math.round(trends.divergence * 100)} points), so this cannot be read as caused by the edit.`
          : controlAvailable && test.pValue < ALPHA && !clearsMinimumEffect
          ? `Moved from ${pct(baseline.point)} to ${pct(post.point)}, but matched controls moved ${signed(controlDelta(counts))} over the same window — a residual of ${Math.round(didEffect * 100)} points, below the ${Math.round(MIN_EFFECT * 100)}-point bar for claiming a win.`
          : `Moved from ${pct(baseline.point)} to ${pct(post.point)}, which this sample cannot distinguish from noise (p=${test.pValue.toFixed(3)}).`;

  return {
    baseline,
    post,
    control,
    rawDelta,
    didEffect,
    pValue: test.pValue,
    probabilityReal: pReal,
    verdict,
    underpowered,
    alternativeExplanations: alternatives,
    narrative,
    trends,
    versionsPooled: (counts.postVersions?.length ?? 0) > 1,
  };
}

function controlDelta(counts: ExperimentCounts): number {
  if (!counts.controlBaselineN || !counts.controlPostN) return 0;
  return (counts.controlPostK ?? 0) / counts.controlPostN - (counts.controlBaselineK ?? 0) / counts.controlBaselineN;
}

function signed(x: number): string {
  const pct = Math.round(x * 100);
  return `${pct >= 0 ? '+' : ''}${pct} points`;
}

/**
 * Business outcomes are attached to experiments but never presented as attribution.
 * AI referrers do not reveal the originating conversation; anyone selling prompt-level
 * revenue attribution as exact is selling churn.
 */
export const OUTCOME_CAVEAT =
  'Correlational. AI assistants rarely pass the originating conversation, and assistant referrals ' +
  'remain a small share of tracked traffic, so this is directional evidence — not attribution.';
