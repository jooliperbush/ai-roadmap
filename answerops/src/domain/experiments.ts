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
import {
  parallelTrends,
  versionChangeExplanation,
  type PreWindow,
  type VersionGroup,
  type TrendCheck,
} from './sequential.js';

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
  const treatment = {
    preK: counts.baselineK,
    preN: counts.baselineN,
    postK: counts.postK,
    postN: counts.postN,
  };
  const controlAvailable = hasControl && (counts.controlBaselineN ?? 0) > 0 && (counts.controlPostN ?? 0) > 0;
  const controlArm = controlAvailable
    ? {
        preK: counts.controlBaselineK ?? 0,
        preN: counts.controlBaselineN ?? 0,
        postK: counts.controlPostK ?? 0,
        postN: counts.controlPostN ?? 0,
      }
    : null;
  const baseline = measure(treatment.preK, treatment.preN),
    post = measure(treatment.postK, treatment.postN);
  const control = controlArm
    ? {
        baseline: measure(controlArm.preK, controlArm.preN),
        post: measure(controlArm.postK, controlArm.postN),
      }
    : null;
  const rawDelta =
    treatment.preN > 0 && treatment.postN > 0
      ? treatment.postK / treatment.postN - treatment.preK / treatment.preN
      : 0;
  const didEffect = differenceInDifferences(treatment, controlArm);
  const test = controlArm
    ? didTest(treatment, controlArm)
    : twoProportionTest(treatment.preK, treatment.preN, treatment.postK, treatment.postN);
  const pReal = Math.max(0, Math.min(1, 1 - test.pValueOneSided));
  const underpowered = Math.min(treatment.preN, treatment.postN) < MIN_SAMPLES;
  const trends =
    controlArm && (counts.preWindows?.length ?? 0) >= 2 ? parallelTrends(counts.preWindows!) : null;
  const trendsBroken = trends !== null && !trends.parallel;
  const effect = controlArm ? didEffect : rawDelta;
  const clearsMinimumEffect = Math.abs(effect) >= MIN_EFFECT;
  const actionable = !underpowered && !trendsBroken && test.pValue < ALPHA && clearsMinimumEffect;
  const verdict: ExperimentVerdict =
    actionable && effect > 0 ? 'confirmed' : actionable && effect < 0 ? 'rejected' : 'inconclusive';
  const versionNote = counts.postVersions ? versionChangeExplanation(counts.postVersions) : null;
  const alternatives = [
    versionNote,
    trendsBroken ? trends!.reason : null,
    underpowered
      ? 'Sample sizes below the ' + MIN_SAMPLES + '-run floor cannot support a causal reading.'
      : null,
    controlAvailable
      ? null
      : 'No matched control cluster was available, so a category-wide movement cannot be separated from your change.',
    ...BASE_ALTERNATIVES,
  ].filter((item): item is string => item !== null);
  const percent = (point: number | null) => (point === null ? 'n/a' : Math.round(point * 100) + '%');
  const movement = 'Moved from ' + percent(baseline.point) + ' to ' + percent(post.point);
  let narrative =
    movement + ', which this sample cannot distinguish from noise (p=' + test.pValue.toFixed(3) + ').';
  if (verdict === 'confirmed')
    narrative =
      'Rose from ' +
      percent(baseline.point) +
      ' to ' +
      percent(post.point) +
      (controlAvailable ? ' while matched controls moved ' + signed(controlDelta(counts)) : '') +
      '; probability the improvement is real: ' +
      Math.round(pReal * 100) +
      '%.';
  else if (verdict === 'rejected') narrative = movement + ' — the change did not help and may have hurt.';
  else if (trendsBroken)
    narrative =
      movement +
      ', but treatment and control were not on parallel paths before the change (worst pre-period gap ' +
      Math.round(trends!.divergence * 100) +
      ' points), so this cannot be read as caused by the edit.';
  else if (controlAvailable && test.pValue < ALPHA && !clearsMinimumEffect)
    narrative =
      movement +
      ', but matched controls moved ' +
      signed(controlDelta(counts)) +
      ' over the same window — a residual of ' +
      Math.round(didEffect * 100) +
      ' points, below the ' +
      Math.round(MIN_EFFECT * 100) +
      '-point bar for claiming a win.';
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
  return (
    (counts.controlPostK ?? 0) / counts.controlPostN -
    (counts.controlBaselineK ?? 0) / counts.controlBaselineN
  );
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
