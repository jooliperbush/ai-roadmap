/**
 * Alert generation.
 *
 * The `alerts` table existed from day one and nothing ever wrote to it, which meant every
 * finding waited for someone to open a browser. These are the rules for what is worth
 * interrupting a person about, and they are deliberately narrow: statistical movement that
 * survives the existing gates, or a critical contradiction that two evaluators agree on.
 *
 * Every alert body carries its sample size and interval. A lint test rejects a bare
 * percentage, because an alert is the one place a number is read fastest and questioned least.
 */

import type { DB } from '../db/index.js';
import * as sched from '../db/repo/unattended.js';
import type { DashboardData } from './dashboard.js';
import { formatMeasurement } from '../domain/stats.js';
import { predicateLabel } from '../domain/verifier.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';

export type AlertKind =
  | 'defect_movement'
  | 'critical_defect'
  | 'budget_exhausted'
  | 'citation_regressed'
  | 'registry_gap';

export const ALERT_KINDS: AlertKind[] = [
  'defect_movement', 'critical_defect', 'budget_exhausted', 'citation_regressed', 'registry_gap',
];

export const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export interface GenerateResult {
  created: number;
  duplicates: number;
  kinds: Record<string, number>;
}

/**
 * One pass over a finished window. Idempotent by construction: the unique index on
 * (tenant, brand, window, kind, subject) means running the same round twice inserts nothing
 * the second time, so a retried round does not re-page anyone.
 */
export function generateAlerts(
  db: DB,
  tenantId: string,
  brandId: string,
  windowLabel: string,
  data: DashboardData,
  clock: Clock = systemClock,
): GenerateResult {
  const out: GenerateResult = { created: 0, duplicates: 0, kinds: {} };

  const record = (row: ReturnType<typeof sched.insertAlertOnce>, kind: string) => {
    if (row) {
      out.created++;
      out.kinds[kind] = (out.kinds[kind] ?? 0) + 1;
    } else {
      out.duplicates++;
    }
  };

  for (const d of data.defects) {
    const measured = formatMeasurement(d.measurement);
    const surfaces = d.providers.length ? d.providers.join(', ') : 'the sampled surfaces';

    // Movement: only what already passed the two-proportion test, the minimum effect and the
    // Benjamini-Hochberg correction inside the dashboard. This adds no new statistics.
    if (d.baselineComparison?.significant) {
      record(
        sched.insertAlertOnce(db, tenantId, {
          brand_id: brandId,
          kind: 'defect_movement',
          severity: d.severity === 'critical' ? 'critical' : 'high',
          window_label: windowLabel,
          subject_key: d.misconceptionKey,
          headline: `Answers about ${predicateLabel(predicateOf(d.misconceptionKey))} moved on ${surfaces}: now ${measured}.`,
          detail:
            `${d.headline} Compared with the previous window this changed by ` +
            `${(d.baselineComparison.effect * 100).toFixed(0)} points ` +
            `(p=${d.baselineComparison.pValue.toFixed(3)}, q=${d.baselineComparison.qValue?.toFixed(3) ?? 'n/a'}). ` +
            `Example statement: "${d.exampleStatement}".`,
          link: `/defect/${encodeURIComponent(d.misconceptionKey)}`,
          p_value: d.baselineComparison.pValue,
          effect: d.baselineComparison.effect,
          q_value: d.baselineComparison.qValue,
        }),
        'defect_movement',
      );
    }

    // A critical contradiction does not need to have moved to matter. It does need two
    // evaluators to agree, which is the gate the spec set and the one that stops a single
    // brittle extraction from paging a customer at 3am.
    if (d.severity === 'critical' && d.adjudicated) {
      record(
        sched.insertAlertOnce(db, tenantId, {
          brand_id: brandId,
          kind: 'critical_defect',
          severity: 'critical',
          window_label: windowLabel,
          subject_key: d.misconceptionKey,
          headline: `Critical: ${surfaces} contradict your registry on ${predicateLabel(predicateOf(d.misconceptionKey))} in ${measured} of sampled answers.`,
          detail:
            `The registry records "${d.canonicalClaimText ?? 'an approved fact'}". ` +
            `The answer states "${d.exampleStatement}". Two independent evaluators agreed on this verdict. ` +
            `Measured across ${d.clusterLabels.join(', ') || 'the sampled clusters'}.`,
          link: `/defect/${encodeURIComponent(d.misconceptionKey)}`,
        }),
        'critical_defect',
      );
    }
  }

  // Registry gaps are not defects; they are questions only the customer can answer, and they
  // decay quietly unless someone is told.
  if (data.registryGaps && data.registryGaps.length > 0) {
    record(
      sched.insertAlertOnce(db, tenantId, {
        brand_id: brandId,
        kind: 'registry_gap',
        severity: 'medium',
        window_label: windowLabel,
        subject_key: 'registry',
        headline:
          `${data.registryGaps.length} ${data.registryGaps.length === 1 ? 'fact a model asserted has' : 'facts models asserted have'} ` +
          `no approved canonical claim (n=${data.totalRuns} runs sampled).`,
        detail:
          'These are registry gaps, not defects: we cannot adjudicate them until someone approves a canonical fact. ' +
          `Subjects: ${data.registryGaps.slice(0, 5).join('; ')}.`,
        link: '/truth',
      }),
      'registry_gap',
    );
  }

  return out;
}

export function predicateOf(misconceptionKey: string): string {
  return misconceptionKey.split('.')[1] ?? 'brand_presence';
}

export function meetsSeverity(alertSeverity: string, minimum: string): boolean {
  return (SEVERITY_RANK[alertSeverity] ?? 0) >= (SEVERITY_RANK[minimum] ?? 0);
}
