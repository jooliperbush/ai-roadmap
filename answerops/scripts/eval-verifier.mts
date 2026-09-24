/**
 * Runs the claim-checking step over a dataset, with the rules alone or with the Jev model check,
 * and writes what every claim in every answer was decided to be. Scoring is left to the caller.
 *
 *   npx tsx scripts/eval-verifier.mts <dataset-dir> --mode rules|jev [--out file] [--limit N]
 *
 * The dataset directory holds registry.json, {brand, competitors, asOf, rows: [{subject,
 * predicate, object, effectiveFrom, effectiveTo}]}, and answers.json, [{id, answer, question?}].
 * Jev mode needs TYPESAFE_API_KEY and spends real tokens, which are totalled at the end.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareEvidence } from '../src/services/answerEvidence.js';
import { TypeSafeClient, jevSettings } from '../src/providers/typesafe.js';
import type { CanonicalClaim, Sensitivity } from '../src/domain/truth.js';

interface RegistryRow {
  subject: string;
  predicate: string;
  object: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sensitivity?: Sensitivity;
}
interface Dataset {
  brand: string;
  domain?: string;
  competitors?: string[];
  asOf: string;
  rows: RegistryRow[];
}
interface Answer {
  id: string;
  answer: string;
  question?: string;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
const mode = flag('mode') ?? 'rules';
const limit = flag('limit') ? Number(flag('limit')) : Infinity;
if (!dir || (mode !== 'rules' && mode !== 'jev') || !(limit > 0)) {
  console.error('usage: npx tsx scripts/eval-verifier.mts <dataset-dir> --mode rules|jev [--out file] [--limit N]');
  process.exit(2);
}
if (mode === 'jev' && !process.env.TYPESAFE_API_KEY) {
  console.error('--mode jev needs TYPESAFE_API_KEY in the environment');
  process.exit(2);
}
const out = flag('out') ?? join(dir, `out-${mode}.json`);

const dataset = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')) as Dataset;
const answers = (JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8')) as Answer[]).slice(0, limit);
const asOf = new Date(dataset.asOf);
const canonical: CanonicalClaim[] = dataset.rows.map((row, i) => ({
  id: `r${i}`,
  tenantId: 'eval',
  brandId: 'eval',
  subject: row.subject,
  predicate: row.predicate,
  object: row.object,
  claimText: `${row.subject} ${row.predicate.replace(/_/g, ' ')} ${row.object}`,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo ?? null,
  supersededById: null,
  sourceId: null,
  sensitivity: row.sensitivity ?? 'material',
  approvedBy: 'eval',
  approvedAt: dataset.asOf,
}));
const jev = mode === 'jev' ? new TypeSafeClient({ ...jevSettings(), enabled: true }) : null;

const results = [];
const tokens = { input: 0, output: 0 };
let unchecked = 0;
for (const item of answers) {
  const evidence = await prepareEvidence(
    {
      answerText: item.answer,
      citations: [],
      searchQueries: [],
      latencyMs: 0,
      costUsd: null,
      simulated: false,
      systemConfigHash: 'eval',
      modelVersion: 'eval',
    },
    {
      brand: { name: dataset.brand, domain: dataset.domain ?? '' },
      canonical,
      competitors: dataset.competitors ?? [],
      competitorDomains: [],
      clock: { now: () => asOf },
      fetcher: null,
      jev,
    },
  );
  if (evidence.modelCheck) {
    tokens.input += evidence.modelCheck.usage.input_tokens;
    tokens.output += evidence.modelCheck.usage.output_tokens;
  } else if (jev) unchecked++;
  results.push({
    id: item.id,
    claims: evidence.observations
      // The placeholder that records an answer with no checkable statement is not a claim.
      .filter((o) => o.predicate !== 'brand_presence')
      .map((o) => {
        const votes = JSON.parse(o.evaluator_votes) as Array<{ evaluator: string; confidence?: number }>;
        return {
          stage: o.extractor_stage,
          subject: o.subject,
          predicate: o.predicate,
          object: o.object,
          polarity: o.polarity,
          temporal: o.temporal_marker,
          statement: o.statement,
          verdict: o.verdict,
          severity: o.severity,
          decidedBy: o.adjudication === 'agreed' ? 'both' : o.adjudication === 'model_decided' ? 'jev' : 'rules',
          adjudication: o.adjudication,
          // A disputed claim is held for review: it neither alerts nor counts in a rollup.
          review: o.adjudication === 'disputed',
          jevConfidence: votes.find((vote) => vote.evaluator === 'jev')?.confidence ?? null,
          votes,
        };
      }),
  });
}

writeFileSync(out, JSON.stringify(results, null, 1));
const usage = { mode, answers: results.length, unchecked, input_tokens: tokens.input, output_tokens: tokens.output };
writeFileSync(out.replace(/\.json$/, '') + '.usage.json', JSON.stringify(usage, null, 1));
const claims = results.reduce((sum, result) => sum + result.claims.length, 0);
console.log(
  `mode=${mode} answers=${results.length} claims=${claims} → ${out}` +
    (jev ? ` | input_tokens=${tokens.input} output_tokens=${tokens.output} rules-only fallbacks=${unchecked}` : ''),
);
