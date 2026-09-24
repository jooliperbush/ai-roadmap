/**
 * The Jev model check: a second, independent reading of an answer against the truth registry.
 *
 * The rules in verifier.ts find (predicate, object) tuples by pattern, and a pattern cannot tell
 * whose sentence it read: a competitor's CEO in a comparison table becomes the brand's CEO. This
 * module asks TypeSafe's Jev model one question per registry fact instead — what does the answer
 * say about this brand's CEO, this integration, this price — in a single request per answer.
 *
 * Code still owns every value. For a number, code offers the candidate spans and the model only
 * picks which one the answer gives for the brand; code compares it with the registry. For
 * everything else the model chooses between options code wrote from the registry rows. The
 * module is pure: it builds the request and interprets the response, and the HTTP client lives
 * in providers/typesafe.ts.
 */

import { currentTruths, normalizeKey, normalizeObject, objectMatches, truthHistory, type CanonicalClaim } from './truth.js';
import {
  MULTI_VALUED_PREDICATES,
  verdictFromModelCheck,
  verifyClaim,
  type ExtractedClaim,
  type ModelCheckOutcome,
  type Verdict,
  type VerificationResult,
} from './verifier.js';
import type { ExtractorStage, ProposedClaim } from './extractor.js';

// ------------------------------------------------------------------------ wire types

export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevState {
  brand: string;
  competitors: string[];
  answer: string;
}

export interface JevChoiceAnswer {
  type: string;
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevChoiceAnswer | undefined>;
  usage: JevUsage;
}

// ------------------------------------------------------------------------ the plan

type NumericKind = 'year' | 'money' | 'count';

interface FactBase {
  /** question id; ids are never sent to the model */
  key: string;
  predicate: string;
  /** what a sentence would have to state, e.g. "Northwind's CEO" */
  topic: string;
  /** rows in force at the sampled time, newest first */
  inForce: CanonicalClaim[];
}

/** One value true at a time: the CEO, the headquarters, the owner. */
export interface SingleFact extends FactBase {
  kind: 'single';
  /** option → the registry row it states; `other` and `not_stated` state none */
  options: Record<string, CanonicalClaim | null>;
}

/** One entity of a multi-valued fact: an integration, a feature. */
export interface MultiFact extends FactBase {
  kind: 'multi';
  entity: string;
  /** every row for this entity, newest first */
  rows: CanonicalClaim[];
  current: CanonicalClaim | null;
  ended: CanonicalClaim | null;
}

/** A number code compares: a year, a price, funding, headcount. */
export interface NumericFact extends FactBase {
  kind: 'numeric';
  numeric: NumericKind;
  /** option `c{i}` → a value found in the answer */
  candidates: Array<{ option: string; span: string; value: number; start: number; end: number }>;
  /** rows whose interval has closed, newest first */
  ended: CanonicalClaim[];
}

export type JevFact = SingleFact | MultiFact | NumericFact;

/** A sentence or table row of the answer, with its offsets. */
export interface AnswerUnit {
  text: string;
  start: number;
  end: number;
}

export interface JevPlan {
  brand: string;
  state: JevState;
  questions: Record<string, JevChoiceQuestion>;
  facts: JevFact[];
  units: AnswerUnit[];
}

export interface JevPlanInput {
  brand: string;
  competitors: string[];
  answer: string;
  canonical: CanonicalClaim[];
  asOf: Date;
}

const MAX_COMPETITORS = 12;
const MAX_CANDIDATES = 60;
const MAX_UNITS = 100;
const MAX_UNIT_CHARS = 300;
const MAX_PREVIOUS = 5;
/** Evidence questions repeat every sentence, so they are what a large registry pays for. */
const MAX_EVIDENCE_QUESTIONS = 40;

/** The questions for one answer, generic over whatever the brand's registry holds. */
export function buildJevPlan(input: JevPlanInput): JevPlan {
  const { brand, answer, asOf } = input;
  const competitors = [
    ...new Set(input.competitors.map((name) => name.trim()).filter((name) => name && normalizeKey(name) !== normalizeKey(brand))),
  ].slice(0, MAX_COMPETITORS);
  const scope = scopeOf(brand, competitors);
  const units = answerUnits(answer);
  const rows = input.canonical.filter((row) => normalizeKey(row.subject) === normalizeKey(brand));
  const facts: JevFact[] = [];
  const questions: Record<string, JevChoiceQuestion> = {};
  const add = (fact: JevFact, question: JevChoiceQuestion) => {
    let key = fact.key;
    for (let n = 2; questions[key]; n++) key = `${fact.key}_${n}`;
    fact.key = key;
    facts.push(fact);
    questions[key] = question;
  };
  const inForceAt = (row: CanonicalClaim) =>
    Date.parse(row.effectiveFrom) <= +asOf && (row.effectiveTo === null || Date.parse(row.effectiveTo) > +asOf);
  const endedBy = (row: CanonicalClaim) => row.effectiveTo !== null && Date.parse(row.effectiveTo) <= +asOf;

  for (const predicate of [...new Set(rows.map((row) => row.predicate))]) {
    const history = truthHistory(rows, brand, predicate);
    const inForce = currentTruths(rows, brand, predicate, asOf);
    if (!inForce.length) continue;
    const numeric = NUMERIC[predicate];
    if (numeric && history.every((row) => valueIn(row.object, numeric.kind) !== null)) {
      const candidates = candidatesIn(answer, numeric.kind).map((candidate, i) => ({ option: `c${i}`, ...candidate }));
      if (!candidates.length) continue;
      const attribute = numeric.attribute(inForce[0].object);
      const criteria: Record<string, string> = {};
      for (const candidate of candidates)
        criteria[candidate.option] = `"${candidate.span}", as in: "…${contextOf(answer, candidate.start, candidate.end)}…"`;
      criteria.none = `The answer does not state ${brand}'s ${attribute} (none of the other options is it).`;
      add(
        { kind: 'numeric', key: predicate, predicate, topic: `${brand}'s ${attribute}`, inForce, numeric: numeric.kind, candidates, ended: history.filter(endedBy) },
        {
          type: 'choice',
          instructions:
            `Which value does \`answer\` give as ${brand}'s ${attribute}? ${scope} ` +
            `Pick the value the answer attributes to ${brand} for exactly this attribute.`,
          criteria,
        },
      );
      continue;
    }
    if (inForce.length > 1 || MULTI_VALUED_PREDICATES.includes(predicate)) {
      const groups: CanonicalClaim[][] = [];
      for (const row of history) {
        const group = groups.find((members) => objectMatches(members[0].object, row.object));
        if (group) group.push(row);
        else groups.push([row]);
      }
      for (const group of groups) {
        const current = group.find(inForceAt) ?? null;
        const ended = group.find(endedBy) ?? null;
        if (!current && !ended) continue;
        const entity = group[0].object;
        const phrase = multiPhrase(predicate, entity);
        add(
          {
            kind: 'multi',
            key: normalizeKey(`${predicate} ${entity}`),
            predicate,
            topic: `whether ${brand} ${phrase.has}`,
            inForce,
            entity,
            rows: group,
            current,
            ended,
          },
          {
            type: 'choice',
            instructions: `Does \`answer\` say whether ${brand} ${phrase.has}? ${scope}`,
            criteria: {
              has: `It says ${brand} ${phrase.has}.`,
              lacks: `It says ${brand} ${phrase.lacks}, or that it was retired or discontinued.`,
              not_stated: `It does not say whether ${brand} ${phrase.has}.`,
            },
          },
        );
      }
      continue;
    }
    const current = inForce[0];
    const previous: CanonicalClaim[] = [];
    for (const row of history.filter(endedBy))
      if (
        !objectMatches(row.object, current.object) &&
        !previous.some((seen) => objectMatches(seen.object, row.object)) &&
        previous.length < MAX_PREVIOUS
      )
        previous.push(row);
    const template = singleTemplate(predicate, brand, [current, ...previous].map((row) => row.object));
    const options: Record<string, CanonicalClaim | null> = { current };
    const criteria: Record<string, string> = { current: `It says ${template.statement(current.object)}.` };
    previous.forEach((row, i) => {
      options[`previous_${i}`] = row;
      criteria[`previous_${i}`] = `It says ${template.statement(row.object)}.`;
    });
    options.other = null;
    options.not_stated = null;
    criteria.other = `It says ${template.other}.`;
    criteria.not_stated = `It says nothing about ${template.topic}.`;
    add(
      { kind: 'single', key: predicate, predicate, topic: template.topic, inForce, options },
      {
        type: 'choice',
        instructions: [`What does \`answer\` say about ${template.topic}?`, scope, template.note].filter(Boolean).join(' '),
        criteria,
      },
    );
  }

  // Speculative evidence: which sentence states each fact. Only a finding the rules did not
  // make needs it, but asking in the same request costs tokens rather than a round trip.
  if (units.length)
    for (const fact of facts.filter((fact) => fact.kind !== 'numeric').slice(0, MAX_EVIDENCE_QUESTIONS)) {
      const criteria: Record<string, string> = {};
      units.forEach((unit, i) => (criteria[`s${i}`] = unit.text));
      criteria.none = 'No sentence or table row states it.';
      questions[evidenceKey(fact)] = {
        type: 'choice',
        instructions: `Which sentence or table row of \`answer\` states ${fact.topic}? ${scope}`,
        criteria,
      };
    }

  return { brand, state: { brand, competitors, answer }, questions, facts, units };
}

function evidenceKey(fact: JevFact): string {
  return `evidence_${fact.key}`;
}

function scopeOf(brand: string, competitors: string[]): string {
  const others = competitors.length ? `${competitors.join(', ')} or any other company` : 'any other company';
  return (
    `Consider only statements about ${brand} itself; ignore anything said about ${others}. ` +
    `Table cells and ✅/❌ marks in a ${brand} column count as statements.`
  );
}

/** "A", "A or B", "A, B or C". */
function listOr(items: string[]): string {
  const unique = [...new Set(items)];
  return unique.length <= 1 ? (unique[0] ?? '') : `${unique.slice(0, -1).join(', ')} or ${unique[unique.length - 1]}`;
}

// ------------------------------------------------------------------------ templates

const INDEPENDENT_RE = /\b(?:independent|not acquired|none|standalone|privately held)\b/i;
const TRAILING_GRADE_RE = /[\s,-]*\b(?:type|tier|level)[\s-]*(?:\d+|[ivx]+)\s*$/i;

interface SingleTemplate {
  topic: string;
  statement: (object: string) => string;
  other: string;
  note?: string;
}

function singleTemplate(predicate: string, brand: string, objects: string[]): SingleTemplate {
  switch (predicate) {
    case 'ceo':
      return {
        topic: `${brand}'s CEO`,
        statement: (object) => `${brand}'s CEO is ${object}`,
        other: `${brand}'s CEO is someone other than ${listOr(objects)}`,
      };
    case 'headquarters':
      return {
        topic: `${brand}'s headquarters location`,
        statement: (object) => `${brand} is headquartered in ${object}`,
        other: `${brand} is headquartered somewhere other than ${listOr(objects)}`,
      };
    case 'acquired_by': {
      const owners = objects.filter((object) => !INDEPENDENT_RE.test(object));
      return {
        topic: `${brand}'s ownership`,
        statement: (object) =>
          INDEPENDENT_RE.test(object)
            ? `${brand} is described as an independent company that has not been acquired`
            : `${brand} was acquired by, or is owned by, ${object}`,
        other: owners.length
          ? `${brand} is owned by, or was acquired by, a company other than ${listOr(owners)}`
          : `${brand} is owned by, or was acquired by, another company`,
        note: 'Funding or investors do not say anything about ownership.',
      };
    }
    case 'compliance':
    case 'certification': {
      const family = familyOf(objects);
      if (!family)
        return {
          topic: `${brand}'s ${predicate} status`,
          statement: (object) => `${brand} has ${object}`,
          other: `${brand} has a ${predicate} status other than ${listOr(objects)}, or none`,
        };
      const graded = objects.some((object) => normalizeObject(object) !== normalizeObject(family));
      return {
        topic: `${brand}'s ${family} status`,
        statement: (object) => `${brand} has ${object}`,
        other: graded
          ? `${brand} does not have ${family}, or has a ${family} status other than ${listOr(objects)}`
          : `${brand} does not have ${family}`,
      };
    }
    case 'availability':
      return {
        topic: `where ${brand} is available`,
        statement: (object) => `${brand} is available on ${object}`,
        other: `${brand} is available somewhere other than ${listOr(objects)}`,
      };
    case 'partnership':
      return {
        topic: `${brand}'s partnerships`,
        statement: (object) => `${brand} partners with ${object}`,
        other: `${brand} partners with someone other than ${listOr(objects)}`,
      };
    default: {
      const words = predicate.replace(/_/g, ' ');
      return {
        topic: `${brand}'s ${words}`,
        statement: (object) => `${brand}'s ${words} is ${object}`,
        other: `${brand}'s ${words} is something other than ${listOr(objects)}`,
      };
    }
  }
}

/** "SOC 2" for SOC 2 Type I and Type II: the words every row shares, less a trailing grade. */
function familyOf(objects: string[]): string {
  const words = objects.map((object) => object.replace(TRAILING_GRADE_RE, '').trim().split(/\s+/));
  const shared: string[] = [];
  for (let i = 0; i < words[0].length; i++) {
    if (!words.every((list) => list[i]?.toLowerCase() === words[0][i].toLowerCase())) break;
    shared.push(words[0][i]);
  }
  return shared.join(' ');
}

function multiPhrase(predicate: string, entity: string): { has: string; lacks: string } {
  switch (predicate) {
    case 'integration': {
      const name = entity.replace(/\s+integration$/i, '');
      return { has: `has a native ${name} integration`, lacks: `does not have a native ${name} integration` };
    }
    case 'feature_support':
      return { has: `has ${entity}`, lacks: `does not have ${entity}` };
    case 'availability':
      return { has: `is available on ${entity}`, lacks: `is not available on ${entity}` };
    case 'compliance':
    case 'certification':
      return { has: `holds ${entity}`, lacks: `does not hold ${entity}` };
    case 'partnership':
      return { has: `partners with ${entity}`, lacks: `does not partner with ${entity}` };
    default: {
      const words = predicate.replace(/_/g, ' ');
      return { has: `has ${entity} among its ${words}`, lacks: `does not have ${entity} among its ${words}` };
    }
  }
}

// ------------------------------------------------------------------------ numbers

const PATTERN: Record<NumericKind, RegExp> = {
  year: /\b(?:19|20)\d{2}\b/g,
  money: /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|mn|bn|[mbk])\b)?/gi,
  count: /(?<![$\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)\+?(?![\d%])/g,
};
const ANY_NUMBER = /\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|mn|bn|[mbk])\b)?/gi;
const SCALE: Record<string, number> = { k: 1e3, million: 1e6, mn: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9 };

const NUMERIC: Record<string, { kind: NumericKind; attribute: (object: string) => string }> = {
  founded_year: { kind: 'year', attribute: () => 'founding year' },
  pricing: { kind: 'money', attribute: (object) => `list price${unitOf(object)}` },
  fees: { kind: 'money', attribute: (object) => `transaction fee${unitOf(object)}` },
  funding: { kind: 'money', attribute: () => 'total funding raised' },
  employee_count: { kind: 'count', attribute: () => 'number of employees (headcount)' },
};

/** " per user per month" from "$29 per user per month" or "$29/user/month". */
function unitOf(object: string): string {
  const money = [...object.matchAll(PATTERN.money)][0];
  const rest = money ? object.slice(money.index! + money[0].length).trim() : '';
  return rest ? ' ' + rest.replace(/^\//, 'per ').replace(/\//g, ' per ') : '';
}

function toNumber(span: string): number | null {
  const m = span
    .toLowerCase()
    .replace(/[,$+]/g, '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(million|billion|mn|bn|m|b|k)?$/);
  return m ? Number(m[1]) * (m[2] ? SCALE[m[2]] : 1) : null;
}

function valueIn(text: string, kind: NumericKind): number | null {
  for (const m of text.matchAll(PATTERN[kind])) {
    const value = toNumber(m[0]);
    if (value !== null) return value;
  }
  return null;
}

function candidatesIn(text: string, kind: NumericKind): Array<{ span: string; value: number; start: number; end: number }> {
  const seen = new Set<number>();
  const found: Array<{ span: string; value: number; start: number; end: number }> = [];
  for (const m of text.matchAll(PATTERN[kind])) {
    const span = m[0].trim();
    const start = m.index!;
    const end = start + m[0].length;
    if (
      kind === 'count' &&
      (/^(?:19|20)\d{2}$/.test(span.replace(/\+$/, '')) ||
        text.slice(Math.max(0, start - 4), start).toLowerCase().endsWith('soc ') ||
        (text[start - 1] === '[' && text[end] === ']'))
    )
      continue;
    const value = toNumber(span);
    if (value === null || seen.has(value)) continue;
    seen.add(value);
    found.push({ span, value, start, end });
    if (found.length >= MAX_CANDIDATES) break;
  }
  return found;
}

function contextOf(text: string, start: number, end: number): string {
  return text
    .slice(Math.max(0, start - 60), end + 60)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tolerances: a year exactly, a price to the cent, funding within 2%, headcount within 15%. */
function sameValue(predicate: string, kind: NumericKind, value: number, target: number): boolean {
  if (kind === 'year') return Math.round(value) === Math.round(target);
  if (predicate === 'employee_count') return Math.abs(value - target) <= 0.15 * Math.abs(target);
  if (predicate === 'funding') {
    const millions = (v: number) => (v >= 1e5 ? v / 1e6 : v);
    return Math.abs(millions(value) - millions(target)) <= 0.02 * Math.abs(millions(target));
  }
  if (kind === 'money') return Math.abs(value - target) <= Math.min(0.5, 0.02 * Math.abs(target));
  return value === target;
}

// ------------------------------------------------------------------------ evidence units

/** The answer as sentences and table rows, the units an evidence question chooses between. */
export function answerUnits(answer: string): AnswerUnit[] {
  const units: AnswerUnit[] = [];
  const seen = new Set<string>();
  const push = (raw: string, start: number) => {
    const text = raw.trim().replace(/\s+/g, ' ');
    if (!/[a-z0-9]/i.test(text) || seen.has(text)) return;
    seen.add(text);
    const lead = raw.length - raw.trimStart().length;
    units.push({
      text: text.length > MAX_UNIT_CHARS ? `${text.slice(0, MAX_UNIT_CHARS - 1)}…` : text,
      start: start + lead,
      end: start + raw.trimEnd().length,
    });
  };
  for (const line of answer.matchAll(/[^\n]+/g)) {
    const offset = line.index!;
    if (/^\s*\|/.test(line[0])) {
      if (!/^[\s|:-]+$/.test(line[0])) push(line[0], offset);
      continue;
    }
    let from = 0;
    for (const cut of line[0].matchAll(/(?<=[.!?])\s+(?=[A-Z0-9"'(*[_])/g)) {
      push(line[0].slice(from, cut.index), offset + from);
      from = cut.index! + cut[0].length;
    }
    push(line[0].slice(from), offset + from);
  }
  return units.slice(0, MAX_UNITS);
}

// ------------------------------------------------------------------------ interpretation

export interface JevFinding {
  fact: JevFact;
  choice: string;
  outcome: ModelCheckOutcome;
  confidence: number;
  /** the registry row the outcome is judged against */
  row: CanonicalClaim | null;
  /** what the answer states: a value span or a registry object; null when it names something else */
  stated: string | null;
  /** the number the model picked, for a numeric fact */
  value: number | null;
  /** the sentence or table row that states it, when the model pointed at one */
  evidence: string | null;
}

/** The model's choices, read against the registry by code. */
export function interpretJev(plan: JevPlan, answers: JevResponse['answers']): JevFinding[] {
  const findings: JevFinding[] = [];
  for (const fact of plan.facts) {
    const answer = answers[fact.key];
    if (!answer || typeof answer.choice !== 'string') continue;
    const confidence = Number.isFinite(answer.confidence) ? Math.min(1, Math.max(0, answer.confidence)) : 0;
    const base = { fact, choice: answer.choice, confidence, value: null, evidence: sentenceFor(plan, fact, answers) };
    const found = (outcome: ModelCheckOutcome, row: CanonicalClaim | null, stated: string | null) =>
      findings.push({ ...base, outcome, row, stated });
    if (answer.choice === 'not_stated' || answer.choice === 'none') {
      found('not_stated', null, null);
      continue;
    }
    if (fact.kind === 'single') {
      const row = fact.options[answer.choice];
      if (answer.choice === 'current' && row) found('ok', row, row.object);
      else if (answer.choice.startsWith('previous_') && row) found('stale', row, row.object);
      else if (answer.choice === 'other') found('wrong', fact.inForce[0], null);
    } else if (fact.kind === 'multi') {
      if (answer.choice === 'has')
        fact.current ? found('ok', fact.current, fact.entity) : found('stale', fact.ended, fact.entity);
      else if (answer.choice === 'lacks')
        fact.current ? found('wrong', fact.current, fact.entity) : found('ok', fact.ended, fact.entity);
    } else {
      const candidate = fact.candidates.find((c) => c.option === answer.choice);
      if (!candidate) continue;
      const same = (row: CanonicalClaim) =>
        sameValue(fact.predicate, fact.numeric, candidate.value, valueIn(row.object, fact.numeric) ?? NaN);
      const current = fact.inForce.find(same);
      const ended = current ? undefined : fact.ended.find(same);
      const unit = plan.units.find((u) => u.start <= candidate.start && candidate.start < u.end);
      findings.push({
        ...base,
        outcome: current ? 'ok' : ended ? 'stale' : 'wrong',
        row: current ?? ended ?? fact.inForce[0],
        stated: candidate.span,
        value: candidate.value,
        evidence: unit?.text ?? contextOf(plan.state.answer, candidate.start, candidate.end),
      });
    }
  }
  return findings;
}

function sentenceFor(plan: JevPlan, fact: JevFact, answers: JevResponse['answers']): string | null {
  const choice = answers[evidenceKey(fact)]?.choice ?? '';
  const index = /^s(\d+)$/.exec(choice)?.[1];
  return index === undefined ? null : (plan.units[Number(index)]?.text ?? null);
}

export interface JevReading {
  finding: JevFinding;
  /** the finding projected onto this claim: `not_stated` when the claim is not what the model read */
  outcome: ModelCheckOutcome;
  row: CanonicalClaim | null;
}

/**
 * The model's reading of the fact a rules claim is about, as it bears on that claim. A claim the
 * model did not read as the brand's value — a competitor's CEO, another plan's price — reads as
 * `not_stated`, which is how a misattributed sentence stops being the brand's defect.
 */
export function readingFor(findings: JevFinding[], claim: ExtractedClaim, brand: string): JevReading | null {
  if (normalizeKey(claim.subject) !== normalizeKey(brand)) return null;
  const finding = findings.find(
    (f) =>
      f.fact.predicate === claim.predicate &&
      (f.fact.kind !== 'multi' || f.fact.rows.some((row) => objectMatches(row.object, claim.object))),
  );
  if (!finding) return null;
  const same = { finding, outcome: finding.outcome, row: finding.row };
  const unstated = { finding, outcome: 'not_stated' as const, row: null };
  const { fact } = finding;
  if (finding.outcome === 'not_stated') return unstated;
  if (fact.kind === 'numeric') {
    const value = valueIn(claim.object, fact.numeric) ?? firstNumber(claim.object);
    return claim.polarity === 'affirm' &&
      value !== null &&
      finding.value !== null &&
      sameValue(fact.predicate, fact.numeric, value, finding.value)
      ? same
      : unstated;
  }
  if (fact.kind === 'multi') return claim.polarity === (finding.choice === 'lacks' ? 'negate' : 'affirm') ? same : unstated;
  const known = Object.values(fact.options).filter((row): row is CanonicalClaim => row !== null);
  if (claim.polarity === 'negate') {
    // Denying the value in force, where the model read another value, is the same misstatement.
    const current = fact.options.current;
    return current && finding.choice !== 'current' && objectMatches(current.object, claim.object)
      ? { finding, outcome: 'wrong', row: current }
      : unstated;
  }
  if (finding.choice === 'other') return known.some((row) => objectMatches(row.object, claim.object)) ? unstated : same;
  return finding.row && objectMatches(finding.row.object, claim.object) ? same : unstated;
}

function firstNumber(text: string): number | null {
  for (const m of text.matchAll(ANY_NUMBER)) {
    const value = toNumber(m[0]);
    if (value !== null) return value;
  }
  return null;
}

/** The Jev vote on one claim, as a verdict the verifier assigns. */
export function modelVerdict(claim: ExtractedClaim, outcome: ModelCheckOutcome, row: CanonicalClaim | null, fact: JevFact): VerificationResult {
  const why =
    outcome === 'ok'
      ? `the answer states ${fact.topic} as the registry records it`
      : outcome === 'stale' && row
        ? `the model check (Jev) read "${row.object}", which the registry records as ended on ${row.effectiveTo ?? 'an unrecorded date'}`
        : row
          ? `the model check (Jev) read the answer as misstating ${fact.topic}; the registry records "${row.object}" in force since ${row.effectiveFrom}`
          : '';
  return verdictFromModelCheck(claim, outcome, row, why);
}

/** A registry fact the model found misstated where no rules claim covers it. */
export function modelFoundClaim(finding: JevFinding, brand: string, answer: string): ExtractedClaim {
  const { fact } = finding;
  return {
    statement: finding.evidence ?? (answer.length <= 400 ? answer : `${answer.slice(0, 399)}…`),
    subject: brand,
    predicate: fact.predicate,
    object: finding.stated ?? (finding.row ? `other than ${finding.row.object}` : fact.topic),
    polarity: fact.kind === 'multi' && finding.choice === 'lacks' ? 'negate' : 'affirm',
    temporalMarker: null,
  };
}

// ------------------------------------------------------------------------ the verdict policy

/** Adjudication labels. `disputed` is the only one kept out of rollups and alerts. */
export type Adjudication = 'not_required' | 'agreed' | 'model_decided' | 'rules_only' | 'disputed';
export const SETTLED_ADJUDICATIONS: string[] = ['agreed', 'not_required', 'model_decided', 'rules_only'];

export interface EvaluatorVote {
  evaluator: 'rules' | 'jev';
  verdict: Verdict;
  confidence?: number;
  model?: string;
}

export interface ModelVote {
  result: VerificationResult;
  confidence: number;
  model: string;
}

export interface Decision {
  result: VerificationResult;
  decidedBy: 'rules' | 'jev' | 'both';
  adjudication: Adjudication;
  votes: EvaluatorVote[];
}

const DECISIVE: Verdict[] = ['SUPPORTED', 'CONTRADICTED', 'STALE'];
const DEFECTS: Verdict[] = ['CONTRADICTED', 'STALE'];

function voteOf(jev: ModelVote): EvaluatorVote {
  return { evaluator: 'jev', verdict: jev.result.verdict, confidence: Math.round(jev.confidence * 1000) / 1000, model: jev.model };
}

/**
 * Vote 1 is the rules, vote 2 the model check. A confident model check is final and the record
 * keeps whether the rules agreed. Below the threshold the rules verdict stands, but a defect the
 * model disagreed with is `disputed`: held for review instead of alerting. A registry gap or an
 * unverifiable claim stays exactly as the rules left it.
 */
export function decide(rules: VerificationResult, jev: ModelVote | null, minConfidence: number): Decision {
  const votes: EvaluatorVote[] = [{ evaluator: 'rules', verdict: rules.verdict }, ...(jev ? [voteOf(jev)] : [])];
  if (!DECISIVE.includes(rules.verdict))
    return { result: rules, decidedBy: 'rules', adjudication: 'not_required', votes };
  if (!jev) return { result: rules, decidedBy: 'rules', adjudication: 'rules_only', votes };
  if (jev.result.verdict === rules.verdict) return { result: rules, decidedBy: 'both', adjudication: 'agreed', votes };
  if (jev.confidence >= minConfidence) return { result: jev.result, decidedBy: 'jev', adjudication: 'model_decided', votes };
  return { result: rules, decidedBy: 'rules', adjudication: 'disputed', votes };
}

/** A finding no rules claim covers becomes a claim only when the model check is confident. */
export function decideModelFinding(jev: ModelVote, minConfidence: number): Decision | null {
  if (jev.confidence < minConfidence || !DEFECTS.includes(jev.result.verdict)) return null;
  return { result: jev.result, decidedBy: 'jev', adjudication: 'model_decided', votes: [voteOf(jev)] };
}

export interface ModelCheck {
  findings: JevFinding[];
  model: string;
  minConfidence: number;
}

export interface CheckedClaim {
  claim: ExtractedClaim;
  stage: ExtractorStage;
  decision: Decision;
}

/** Both checks over one answer: every rules claim with its decision, then what only the model found. */
export function checkClaims(input: {
  proposals: ProposedClaim[];
  canonical: CanonicalClaim[];
  asOf: Date;
  brand: string;
  answer: string;
  modelCheck: ModelCheck | null;
}): CheckedClaim[] {
  const { modelCheck } = input;
  const covered = new Set<JevFinding>();
  const vote = (claim: ExtractedClaim, reading: JevReading, model: ModelCheck): ModelVote => ({
    result: modelVerdict(claim, reading.outcome, reading.row, reading.finding.fact),
    confidence: reading.finding.confidence,
    model: model.model,
  });
  const checked: CheckedClaim[] = input.proposals.map(({ claim, stage }) => {
    const rules = verifyClaim({ claim, canonicalClaims: input.canonical, asOf: input.asOf });
    const reading = modelCheck ? readingFor(modelCheck.findings, claim, input.brand) : null;
    if (reading && reading.outcome === reading.finding.outcome) covered.add(reading.finding);
    const jev = reading && modelCheck ? vote(claim, reading, modelCheck) : null;
    return { claim, stage, decision: decide(rules, jev, modelCheck?.minConfidence ?? 1) };
  });
  for (const finding of modelCheck?.findings ?? []) {
    if (covered.has(finding) || (finding.outcome !== 'wrong' && finding.outcome !== 'stale')) continue;
    const claim = modelFoundClaim(finding, input.brand, input.answer);
    const decision = decideModelFinding(
      vote(claim, { finding, outcome: finding.outcome, row: finding.row }, modelCheck!),
      modelCheck!.minConfidence,
    );
    if (decision) checked.push({ claim, stage: 'model_check', decision });
  }
  return checked;
}

// ------------------------------------------------------------------------ provenance and copy

export type CheckProvenance = 'agreed' | 'model_decided' | 'model_found' | 'rules_only';
export const CHECK_PROVENANCES: CheckProvenance[] = ['agreed', 'model_decided', 'model_found', 'rules_only'];

/** What a reader is told about which checks stand behind a defect. Never two when one ran. */
export const CHECK_COPY: Record<CheckProvenance, string> = {
  agreed: 'Two independent checks agreed: the registry rules and a Jev model judgment.',
  model_decided: 'Decided by the model check (Jev); the rule-based check reached a different verdict.',
  model_found: 'Found by the model check (Jev); the rule-based check did not flag it.',
  rules_only: 'Rule-based check only — model check unavailable.',
};

const CHECK_PART: Record<CheckProvenance, string> = {
  agreed: 'confirmed by both the registry rules and the Jev model check',
  model_decided: 'decided by the model check (Jev) over a different rule-based verdict',
  model_found: 'found by the model check (Jev) alone',
  rules_only: 'rule-based check only, model check unavailable',
};

export type CheckTally = Record<CheckProvenance, number>;

export function emptyTally(): CheckTally {
  return { agreed: 0, model_decided: 0, model_found: 0, rules_only: 0 };
}

/**
 * Which checks stand behind a stored claim. Rows written before the model check existed carry
 * a bare verdict list from the same rules run twice; that was one check, and it reads as one.
 */
export function checkProvenance(claim: { adjudication?: string | null; evaluator_votes?: string | null }): CheckProvenance {
  if (claim.evaluator_votes === undefined || claim.evaluator_votes === null)
    return claim.adjudication === 'agreed' || claim.adjudication === 'model_decided' ? claim.adjudication : 'rules_only';
  let votes: unknown;
  try {
    votes = JSON.parse(claim.evaluator_votes);
  } catch {
    return 'rules_only';
  }
  const list = Array.isArray(votes) ? (votes as Array<Partial<EvaluatorVote> | null>) : [];
  const rules = list.find((vote) => vote?.evaluator === 'rules');
  if (!list.some((vote) => vote?.evaluator === 'jev')) return 'rules_only';
  if (claim.adjudication === 'agreed') return 'agreed';
  if (claim.adjudication === 'model_decided')
    return rules?.verdict && DEFECTS.includes(rules.verdict) ? 'model_decided' : 'model_found';
  return 'rules_only';
}

/** One sentence for a group of claims; a mixed group gets the count behind each kind. */
export function describeChecks(tally: CheckTally): string {
  const present = CHECK_PROVENANCES.filter((kind) => tally[kind] > 0);
  if (present.length <= 1) return CHECK_COPY[present[0] ?? 'rules_only'];
  const total = present.reduce((sum, kind) => sum + tally[kind], 0);
  return `Checks behind these ${total} statements: ${present.map((kind) => `${tally[kind]} ${CHECK_PART[kind]}`).join('; ')}.`;
}
