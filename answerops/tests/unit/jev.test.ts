/**
 * The Jev model check: the questions built from a registry, how the model's choices are read
 * back against it, the verdict policy, the copy, the client and the rules-only fallback. No
 * network: the client is always given its transport.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  answerUnits,
  buildJevPlan,
  checkClaims,
  checkProvenance,
  CHECK_COPY,
  decide,
  decideModelFinding,
  describeChecks,
  emptyTally,
  interpretJev,
  readingFor,
  type JevChoiceAnswer,
  type JevChoiceQuestion,
  type JevPlan,
  type ModelVote,
} from '../../src/domain/jev.js';
import type { ExtractedClaim, VerificationResult, Verdict } from '../../src/domain/verifier.js';
import type { CanonicalClaim } from '../../src/domain/truth.js';
import { TestClock } from '../../src/domain/clock.js';
import { DEFAULT_POLICY, ProviderHttpError } from '../../src/providers/resilience.js';
import { TypeSafeClient, TYPESAFE_ENDPOINT, jevCheckerFromEnv, jevSettings, type JevChecker } from '../../src/providers/typesafe.js';
import { prepareEvidence } from '../../src/services/answerEvidence.js';
import type { RunResult } from '../../src/providers/types.js';

const NOW = new Date('2026-09-24T00:00:00.000Z');

function row(id: string, predicate: string, object: string, effectiveFrom: string, effectiveTo: string | null = null, subject = 'Acme'): CanonicalClaim {
  return {
    id, tenantId: 't', brandId: 'b', subject, predicate, object, claimText: `${subject} ${predicate} ${object}`,
    effectiveFrom, effectiveTo, supersededById: null, sourceId: null, sensitivity: 'material', approvedBy: 'a', approvedAt: 'x',
  };
}

/** Deliberately not the evaluation brand: nothing below may depend on Northwind's facts. */
const REGISTRY: CanonicalClaim[] = [
  row('ceo1', 'ceo', 'Jane Doe', '2024-01-01'),
  row('ceo0', 'ceo', 'John Smith', '2015-01-01', '2024-01-01'),
  row('hq', 'headquarters', 'Lisbon, Portugal', '2020-01-01'),
  row('acq1', 'acquired_by', 'Initech', '2025-06-01'),
  row('acq0', 'acquired_by', 'independent', '2015-01-01', '2025-06-01'),
  row('pr1', 'pricing', '$49 per user per month', '2025-01-01'),
  row('pr0', 'pricing', '$39 per user per month', '2022-01-01', '2025-01-01'),
  row('emp', 'employee_count', '1,200', '2026-01-01'),
  row('fu1', 'funding', '$80 million', '2025-03-01'),
  row('fu0', 'funding', '$20 million', '2021-01-01', '2025-03-01'),
  row('isf', 'integration', 'Salesforce', '2023-01-01'),
  row('izd', 'integration', 'Zendesk', '2020-01-01', '2025-05-01'),
  row('iso', 'compliance', 'ISO 27001', '2023-01-01'),
  row('tok', 'token_supply', '10 billion ACM', '2024-01-01'),
  row('beta', 'product_status', 'beta', '2020-01-01', '2021-01-01'),
  row('gx', 'ceo', 'Rex Banner', '2019-01-01', null, 'Globex'),
];

const ANSWER =
  'Acme was founded in 2015 and is led by Jane Doe. It charges $49 per user per month, up from $39. ' +
  'Acme has about 1,200 employees across 3 offices [2]. It is SOC 2 compliant.\n\n' +
  '| Vendor | Salesforce |\n|---|---|\n| Acme | ✅ |\n| Globex | ❌ |';

function plan(answer = ANSWER, competitors = ['Globex', 'Acme', 'Globex', ' Hooli ']): JevPlan {
  return buildJevPlan({ brand: 'Acme', competitors, answer, canonical: REGISTRY, asOf: NOW });
}

function answered(choices: Record<string, [string, number]>): Record<string, JevChoiceAnswer> {
  return Object.fromEntries(
    Object.entries(choices).map(([id, [choice, confidence]]) => [id, { type: 'choice', choice, confidence }]),
  );
}

/** The option of an evidence question whose sentence contains `text`. */
function unitOption(question: JevChoiceQuestion, text: string): string {
  const option = Object.keys(question.criteria).find((key) => key !== 'none' && question.criteria[key].includes(text));
  if (!option) throw new Error(`no unit containing ${text}`);
  return option;
}

function claim(predicate: string, object: string, polarity: 'affirm' | 'negate' = 'affirm', statement = object): ExtractedClaim {
  return { statement, subject: 'Acme', predicate, object, polarity, temporalMarker: null };
}

describe('questions built from any registry', () => {
  it('asks about the brand only, naming its competitors once and never the brand itself', () => {
    const { state, questions } = plan();
    expect(state).toEqual({ brand: 'Acme', competitors: ['Globex', 'Hooli'], answer: ANSWER });
    const scope =
      'Consider only statements about Acme itself; ignore anything said about Globex, Hooli or any other company. ' +
      'Table cells and ✅/❌ marks in a Acme column count as statements.';
    for (const question of Object.values(questions)) {
      expect(question.type).toBe('choice');
      expect(question.instructions).toContain(scope);
    }
    expect(buildJevPlan({ brand: 'Acme', competitors: [], answer: ANSWER, canonical: REGISTRY, asOf: NOW }).questions.ceo.instructions).toContain(
      'ignore anything said about any other company.',
    );
  });

  it('offers the current value, each previous value, something else and silence for a single-valued fact', () => {
    const { questions } = plan();
    expect(questions.ceo.instructions).toMatch(/^What does `answer` say about Acme's CEO\?/);
    expect(questions.ceo.criteria).toEqual({
      current: "It says Acme's CEO is Jane Doe.",
      previous_0: "It says Acme's CEO is John Smith.",
      other: "It says Acme's CEO is someone other than Jane Doe or John Smith.",
      not_stated: "It says nothing about Acme's CEO.",
    });
    expect(questions.headquarters.criteria.current).toBe('It says Acme is headquartered in Lisbon, Portugal.');
    expect(questions.compliance.criteria).toMatchObject({ current: 'It says Acme has ISO 27001.', other: 'It says Acme does not have ISO 27001.' });
    expect(questions.token_supply.criteria).toMatchObject({
      current: "It says Acme's token supply is 10 billion ACM.",
      other: "It says Acme's token supply is something other than 10 billion ACM.",
    });
  });

  it('phrases independence without examples and says funding is not ownership', () => {
    const { acquired_by } = plan().questions;
    expect(acquired_by.criteria).toEqual({
      current: 'It says Acme was acquired by, or is owned by, Initech.',
      previous_0: 'It says Acme is described as an independent company that has not been acquired.',
      other: 'It says Acme is owned by, or was acquired by, a company other than Initech.',
      not_stated: "It says nothing about Acme's ownership.",
    });
    expect(acquired_by.instructions).toContain('Funding or investors do not say anything about ownership.');
    expect(JSON.stringify(acquired_by)).not.toMatch(/for example|venture-backed/i);
  });

  it('asks once per entity of a multi-valued fact, retired entities included', () => {
    const { questions } = plan();
    expect(questions.integration_salesforce).toEqual({
      type: 'choice',
      instructions: expect.stringMatching(/^Does `answer` say whether Acme has a native Salesforce integration\?/),
      criteria: {
        has: 'It says Acme has a native Salesforce integration.',
        lacks: 'It says Acme does not have a native Salesforce integration, or that it was retired or discontinued.',
        not_stated: 'It does not say whether Acme has a native Salesforce integration.',
      },
    });
    expect(questions.integration_zendesk).toBeDefined();
  });

  it('offers the numbers found in the answer, with context, and lets the model pick none', () => {
    const { questions, facts } = plan();
    expect(questions.pricing.instructions).toMatch(/^Which value does `answer` give as Acme's list price per user per month\?/);
    expect(questions.pricing.instructions).toContain('Pick the value the answer attributes to Acme for exactly this attribute.');
    expect(Object.keys(questions.pricing.criteria)).toEqual(['c0', 'c1', 'none']);
    expect(questions.pricing.criteria.c0).toMatch(/^"\$49", as in: "….*It charges \$49 per user per month.*…"$/);
    expect(questions.pricing.criteria.none).toBe(
      "The answer does not state Acme's list price per user per month (none of the other options is it).",
    );
    // A year, a citation marker and the 2 of "SOC 2" are not headcounts.
    const employees = facts.find((fact) => fact.key === 'employee_count');
    expect(employees?.kind === 'numeric' && employees.candidates.map((c) => c.span)).toEqual(['1,200', '3']);
  });

  it('skips a fact with nothing in force, another subject, and a number the answer never gives', () => {
    const keys = plan().facts.map((fact) => fact.key);
    expect(keys).not.toContain('product_status');
    expect(plan('Acme is led by Jane Doe.').facts.map((fact) => fact.key)).not.toContain('pricing');
    expect(JSON.stringify(plan().questions)).not.toContain('Rex Banner');
  });

  it('asks which sentence or table row states each non-numeric fact', () => {
    const { questions, units } = plan();
    expect(questions.evidence_ceo.instructions).toMatch(/^Which sentence or table row of `answer` states Acme's CEO\?/);
    expect(questions.evidence_ceo.criteria.s0).toBe('Acme was founded in 2015 and is led by Jane Doe.');
    expect(questions.evidence_ceo.criteria.none).toBe('No sentence or table row states it.');
    expect(Object.keys(questions.evidence_ceo.criteria)).toHaveLength(units.length + 1);
    expect(questions.evidence_pricing).toBeUndefined();
  });

  it('splits the answer into sentences and table rows with their offsets', () => {
    const units = answerUnits(ANSWER);
    expect(units.map((unit) => unit.text)).toEqual([
      'Acme was founded in 2015 and is led by Jane Doe.',
      'It charges $49 per user per month, up from $39.',
      'Acme has about 1,200 employees across 3 offices [2].',
      'It is SOC 2 compliant.',
      '| Vendor | Salesforce |',
      '| Acme | ✅ |',
      '| Globex | ❌ |',
    ]);
    for (const unit of units) expect(ANSWER.slice(unit.start, unit.end)).toBe(unit.text);
  });
});

describe('reading the model back against the registry', () => {
  it('compares the number the model picked, within each fact kind’s tolerance', () => {
    const p = plan();
    const read = (choices: Record<string, [string, number]>) =>
      Object.fromEntries(interpretJev(p, answered(choices)).map((f) => [f.fact.key, [f.outcome, f.row?.id ?? null, f.stated]]));
    expect(read({ pricing: ['c0', 0.9], employee_count: ['c0', 0.9] })).toEqual({
      pricing: ['ok', 'pr1', '$49'],
      employee_count: ['ok', 'emp', '1,200'],
    });
    expect(read({ pricing: ['c1', 0.9], employee_count: ['c1', 0.9], funding: ['none', 0.9] })).toEqual({
      pricing: ['stale', 'pr0', '$39'],
      employee_count: ['wrong', 'emp', '3'],
      funding: ['not_stated', null, null],
    });
    const numbers = plan('Acme raised $81 million to date and $20M before that; it has about 1,350 staff, or 1,500 by other counts.');
    const pick = (fact: string, span: string) => {
      const found = numbers.facts.find((f) => f.key === fact);
      const option = found?.kind === 'numeric' ? found.candidates.find((c) => c.span === span)?.option : undefined;
      return interpretJev(numbers, answered({ [fact]: [option ?? 'missing', 0.9] }))[0]?.outcome;
    };
    expect(pick('funding', '$81 million')).toBe('ok');
    expect(pick('funding', '$20M')).toBe('stale');
    expect(pick('employee_count', '1,350')).toBe('ok');
    expect(pick('employee_count', '1,500')).toBe('wrong');
  });

  it('reads has and lacks against a current and a retired entity', () => {
    const p = plan();
    const outcomes = (choice: string) =>
      interpretJev(p, answered({ integration_salesforce: [choice, 0.9], integration_zendesk: [choice, 0.9] })).map((f) => [f.outcome, f.row?.id]);
    expect(outcomes('has')).toEqual([['ok', 'isf'], ['stale', 'izd']]);
    expect(outcomes('lacks')).toEqual([['wrong', 'isf'], ['ok', 'izd']]);
    expect(outcomes('not_stated')).toEqual([['not_stated', undefined], ['not_stated', undefined]]);
  });

  it('reads a single-valued choice as current, previous, something else or silence', () => {
    const p = plan();
    const outcome = (choice: string) => {
      const [finding] = interpretJev(p, answered({ ceo: [choice, 0.9] }));
      return [finding.outcome, finding.row?.id ?? null, finding.stated];
    };
    expect(outcome('current')).toEqual(['ok', 'ceo1', 'Jane Doe']);
    expect(outcome('previous_0')).toEqual(['stale', 'ceo0', 'John Smith']);
    expect(outcome('other')).toEqual(['wrong', 'ceo1', null]);
    expect(outcome('not_stated')).toEqual(['not_stated', null, null]);
  });

  it('treats a rules claim the model did not read as the brand’s value as not stated', () => {
    const findings = interpretJev(plan(), answered({ ceo: ['current', 0.95], integration_salesforce: ['has', 0.9] }));
    expect(readingFor(findings, claim('ceo', 'Rex Banner'), 'Acme')?.outcome).toBe('not_stated');
    expect(readingFor(findings, claim('ceo', 'Jane Doe'), 'Acme')?.outcome).toBe('ok');
    expect(readingFor(findings, claim('integration', 'Salesforce', 'negate'), 'Acme')?.outcome).toBe('not_stated');
    expect(readingFor(findings, claim('headquarters', 'Porto'), 'Acme')).toBeNull();
    const other = interpretJev(plan(), answered({ ceo: ['other', 0.95] }));
    expect(readingFor(other, claim('ceo', 'Rex Banner'), 'Acme')?.outcome).toBe('wrong');
    expect(readingFor(other, claim('ceo', 'John Smith'), 'Acme')?.outcome).toBe('not_stated');
    expect(readingFor(other, claim('ceo', 'Jane Doe', 'negate'), 'Acme')).toMatchObject({ outcome: 'wrong', row: { id: 'ceo1' } });
  });
});

function result(verdict: Verdict, severity: VerificationResult['severity'] = 'critical'): VerificationResult {
  return { verdict, canonicalClaimId: 'x', severity, misconceptionKey: 'k', explanation: verdict, requiresAdjudication: true };
}
const vote = (verdict: Verdict, confidence: number): ModelVote => ({ result: result(verdict, 'low'), confidence, model: 'jev-test' });

describe('the verdict policy', () => {
  it('leaves the rules alone when the model check did not run, and says so', () => {
    expect(decide(result('CONTRADICTED'), null, 0.8)).toEqual({
      result: result('CONTRADICTED'),
      decidedBy: 'rules',
      adjudication: 'rules_only',
      votes: [{ evaluator: 'rules', verdict: 'CONTRADICTED' }],
    });
  });

  it('records agreement between the two checks', () => {
    expect(decide(result('STALE'), vote('STALE', 0.51), 0.8)).toMatchObject({
      decidedBy: 'both',
      adjudication: 'agreed',
      votes: [
        { evaluator: 'rules', verdict: 'STALE' },
        { evaluator: 'jev', verdict: 'STALE', confidence: 0.51, model: 'jev-test' },
      ],
    });
  });

  it('lets a confident model check decide and keeps the rules vote on the record', () => {
    const decision = decide(result('CONTRADICTED'), vote('NOT_APPLICABLE', 0.8), 0.8);
    expect(decision).toMatchObject({ decidedBy: 'jev', adjudication: 'model_decided' });
    expect(decision.result.verdict).toBe('NOT_APPLICABLE');
    expect(decision.votes[0]).toEqual({ evaluator: 'rules', verdict: 'CONTRADICTED' });
  });

  it('holds a defect for review when an unconfident model check disagrees', () => {
    const decision = decide(result('CONTRADICTED'), vote('SUPPORTED', 0.79), 0.8);
    expect(decision).toMatchObject({ decidedBy: 'rules', adjudication: 'disputed' });
    expect(decision.result.verdict).toBe('CONTRADICTED');
  });

  it('never lets the model check touch a registry gap or an unverifiable claim', () => {
    for (const verdict of ['UNSUPPORTED', 'UNVERIFIABLE'] as Verdict[])
      expect(decide(result(verdict), vote('CONTRADICTED', 0.99), 0.8)).toMatchObject({
        result: { verdict },
        decidedBy: 'rules',
        adjudication: 'not_required',
      });
  });

  it('adds a finding no rules claim covers only when the model check is confident it is a defect', () => {
    expect(decideModelFinding(vote('STALE', 0.9), 0.8)).toMatchObject({ decidedBy: 'jev', adjudication: 'model_decided' });
    expect(decideModelFinding(vote('STALE', 0.6), 0.8)).toBeNull();
    expect(decideModelFinding(vote('SUPPORTED', 0.99), 0.8)).toBeNull();
  });
});

describe('checking an answer with both checks', () => {
  const answer = 'Globex is led by CEO Rex Banner. Acme integrates with Salesforce. Acme remains an independent company.';
  const proposals = [
    { claim: claim('ceo', 'Rex Banner', 'affirm', 'Globex is led by CEO Rex Banner.'), stage: 'pattern' as const, proposer: 'pattern' },
    { claim: claim('integration', 'Salesforce', 'affirm', 'Acme integrates with Salesforce.'), stage: 'pattern' as const, proposer: 'pattern' },
  ];
  const run = (confidence: number) => {
    const p = plan(answer, ['Globex']);
    const findings = interpretJev(
      p,
      answered({
        ceo: ['not_stated', confidence],
        integration_salesforce: ['has', 0.99],
        acquired_by: ['previous_0', confidence],
        evidence_acquired_by: [unitOption(p.questions.evidence_acquired_by, 'independent company'), 0.9],
      }),
    );
    return checkClaims({ proposals, canonical: REGISTRY, asOf: NOW, brand: 'Acme', answer, modelCheck: { findings, model: 'jev-test', minConfidence: 0.8 } });
  };

  it('drops the misattributed claim, confirms the right one and adds what only the model found', () => {
    const [misattributed, confirmed, found, ...rest] = run(0.95);
    expect(rest).toEqual([]);
    expect(misattributed.decision).toMatchObject({ adjudication: 'model_decided', result: { verdict: 'NOT_APPLICABLE' } });
    expect(misattributed.decision.votes.map((v) => v.verdict)).toEqual(['CONTRADICTED', 'NOT_APPLICABLE']);
    expect(confirmed.decision).toMatchObject({ adjudication: 'agreed', result: { verdict: 'SUPPORTED' } });
    expect(found).toMatchObject({
      stage: 'model_check',
      claim: { statement: 'Acme remains an independent company.', predicate: 'acquired_by', object: 'independent', subject: 'Acme' },
      decision: { adjudication: 'model_decided', result: { verdict: 'STALE', canonicalClaimId: 'acq0' } },
    });
    expect(found.decision.votes).toEqual([{ evaluator: 'jev', verdict: 'STALE', confidence: 0.95, model: 'jev-test' }]);
  });

  it('keeps the rules verdict under review, and adds nothing, when the model check is unsure', () => {
    const checked = run(0.6);
    expect(checked).toHaveLength(2);
    expect(checked[0].decision).toMatchObject({ adjudication: 'disputed', result: { verdict: 'CONTRADICTED' } });
  });
});

describe('what a reader is told about the checks', () => {
  it('has one sentence per way a defect was decided', () => {
    expect(CHECK_COPY).toEqual({
      agreed: 'Two independent checks agreed: the registry rules and a Jev model judgment.',
      model_decided: 'Decided by the model check (Jev); the rule-based check reached a different verdict.',
      model_found: 'Found by the model check (Jev); the rule-based check did not flag it.',
      rules_only: 'Rule-based check only — model check unavailable.',
    });
    for (const kind of ['agreed', 'model_decided', 'model_found', 'rules_only'] as const)
      expect(describeChecks({ ...emptyTally(), [kind]: 3 })).toBe(CHECK_COPY[kind]);
    expect(describeChecks(emptyTally())).toBe(CHECK_COPY.rules_only);
  });

  it('counts each kind behind a mixed group', () => {
    expect(describeChecks({ ...emptyTally(), agreed: 3, rules_only: 1 })).toBe(
      'Checks behind these 4 statements: 3 confirmed by both the registry rules and the Jev model check; ' +
        '1 rule-based check only, model check unavailable.',
    );
  });

  it('derives the provenance from the stored votes, never from the label alone', () => {
    const rules = { evaluator: 'rules', verdict: 'CONTRADICTED' };
    const jev = { evaluator: 'jev', verdict: 'CONTRADICTED', confidence: 0.9, model: 'jev-test' };
    const stored = (adjudication: string, votes: unknown[]) => checkProvenance({ adjudication, evaluator_votes: JSON.stringify(votes) });
    expect(stored('agreed', [rules, jev])).toBe('agreed');
    expect(stored('model_decided', [rules, { ...jev, verdict: 'STALE' }])).toBe('model_decided');
    expect(stored('model_decided', [{ ...rules, verdict: 'SUPPORTED' }, jev])).toBe('model_found');
    expect(stored('model_decided', [jev])).toBe('model_found');
    expect(stored('rules_only', [rules])).toBe('rules_only');
    // Before the model check, "agreed" meant the same rules had run twice.
    expect(stored('agreed', ['CONTRADICTED', 'CONTRADICTED'])).toBe('rules_only');
    expect(checkProvenance({ adjudication: 'agreed', evaluator_votes: 'not json' })).toBe('rules_only');
  });
});

describe('the TypeSafe client', () => {
  const KEY = 'ts-test-not-a-real-key';
  const settings = { enabled: true, model: 'jev-latest', minConfidence: 0.8, timeoutMs: 1000 };
  const request = {
    state: { brand: 'Acme', competitors: ['Globex'], answer: 'Acme is led by Jane Doe.' },
    questions: { ceo: { type: 'choice' as const, instructions: 'Who?', criteria: { current: 'Jane Doe', not_stated: 'Nobody' } } },
  };
  const body = {
    model: 'jev-1.13.0',
    answers: { ceo: { type: 'choice', choice: 'current', confidence: 0.97, probabilities: { current: 0.97, not_stated: 0.03 } } },
    usage: { input_tokens: 120, output_tokens: 12 },
  };
  const reply = (status: number, json: unknown = body, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(json), { status, headers });
  let previous: string | undefined;
  let sleeps: number[];
  let policy: typeof DEFAULT_POLICY;
  beforeEach(() => {
    previous = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = KEY;
    sleeps = [];
    policy = { ...DEFAULT_POLICY, jitter: () => 1, sleep: async (ms) => void sleeps.push(ms) };
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  });
  function transport(...responses: Array<Response | Error>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      const next = responses[Math.min(calls.length, responses.length) - 1];
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('sends one request with the key as a bearer token and logs the tokens, not the key', async () => {
    const { calls, fetchImpl } = transport(reply(200));
    const lines: string[] = [];
    const response = await new TypeSafeClient(settings, fetchImpl, policy, (line) => lines.push(line)).evaluate(request);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TYPESAFE_ENDPOINT);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ model: 'jev-latest', ...request });
    expect(response).toEqual(body);
    expect(lines).toEqual(['[jev] model=jev-1.13.0 questions=1 input_tokens=120 output_tokens=12']);
    expect(lines.join('\n')).not.toContain(KEY);
  });

  it('retries a rate limit after the time the server asks for', async () => {
    const { calls, fetchImpl } = transport(reply(429, { error: 'slow down' }, { 'retry-after': '2' }), reply(200));
    await expect(new TypeSafeClient(settings, fetchImpl, policy, () => {}).evaluate(request)).resolves.toEqual(body);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('retries a server error or a dropped connection at most twice', async () => {
    const failing = transport(reply(529), reply(503), reply(500), reply(200));
    const error = await new TypeSafeClient(settings, failing.fetchImpl, policy, () => {}).evaluate(request).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error.status).toBe(500);
    expect(failing.calls).toHaveLength(3);
    const dropped = transport(new TypeError('fetch failed'), reply(200));
    await expect(new TypeSafeClient(settings, dropped.fetchImpl, policy, () => {}).evaluate(request)).resolves.toEqual(body);
    expect(dropped.calls).toHaveLength(2);
  });

  it('does not retry a rejected key', async () => {
    const { calls, fetchImpl } = transport(reply(401, { error: 'unauthorized' }));
    await expect(new TypeSafeClient(settings, fetchImpl, policy, () => {}).evaluate(request)).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });

  it('gives up after the timeout without retrying', async () => {
    let calls = 0;
    const hanging = ((_url: string, init: RequestInit) => {
      calls++;
      return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
    }) as unknown as typeof fetch;
    const client = new TypeSafeClient({ ...settings, timeoutMs: 20 }, hanging, policy, () => {});
    await expect(client.evaluate(request)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(calls).toBe(1);
  });

  it('rejects a response with no answers and drops a malformed answer', async () => {
    const empty = transport(reply(200, { model: 'jev-1.13.0', usage: {} }));
    await expect(new TypeSafeClient(settings, empty.fetchImpl, policy, () => {}).evaluate(request)).rejects.toThrow(/no answers/);
    const partial = transport(reply(200, { ...body, answers: { ...body.answers, broken: { choice: 3 } } }));
    const response = await new TypeSafeClient(settings, partial.fetchImpl, policy, () => {}).evaluate(request);
    expect(Object.keys(response.answers)).toEqual(['ceo']);
  });

  it('pauses after three answers in a row fail instead of waiting on every one', async () => {
    const { calls, fetchImpl } = transport(reply(401));
    const client = new TypeSafeClient(settings, fetchImpl, policy, () => {});
    for (let i = 0; i < 3; i++) await expect(client.evaluate(request)).rejects.toMatchObject({ status: 401 });
    await expect(client.evaluate(request)).rejects.toThrow(/paused/);
    expect(calls).toHaveLength(3);
  });

  it('is configured from the environment and off without a key', () => {
    expect(jevSettings({})).toEqual({ enabled: false, model: 'jev-latest', minConfidence: 0.8, timeoutMs: 20_000 });
    expect(jevSettings({ TYPESAFE_API_KEY: 'k' }).enabled).toBe(true);
    expect(jevSettings({ TYPESAFE_API_KEY: 'k', MISCITED_JEV: 'off' }).enabled).toBe(false);
    expect(jevSettings({ MISCITED_JEV_MODEL: 'jev-1.13.0', MISCITED_JEV_MIN_CONFIDENCE: '0.9' })).toMatchObject({
      model: 'jev-1.13.0',
      minConfidence: 0.9,
    });
    expect(jevSettings({ MISCITED_JEV_MIN_CONFIDENCE: '7' }).minConfidence).toBe(0.8);
    const off = process.env.MISCITED_JEV;
    process.env.MISCITED_JEV = 'off';
    try {
      expect(jevCheckerFromEnv()).toBeNull();
    } finally {
      if (off === undefined) delete process.env.MISCITED_JEV;
      else process.env.MISCITED_JEV = off;
    }
  });
});

describe('the evidence step', () => {
  const text = 'Globex is led by CEO Rex Banner. Acme integrates with Salesforce. Acme remains an independent company.';
  const answer = (simulated = false): RunResult => ({
    answerText: text, citations: [], searchQueries: [], latencyMs: 1, costUsd: null, simulated, systemConfigHash: 'h', modelVersion: 'm',
  });
  const context = (jev: JevChecker | null) => ({
    brand: { name: 'Acme', domain: 'acme.test' },
    canonical: REGISTRY,
    competitors: ['Globex'],
    competitorDomains: [],
    clock: new TestClock(NOW),
    fetcher: null,
    jev,
  });
  function checker(evaluate: JevChecker['evaluate']): JevChecker & { evaluate: ReturnType<typeof vi.fn> } {
    return { model: 'jev-latest', minConfidence: 0.8, evaluate: vi.fn(evaluate) };
  }
  const rulesOnly = [
    { predicate: 'ceo', verdict: 'CONTRADICTED', adjudication: 'rules_only', evaluator_votes: '[{"evaluator":"rules","verdict":"CONTRADICTED"}]' },
    { predicate: 'integration', verdict: 'SUPPORTED', adjudication: 'rules_only', evaluator_votes: '[{"evaluator":"rules","verdict":"SUPPORTED"}]' },
  ];
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('records both checks and what only the model found', async () => {
    const jev = checker(async ({ questions }) => ({
      model: 'jev-1.13.0',
      usage: { input_tokens: 900, output_tokens: 40 },
      answers: answered({
        ceo: ['not_stated', 0.93],
        integration_salesforce: ['has', 0.99],
        acquired_by: ['previous_0', 0.91],
        evidence_acquired_by: [unitOption(questions.evidence_acquired_by, 'independent company'), 0.9],
      }),
    }));
    const evidence = await prepareEvidence(answer(), context(jev));
    expect(jev.evaluate).toHaveBeenCalledTimes(1);
    expect(evidence.observations.map((o) => [o.predicate, o.verdict, o.adjudication, o.extractor_stage])).toEqual([
      ['ceo', 'NOT_APPLICABLE', 'model_decided', 'pattern'],
      ['integration', 'SUPPORTED', 'agreed', 'pattern'],
      ['acquired_by', 'STALE', 'model_decided', 'model_check'],
    ]);
    expect(checkProvenance(evidence.observations[2])).toBe('model_found');
    expect(evidence.observations[2].statement).toBe('Acme remains an independent company.');
    expect(evidence.modelCheck).toMatchObject({ model: 'jev-1.13.0', usage: { input_tokens: 900, output_tokens: 40 } });
  });

  it('falls back to the rules alone when the model check throws, and says so', async () => {
    const jev = checker(async () => {
      throw new ProviderHttpError(529, 'Jev model check failed: 529');
    });
    const evidence = await prepareEvidence(answer(), context(jev));
    expect(evidence.observations.map(({ predicate, verdict, adjudication, evaluator_votes }) => ({ predicate, verdict, adjudication, evaluator_votes }))).toEqual(
      rulesOnly,
    );
    expect(evidence.modelCheck).toBeNull();
    expect(warn).toHaveBeenCalledWith('[jev] model check unavailable, rules only: ProviderHttpError: Jev model check failed: 529');
  });

  it('falls back to the rules alone when the model check times out', async () => {
    const previous = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = 'ts-test-not-a-real-key';
    try {
      const hanging = ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
      const client = new TypeSafeClient({ enabled: true, model: 'jev-latest', minConfidence: 0.8, timeoutMs: 20 }, hanging, DEFAULT_POLICY, () => {});
      const evidence = await prepareEvidence(answer(), context(client));
      expect(evidence.observations.map((o) => o.adjudication)).toEqual(['rules_only', 'rules_only']);
      expect(evidence.modelCheck).toBeNull();
      expect(String(warn.mock.calls[0][0])).toMatch(/^\[jev\] model check unavailable, rules only: TimeoutError/);
      expect(String(warn.mock.calls[0][0])).not.toContain('ts-test-not-a-real-key');
    } finally {
      if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = previous;
    }
  });

  it('never sends the stand-in upstream’s answers, and runs rules only when told to', async () => {
    const jev = checker(async () => {
      throw new Error('must not be called');
    });
    const simulated = await prepareEvidence(answer(true), context(jev));
    expect(jev.evaluate).not.toHaveBeenCalled();
    expect(simulated.observations.map((o) => o.adjudication)).toEqual(['rules_only', 'rules_only']);
    const off = await prepareEvidence(answer(), context(null));
    expect(off.modelCheck).toBeNull();
    expect(off.observations.map((o) => o.adjudication)).toEqual(['rules_only', 'rules_only']);
  });
});
