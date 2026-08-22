/**
 * Statistics that survive daily peeking.
 *
 * Benjamini-Hochberg controls the false discovery rate *within a round*. Customers sample
 * every day and look every day, which is a different problem: peeking repeatedly at the same
 * hypothesis inflates the false positive rate no matter how good the per-round correction is.
 * Ninety looks at a true null with a 5% per-look test does not give you 5% error, it gives you
 * most of a certainty that you will alert on nothing.
 *
 * The fix is an always-valid test. We use e-values: each look produces a likelihood ratio
 * against the null, the product accumulates across looks, and Ville's inequality guarantees
 * that under the null the probability the running product ever exceeds 1/alpha is at most
 * alpha. That holds for any stopping rule, including "look every morning until it fires",
 * which is exactly what a human does with a dashboard.
 */

export const E_ALPHA = 0.05;

export interface Look {
  k: number;
  n: number;
}

/**
 * E-value for one look, mixing over the alternative with a beta-binomial mixture. The mixture
 * is what makes this powered against a range of effects rather than one guessed effect size.
 *
 * m(k, n) = B(a+k, b+n-k) / B(a, b)  is the marginal likelihood under a Beta(a,b) prior on p.
 * The e-value is that marginal divided by the null likelihood p0^k (1-p0)^(n-k).
 */
export function evalue(k: number, n: number, p0: number, a = 1, b = 1): number {
  if (n <= 0) return 1;
  const p = Math.min(Math.max(p0, 1e-9), 1 - 1e-9);
  const logNull = k * Math.log(p) + (n - k) * Math.log(1 - p);
  const logMarginal = logBeta(a + k, b + n - k) - logBeta(a, b);
  const logE = logMarginal - logNull;
  // Guard the tails: an e-value is a likelihood ratio and can overflow on long runs.
  return Math.exp(Math.min(logE, 700));
}

/**
 * Accumulates evidence across looks. `fired` becomes true the first time the running product
 * crosses 1/alpha and stays true, because an always-valid test is allowed to stop there.
 */
export class SequentialTest {
  private product = 1;
  private looks = 0;
  private crossedAt: number | null = null;

  constructor(private p0: number, private alpha = E_ALPHA) {}

  observe(look: Look): number {
    this.looks++;
    this.product *= evalue(look.k, look.n, this.p0);
    if (this.crossedAt === null && this.product >= 1 / this.alpha) this.crossedAt = this.looks;
    return this.product;
  }

  get value(): number {
    return this.product;
  }

  get fired(): boolean {
    return this.crossedAt !== null;
  }

  get firedAtLook(): number | null {
    return this.crossedAt;
  }

  /** The always-valid analogue of a p-value: 1/e, clamped to 1. */
  get pValueAnytime(): number {
    return Math.min(1, 1 / this.product);
  }
}

/** Convenience: run a whole series through a fresh test and report whether it ever fired. */
export function runSequential(looks: Look[], p0: number, alpha = E_ALPHA): { fired: boolean; value: number; firedAtLook: number | null } {
  const t = new SequentialTest(p0, alpha);
  for (const l of looks) t.observe(l);
  return { fired: t.fired, value: t.value, firedAtLook: t.firedAtLook };
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Lanczos approximation. Accurate to ~1e-13 for a > 0, which is far more than we need. */
export function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

// ------------------------------------------------------------- parallel trends

export const PARALLEL_TREND_TOLERANCE = 0.08;

export interface PreWindow {
  treatmentK: number;
  treatmentN: number;
  controlK: number;
  controlN: number;
}

export interface TrendCheck {
  divergence: number;
  parallel: boolean;
  reason: string;
  windows: number;
}

/**
 * Difference-in-differences is only causal if treatment and control were moving in parallel
 * before the intervention. We have the history, so we check it, and refuse a confirmed verdict
 * when the pre-trends visibly diverge — the same way we refuse when a comparison is
 * underpowered. An assumption you never test is an assumption you are relying on.
 */
export function parallelTrends(pre: PreWindow[], tolerance = PARALLEL_TREND_TOLERANCE): TrendCheck {
  if (pre.length < 2) {
    return {
      divergence: 0,
      parallel: false,
      reason: 'Fewer than two pre-periods, so parallel trends cannot be checked at all.',
      windows: pre.length,
    };
  }
  let worst = 0;
  for (let i = 1; i < pre.length; i++) {
    const tPrev = rate(pre[i - 1].treatmentK, pre[i - 1].treatmentN);
    const tNow = rate(pre[i].treatmentK, pre[i].treatmentN);
    const cPrev = rate(pre[i - 1].controlK, pre[i - 1].controlN);
    const cNow = rate(pre[i].controlK, pre[i].controlN);
    const divergence = Math.abs(tNow - tPrev - (cNow - cPrev));
    if (divergence > worst) worst = divergence;
  }
  const parallel = worst <= tolerance;
  return {
    divergence: worst,
    parallel,
    windows: pre.length,
    reason: parallel
      ? `Treatment and control moved together before the change, worst gap ${(worst * 100).toFixed(1)} points across ${pre.length} pre-periods.`
      : `Treatment and control were already diverging before the change by ${(worst * 100).toFixed(1)} points, above the ${(tolerance * 100).toFixed(0)}-point tolerance, so a difference-in-differences verdict is not defensible here.`,
  };
}

// ------------------------------------------------------------- version pooling

export interface VersionedRun {
  modelVersion: string;
  defect: boolean;
}

export interface VersionGroup {
  modelVersion: string;
  k: number;
  n: number;
}

/**
 * A model version change mid-window silently pools two populations. We record model_version on
 * every run, so the honest move is to refuse to pool and report per version.
 */
export function poolByVersion(runs: VersionedRun[]): { groups: VersionGroup[]; mixed: boolean } {
  const byVersion = new Map<string, VersionGroup>();
  for (const r of runs) {
    const g = byVersion.get(r.modelVersion) ?? { modelVersion: r.modelVersion, k: 0, n: 0 };
    g.n++;
    if (r.defect) g.k++;
    byVersion.set(r.modelVersion, g);
  }
  const groups = [...byVersion.values()].sort((a, b) => a.modelVersion.localeCompare(b.modelVersion));
  return { groups, mixed: groups.length > 1 };
}

export function versionChangeExplanation(groups: VersionGroup[]): string | null {
  if (groups.length <= 1) return null;
  return (
    `The window spans ${groups.length} model versions (${groups.map((g) => `${g.modelVersion} n=${g.n}`).join(', ')}). ` +
    'A version change is an alternative explanation for any movement, and the rates are reported per version rather than pooled.'
  );
}

// -------------------------------------------------------- hierarchical variance

export interface VariantObservation {
  variantId: string;
  k: number;
  n: number;
}

export interface VarianceSplit {
  within: number;
  between: number;
  icc: number;
  variants: number;
  interpretation: string;
}

/**
 * Separates "the model is inconsistent" from "our wordings disagree".
 *
 * Both look like a wide interval and they have different fixes: the first is a sampling
 * problem, the second is a prompt-design problem the customer owns. The intraclass
 * correlation is the share of total variance that lives between wordings.
 */
export function hierarchicalVariance(observations: VariantObservation[]): VarianceSplit {
  const usable = observations.filter((o) => o.n > 0);
  if (usable.length < 2) {
    return {
      within: 0,
      between: 0,
      icc: 0,
      variants: usable.length,
      interpretation: 'Fewer than two wordings, so wording variance cannot be separated from sampling variance.',
    };
  }
  const rates = usable.map((o) => o.k / o.n);
  const totalN = usable.reduce((acc, o) => acc + o.n, 0);
  const grand = usable.reduce((acc, o) => acc + o.k, 0) / totalN;

  // Within-variant (binomial) variance, weighted by n.
  const within = usable.reduce((acc, o) => acc + (o.n / totalN) * ((o.k / o.n) * (1 - o.k / o.n)), 0);
  // Between-variant variance of the observed rates.
  const between = rates.reduce((acc, r) => acc + (r - grand) ** 2, 0) / (rates.length - 1);
  const total = within + between;
  const icc = total > 0 ? between / total : 0;

  return {
    within,
    between,
    icc,
    variants: usable.length,
    interpretation:
      icc > 0.5
        ? `Your ${usable.length} wordings disagree more than repeated draws of one wording do (ICC ${icc.toFixed(2)}). That is a prompt-design finding, not a model-inconsistency finding.`
        : `Repeated draws vary more than your ${usable.length} wordings do (ICC ${icc.toFixed(2)}). The model is inconsistent; your wordings agree.`,
  };
}

function rate(k: number, n: number): number {
  return n > 0 ? k / n : 0;
}
