/**
 * Alert generation.
 *
 * The `alerts` table existed from day one and nothing ever wrote to it, which meant every
 * finding waited for someone to open a browser. These are the rules for what is worth
 * interrupting a person about, and they are deliberately narrow: statistical movement that
 * survives the existing gates, or a critical contradiction the model check did not dispute. The
 * alert says which checks stand behind it, and never claims two when only the rules ran.
 *
 * Every alert body carries its sample size and interval. A lint test rejects a bare
 * percentage, because an alert is the one place a number is read fastest and questioned least.
 */

import type { DB } from '../db/index.js';
import * as sched from '../db/repo/unattended.js';
import type { DashboardData } from './dashboard.js';
import { formatMeasurement } from '../domain/stats.js';
import { predicateLabel } from '../domain/verifier.js';
import { describeChecks } from '../domain/jev.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';

export type AlertKind =
  | 'defect_movement'
  | 'critical_defect'
  | 'budget_exhausted'
  | 'citation_regressed'
  | 'registry_gap';

export const ALERT_KINDS: AlertKind[] = [
  'defect_movement',
  'critical_defect',
  'budget_exhausted',
  'citation_regressed',
  'registry_gap',
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
  const candidates: Array<Omit<Parameters<typeof sched.insertAlertOnce>[2], 'brand_id' | 'window_label'>> =
    [];
  for (const defect of data.defects) {
    const measured = formatMeasurement(defect.measurement);
    const surfaces = defect.providers.length ? defect.providers.join(', ') : 'the sampled surfaces';
    const subject = predicateLabel(predicateOf(defect.misconceptionKey));
    const base = {
      subject_key: defect.misconceptionKey,
      link: `/defect/${encodeURIComponent(defect.misconceptionKey)}`,
    };
    const comparison = defect.baselineComparison;
    if (comparison?.significant)
      candidates.push({
        ...base,
        kind: 'defect_movement',
        severity: defect.severity === 'critical' ? 'critical' : 'high',
        headline: `Answers about ${subject} moved on ${surfaces}: now ${measured}.`,
        detail:
          `${defect.headline} Compared with the previous window this changed by ` +
          `${(comparison.effect * 100).toFixed(0)} points ` +
          `(p=${comparison.pValue.toFixed(3)}, q=${comparison.qValue?.toFixed(3) ?? 'n/a'}). ` +
          `Example statement: "${defect.exampleStatement}".`,
        p_value: comparison.pValue,
        effect: comparison.effect,
        q_value: comparison.qValue,
      });
    // A verdict the model check disputed never reaches the rollup, so it cannot page anyone.
    if (defect.severity === 'critical')
      candidates.push({
        ...base,
        kind: 'critical_defect',
        severity: 'critical',
        headline: `Critical: ${surfaces} contradict your registry on ${subject} in ${measured} of sampled answers.`,
        detail:
          `The registry records "${defect.canonicalClaimText ?? 'an approved fact'}". ` +
          `The answer states "${defect.exampleStatement}". ${describeChecks(defect.checks)} ` +
          `Measured across ${defect.clusterLabels.join(', ') || 'the sampled clusters'}.`,
      });
  }
  const gaps = data.registryGaps ?? [];
  if (gaps.length)
    candidates.push({
      kind: 'registry_gap',
      severity: 'medium',
      subject_key: 'registry',
      link: '/truth',
      headline:
        `${gaps.length} ${gaps.length === 1 ? 'fact a model asserted has' : 'facts models asserted have'} ` +
        `no approved canonical claim (n=${data.totalRuns} runs sampled).`,
      detail:
        'These are registry gaps, not defects: we cannot adjudicate them until someone approves a canonical fact. ' +
        `Subjects: ${gaps.slice(0, 5).join('; ')}.`,
    });
  return db.transaction(() => {
    const result: GenerateResult = { created: 0, duplicates: 0, kinds: {} };
    for (const candidate of candidates) {
      if (
        sched.insertAlertOnce(db, tenantId, { ...candidate, brand_id: brandId, window_label: windowLabel })
      ) {
        result.created++;
        result.kinds[candidate.kind] = (result.kinds[candidate.kind] ?? 0) + 1;
      } else result.duplicates++;
    }
    return result;
  })();
}

export function predicateOf(misconceptionKey: string): string {
  const boundary = misconceptionKey.indexOf('.');
  if (boundary < 0) return 'brand_presence';
  const end = misconceptionKey.indexOf('.', boundary + 1);
  return misconceptionKey.slice(boundary + 1, end < 0 ? undefined : end);
}

export function meetsSeverity(alertSeverity: string, minimum: string): boolean {
  const [severity, threshold] = [alertSeverity, minimum].map((value) => SEVERITY_RANK[value] ?? 0);
  return severity >= threshold;
}
