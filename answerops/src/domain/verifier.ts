/**
 * Claim and citation verifier — the wedge.
 *
 * Sentiment analysis says "73% positive". This module says "the answer states you were
 * acquired by the wrong company, two years early, and cites nothing". One of those is a
 * defect report; the other is decoration.
 */

import { CanonicalClaim, currentTruths, objectMatches, truthHistory, normalizeKey } from './truth.js';

export type Verdict =
  | 'SUPPORTED'
  | 'CONTRADICTED'
  | 'STALE'
  | 'UNSUPPORTED'
  | 'UNVERIFIABLE'
  | 'NOT_APPLICABLE';

export type BrandRole = 'absent' | 'mentioned' | 'compared' | 'recommended' | 'disrecommended';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type CitationSupport = 'supports' | 'contradicts' | 'absent' | 'unreachable' | 'paywalled';
export type SourceClass =
  | 'owned'
  | 'independent_credible'
  | 'independent_low_quality'
  | 'ugc'
  | 'spam'
  | 'competitor'
  | 'unknown';

export interface ExtractedClaim {
  statement: string;
  subject: string;
  predicate: string;
  object: string;
  polarity: 'affirm' | 'negate';
  temporalMarker: string | null;
}

interface PredicatePattern {
  predicate: string;
  patterns: RegExp[];
  /** when the sentence carries a negation, this predicate flips polarity rather than changing object */
  negatable?: boolean;
}

/**
 * Pattern-driven extraction. Deterministic and auditable by design: a customer can read
 * exactly why we decided their answer asserted something. A model check (Jev, see `jev.ts`) is
 * layered on top in production as a second vote, never underneath it.
 */
export const PREDICATE_PATTERNS: PredicatePattern[] = [
  {
    predicate: 'acquired_by',
    patterns: [
      /\bwas acquired by ([A-Z][\w&.\- ]+?)(?=[,.;]|\s+in\b|\s+for\b|$)/,
      /\bacquisition (?:of [\w .&-]+ )?by ([A-Z][\w&.\- ]+?)(?=[,.;]|\s+in\b|$)/,
      /\b(?:is|are) (?:now )?(?:owned|operated) by ([A-Z][\w&.\- ]+?)(?=[,.;]|$)/,
    ],
  },
  {
    predicate: 'ceo',
    patterns: [
      /\b(?:ceo|chief executive)(?: is| of [\w .&-]+ is)? ([A-Z][\w.\- ]+?)(?=[,.;]|$)/i,
      /\bled by ([A-Z][\w.\- ]+?)(?=[,.;]|\s+since\b|$)/,
    ],
  },
  {
    predicate: 'pricing',
    patterns: [
      /\b(?:starts? at|priced at|costs?|pricing (?:starts|begins) (?:at|from)) (\$[\d,.]+(?:\s?(?:per|\/)\s?\w+)?)/i,
      /\bfree tier (?:is |remains )?(available|discontinued)/i,
    ],
  },
  {
    predicate: 'fees',
    patterns: [
      /\b(?:transaction |network |gas )?fees? (?:are|is|of)?\s*(?:around|approximately|about|roughly|typically|under|~)?\s*(\$?[\d.,]+\s?(?:%|usd|cents?)?)/i,
    ],
  },
  {
    predicate: 'feature_support',
    negatable: true,
    patterns: [
      /\b(?:supports?|offers?|provides?|includes?|has) ((?:sso|single sign-on|saml|scim|api access|webhooks|audit logs|two-factor authentication|mfa|staking|bridging|smart contracts)\b)/i,
      /\b(?:does not|doesn't|does not currently|lacks|has no|no) (?:support |offer |provide |have )?((?:sso|single sign-on|saml|scim|api access|webhooks|audit logs|two-factor authentication|mfa|staking|bridging|smart contracts)\b)/i,
    ],
  },
  {
    predicate: 'integration',
    negatable: true,
    patterns: [
      /\b[Ii]ntegrat(?:es|ion|ions) (?:with|for) ([A-Z][\w&.\- ]+?)(?=[,.;]|\s+and\b|\s+is\b|$)/,
      /\bno(?:t)? (?:native )?integration with ([A-Z][\w&.\- ]+?)(?=[,.;]|$)/,
    ],
  },
  {
    predicate: 'availability',
    negatable: true,
    patterns: [
      /\b(?:available|listed|live|tradable) (?:on|in) ([A-Z][\w&.\- ]+?)(?=[,.;]|\s+and\b|$)/,
      /\bnot (?:available|listed) (?:on|in) ([A-Z][\w&.\- ]+?)(?=[,.;]|$)/,
    ],
  },
  {
    predicate: 'product_status',
    patterns: [
      /\b(?:has been |was )?(discontinued|deprecated|sunset|shut down|no longer maintained)\b/i,
      /\b(?:is|remains) (actively maintained|in production|generally available)\b/i,
    ],
  },
  {
    predicate: 'compliance',
    patterns: [
      /\b(?:is )?(soc ?2(?: type ?(?:i{1,2}|\d))?|iso ?27001|gdpr[- ]compliant|hipaa[- ]compliant|mica[- ]registered)\b/i,
    ],
  },
  {
    predicate: 'token_supply',
    patterns: [
      /\b(?:total|max(?:imum)?|circulating) supply (?:is |of )?([\d.,]+ ?(?:billion|million|b|m)?)/i,
    ],
  },
  {
    predicate: 'headquarters',
    patterns: [/\b(?:headquartered|based) in ([A-Z][\w.\- ]+?(?:, ?[A-Z][\w.\- ]+)?)(?=[,.;]|$)/],
  },
];

// Negation for the negatable predicates. Deliberately enumerated rather than "any nearby no":
// a bare negative particle floating in a sentence flips claims it was never about.
export const NEGATION_RE =
  /\b(?:does not|doesn't|do not|don't|cannot|can't|lacks|has no|have no|there is no|there's no|no longer|without (?:any )?(?:native |direct |official )?(?:support|integration|listing)|no (?:native |direct |official )?(?:support|integration|listing|access)|not (?:available|listed|supported|offered|integrated))\b/i;

// A year dates a claim only when a preposition ties it to the claim: "in 2019", "until 2023",
// "as of May 2022", "since 2020", or a bare "(2021)" after it.
const GOVERNED_YEAR =
  '\\b(?:in|since|until|till|through|as of|by|from|back in|during)\\s+(?:(?:early|mid|late)[\\s-]+)?' +
  '(?:(?:q[1-4]|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|' +
  'oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+(?:\\d{1,2},?\\s+)?)?((?:19|20)\\d{2})\\b|\\(((?:19|20)\\d{2})\\)';
const GOVERNED_YEAR_RE = new RegExp(GOVERNED_YEAR, 'gi');
const TEMPORAL_INTRO_RE = new RegExp(`^\\s*(?:${GOVERNED_YEAR})\\s*$`, 'i');
const FOUNDING_RE = /\b(?:founded|established|incorporated|formed|founding|inception)\b/i;
const RELATIVE_TIME_RE = /\b(?:last year|this year|recently|a few years back)\b/i;
// Where one statement ends and the next begins: sentence ends, markdown bold, table cells,
// dashes and bullets, semicolons.
const STATEMENT_BOUNDARY_RE = /[.!?](?=\s|$)|\*\*|\||\s[-–—•]\s|;/g;

/**
 * The date an answer attaches to the claim matched at [start, end) of `text`, or null. Only a
 * year governed by a preposition in the claim's own clause counts (or a clause that is nothing
 * but such a phrase, as in "In 2019, ..."). A founding year in the next bolded item or another
 * table cell is not the date of this claim, and treating it as one manufactures STALE verdicts.
 */
export function claimTemporalMarker(text: string, start: number, end: number): string | null {
  const around = (pattern: RegExp, from: number, to: number) => {
    let left = from,
      right = to;
    for (const boundary of text.slice(from, to).matchAll(pattern)) {
      const at = from + boundary.index!;
      if (at + boundary[0].length <= start) left = at + boundary[0].length;
      else if (at >= end) {
        right = at;
        break;
      }
    }
    return [left, right];
  };
  const [segmentFrom, segmentTo] = around(STATEMENT_BOUNDARY_RE, 0, text.length);
  const [clauseFrom, clauseTo] = around(/,(?!\d{3}\b)/g, segmentFrom, segmentTo);
  const ranges = [[clauseFrom, clauseTo]];
  const before = text.slice(segmentFrom, Math.max(segmentFrom, clauseFrom - 1)).split(',').pop() ?? '';
  if (TEMPORAL_INTRO_RE.test(before)) ranges.push([clauseFrom - 1 - before.length, clauseFrom - 1]);
  const after = text.slice(Math.min(segmentTo, clauseTo + 1), segmentTo).split(',')[0];
  if (clauseTo < segmentTo && TEMPORAL_INTRO_RE.test(after)) ranges.push([clauseTo + 1, clauseTo + 1 + after.length]);
  let best: { year: string; distance: number } | null = null;
  for (const [from, to] of ranges)
    for (const match of text.slice(from, to).matchAll(GOVERNED_YEAR_RE)) {
      const at = from + match.index!,
        until = at + match[0].length;
      if (until > start && at < end) continue;
      if (FOUNDING_RE.test(text.slice(Math.max(from, at - 40), at))) continue;
      const distance = at >= end ? at - end : start - until;
      if (!best || distance < best.distance) best = { year: match[1] ?? match[2], distance };
    }
  return best?.year ?? text.slice(clauseFrom, clauseTo).match(RELATIVE_TIME_RE)?.[0] ?? null;
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Split on coordinating conjunctions only when both halves carry a predicate-bearing verb. */
export function splitClauses(sentence: string): string[] {
  const parts = sentence.split(/,? (?:but|and|while|whereas) /i);
  if (parts.length === 1) return [sentence];
  const bearing = parts.filter((p) =>
    /\b(is|are|was|were|has|have|does|do|supports?|offers?|acquired|costs?|lacks)\b/i.test(p),
  );
  return bearing.length >= 2 ? parts.map((p) => p.trim()) : [sentence];
}

export function extractClaims(answerText: string, subjectHint: string): ExtractedClaim[] {
  const proposals = splitSentences(answerText)
    .flatMap((sentence) => splitClauses(sentence))
    .flatMap((clause) => {
      return PREDICATE_PATTERNS.flatMap((rule) => {
        for (const expression of rule.patterns) {
          const match = clause.match(expression);
          if (!match) continue;
          const object = (match[1] ?? match[0]).trim().replace(/[.,;:]+$/, '');
          if (!object) continue;
          const claim: ExtractedClaim = {
            subject: subjectHint.trim() || 'unknown',
            statement: clause.trim(),
            predicate: rule.predicate,
            object,
            polarity: rule.negatable && NEGATION_RE.test(clause) ? 'negate' : 'affirm',
            temporalMarker: claimTemporalMarker(clause, match.index!, match.index! + match[0].length),
          };
          return [claim];
        }
        return [];
      });
    });
  return dedupeClaims(proposals);
}

function dedupeClaims(claims: ExtractedClaim[]): ExtractedClaim[] {
  const unique = new Map<string, ExtractedClaim>();
  claims.forEach((claim) => {
    const key = [
      normalizeKey(claim.subject),
      claim.predicate,
      normalizeKey(claim.object),
      claim.polarity,
    ].join('|');
    if (!unique.has(key)) unique.set(key, claim);
  });
  return Array.from(unique.values());
}

function inferSubject(clause: string, subjectHint: string): string {
  // If the brand is named in the clause, it is the subject; otherwise inherit the prompt subject.
  const hint = subjectHint.trim();
  if (hint && new RegExp(`\\b${escapeRe(hint)}\\b`, 'i').test(clause)) return hint;
  return hint || 'unknown';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Human labels for predicates, so a headline reads like a sentence a CMO would say. */
export const PREDICATE_LABEL: Record<string, string> = {
  acquired_by: 'your ownership and acquisition status',
  ceo: 'your leadership',
  pricing: 'your pricing',
  fees: 'your transaction fees',
  feature_support: 'which features you support',
  integration: 'your integrations',
  availability: 'where you are available to buy or use',
  product_status: 'whether your product is still live',
  compliance: 'your compliance status',
  token_supply: 'your token supply',
  headquarters: 'where you are based',
  funding: 'how much you have raised',
  employee_count: 'how big your team is',
  founded_year: 'when you were founded',
  certification: 'your licences and certifications',
  partnership: 'who you work with',
  brand_presence: 'your presence in the answer',
};

export function predicateLabel(predicate: string): string {
  return PREDICATE_LABEL[predicate] ?? predicate.replace(/_/g, ' ');
}

// --------------------------------------------------------------------- verdicts

export interface VerificationInput {
  claim: ExtractedClaim;
  canonicalClaims: CanonicalClaim[];
  asOf: Date;
}

export interface VerificationResult {
  verdict: Verdict;
  canonicalClaimId: string | null;
  severity: Severity;
  misconceptionKey: string | null;
  explanation: string;
  requiresAdjudication: boolean;
}

/** Predicates where several values are true at once: a brand has more than one integration. */
export const MULTI_VALUED_PREDICATES = ['integration', 'feature_support'];

export function verifyClaim(input: VerificationInput): VerificationResult {
  const { claim, asOf, canonicalClaims } = input;
  // Every row in force stays true; the claim is judged against the row for its own entity,
  // not against whichever row happens to be newest.
  const inForce = currentTruths(canonicalClaims, claim.subject, claim.predicate, asOf);
  const current = inForce.find((row) => objectMatches(row.object, claim.object)) ?? inForce[0] ?? null;
  const history = truthHistory(canonicalClaims, claim.subject, claim.predicate);
  const unverifiable = (canonicalClaimId: string | null, explanation: string): VerificationResult => ({
    verdict: 'UNVERIFIABLE',
    canonicalClaimId,
    severity: 'low',
    misconceptionKey: null,
    explanation,
    requiresAdjudication: false,
  });
  const supported = (canonical: CanonicalClaim, explanation: string): VerificationResult => ({
    verdict: 'SUPPORTED',
    canonicalClaimId: canonical.id,
    severity: 'low',
    misconceptionKey: null,
    explanation,
    requiresAdjudication: false,
  });
  const gap = (what: string): VerificationResult => ({
    verdict: 'UNSUPPORTED',
    canonicalClaimId: null,
    severity: 'medium',
    misconceptionKey: misconception(claim),
    explanation:
      'No approved canonical fact exists for ' +
      what +
      '. The model is asserting something the truth registry cannot confirm or deny — a registry gap, not yet a defect.',
    requiresAdjudication: false,
  });
  if (!current) {
    if (!history.length) return gap(claim.subject + ' / ' + claim.predicate);
    const expired = history.find((row) => objectMatches(row.object, claim.object));
    return expired
      ? staleResult(expired, claim, 'the fact it states expired and has no current successor')
      : unverifiable(null, 'No canonical fact is in force for this subject/predicate at the sampled time.');
  }
  const same = objectMatches(current.object, claim.object);
  if (!same && (inForce.length > 1 || MULTI_VALUED_PREDICATES.includes(claim.predicate))) {
    // A multi-valued fact lists what is true, not everything that is false: an entity the
    // registry never names is a gap, and one whose row has ended is stale.
    const ended = history.find(
      (row) =>
        row.effectiveTo !== null &&
        Date.parse(row.effectiveTo) <= +asOf &&
        objectMatches(row.object, claim.object),
    );
    if (ended)
      return claim.polarity === 'negate'
        ? supported(ended, 'Matches the canonical record: this ended on ' + ended.effectiveTo + '.')
        : staleResult(ended, claim, 'the registry records that it ended on ' + ended.effectiveTo);
    return claim.polarity === 'negate'
      ? unverifiable(null, 'Negative statement about something outside the canonical record.')
      : gap(claim.subject + ' / ' + claim.predicate + ' / "' + claim.object + '"');
  }
  if (claim.polarity === 'negate')
    return same
      ? contradiction(
          current,
          claim,
          'the answer denies a capability the registry says is in force since ' + current.effectiveFrom,
        )
      : unverifiable(current.id, 'Negative statement about something outside the canonical record.');
  if (!same) {
    const previous = history.find((row) => row.id !== current.id && objectMatches(row.object, claim.object));
    return previous
      ? staleResult(
          previous,
          claim,
          'superseded on ' + (previous.effectiveTo ?? 'an unrecorded date') + ' by "' + current.object + '"',
        )
      : contradiction(
          current,
          claim,
          'the registry records "' + current.object + '" in force since ' + current.effectiveFrom,
        );
  }
  const year = new Date(current.effectiveFrom).getUTCFullYear();
  if (claim.temporalMarker && /^\d{4}$/.test(claim.temporalMarker) && Number(claim.temporalMarker) < year)
    return staleResult(
      current,
      claim,
      'the answer dates the fact to ' + Number(claim.temporalMarker) + ', but it took effect in ' + year,
    );
  return supported(current, 'Matches the canonical fact in force since ' + current.effectiveFrom + '.');
}

function contradiction(canonical: CanonicalClaim, claim: ExtractedClaim, why: string): VerificationResult {
  const severity: Severity =
    canonical.sensitivity === 'regulated'
      ? 'critical'
      : canonical.sensitivity === 'material'
        ? 'critical'
        : 'high';
  return {
    verdict: 'CONTRADICTED',
    canonicalClaimId: canonical.id,
    severity,
    misconceptionKey: misconception(claim),
    explanation: `The answer states "${claim.object}" — ${why}.`,
    requiresAdjudication: canonical.sensitivity !== 'routine',
  };
}

function staleResult(canonical: CanonicalClaim, claim: ExtractedClaim, why: string): VerificationResult {
  const severity: Severity = canonical.sensitivity === 'routine' ? 'medium' : 'high';
  return {
    verdict: 'STALE',
    canonicalClaimId: canonical.id,
    severity,
    misconceptionKey: misconception(claim),
    explanation: `The answer repeats a fact that was once true — ${why}. Sourced is not the same as current.`,
    requiresAdjudication: false,
  };
}

/** What the Jev model check read in the answer for one registry fact. */
export type ModelCheckOutcome = 'ok' | 'wrong' | 'stale' | 'not_stated';

/**
 * The model check's reading of a registry fact, as a verdict. The mapping lives here, beside the
 * rules, so every verdict is still decided in this one module.
 */
export function verdictFromModelCheck(
  claim: ExtractedClaim,
  outcome: ModelCheckOutcome,
  canonical: CanonicalClaim | null,
  why: string,
): VerificationResult {
  if (canonical && outcome === 'wrong') return contradiction(canonical, claim, why);
  if (canonical && outcome === 'stale') return staleResult(canonical, claim, why);
  if (canonical && outcome === 'ok')
    return {
      verdict: 'SUPPORTED',
      canonicalClaimId: canonical.id,
      severity: 'low',
      misconceptionKey: null,
      explanation: `The model check (Jev) read that ${why}.`,
      requiresAdjudication: false,
    };
  return {
    verdict: 'NOT_APPLICABLE',
    canonicalClaimId: null,
    severity: 'low',
    misconceptionKey: null,
    explanation:
      'The model check (Jev) read the answer as not stating this about ' +
      claim.subject +
      ': the sentence may describe another company or a past state.',
    requiresAdjudication: false,
  };
}

/** Stable key so "models keep saying we lack SSO" is countable across surfaces and time. */
export function misconception(claim: ExtractedClaim): string {
  return `${normalizeKey(claim.subject)}.${claim.predicate}.${claim.polarity}.${normalizeKey(claim.object)}`;
}

// ----------------------------------------------------------------- brand role

export function classifyBrandRole(
  answerText: string,
  brandName: string,
  competitors: string[] = [],
): BrandRole {
  const re = new RegExp(`\\b${escapeRe(brandName)}\\b`, 'i');
  if (!re.test(answerText)) return 'absent';
  const lower = answerText.toLowerCase();
  const name = brandName.toLowerCase();

  const disrecommend = new RegExp(
    `(avoid|steer clear of|would not recommend|don't recommend|do not recommend|not a good (?:choice|fit)|look elsewhere)[^.]{0,60}${escapeRe(name)}|${escapeRe(name)}[^.]{0,60}(is not recommended|should be avoided|is a poor (?:choice|fit))`,
    'i',
  );
  if (disrecommend.test(lower)) return 'disrecommended';

  const recommend = new RegExp(
    `(recommend|best (?:choice|option|fit)|top pick|go with|i'd (?:pick|choose)|strongest option)[^.]{0,60}${escapeRe(name)}|${escapeRe(name)}[^.]{0,80}(is the best|is your best|is the strongest|is the top)`,
    'i',
  );
  if (recommend.test(lower)) return 'recommended';

  if (competitors.some((c) => new RegExp(`\\b${escapeRe(c)}\\b`, 'i').test(answerText))) return 'compared';
  return 'mentioned';
}

// -------------------------------------------------------------- citations

export interface CitationCheckInput {
  url: string;
  /** snapshot of the cited page — production fetches and stores this; never trust the URL alone */
  snapshotText: string | null;
  claimObject: string;
  claimSubject: string;
  ownedDomains: string[];
  competitorDomains?: string[];
}

export interface CitationCheckResult {
  support: CitationSupport;
  sourceClass: SourceClass;
  reason: string;
}

const CREDIBLE_TLD = /\.(gov|edu)$/i;
const KNOWN_CREDIBLE =
  /(reuters\.com|bloomberg\.com|ft\.com|wsj\.com|techcrunch\.com|coindesk\.com|sec\.gov)$/i;
const UGC =
  /(reddit\.com|quora\.com|medium\.com|x\.com|twitter\.com|youtube\.com|stackexchange\.com|stackoverflow\.com)$/i;
const REVIEW = /(g2\.com|capterra\.com|trustpilot\.com|trustradius\.com)$/i;
const SPAMMY = /(top10|best-?reviews?|-?coupons?|listicle|affiliate)/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function classifySource(
  url: string,
  ownedDomains: string[],
  competitorDomains: string[] = [],
): SourceClass {
  const host = hostOf(url);
  if (!host) return 'unknown';
  const belongs = (domains: string[]) =>
    domains.some((domain) => domain === host || host.endsWith('.' + domain));
  if (belongs(ownedDomains)) return 'owned';
  if (belongs(competitorDomains)) return 'competitor';
  const checks: Array<[boolean, SourceClass]> = [
    [SPAMMY.test(url), 'spam'],
    [REVIEW.test(host) || UGC.test(host), 'ugc'],
    [CREDIBLE_TLD.test(host) || KNOWN_CREDIBLE.test(host), 'independent_credible'],
  ];
  return checks.find(([matches]) => matches)?.[1] ?? 'independent_low_quality';
}

/** Does the cited page actually contain the claim it is cited for? Usually nobody checks. */
export function checkCitation(input: CitationCheckInput): CitationCheckResult {
  const sourceClass = classifySource(input.url, input.ownedDomains, input.competitorDomains);
  const result = (support: CitationSupport, reason: string): CitationCheckResult => ({
    support,
    sourceClass,
    reason,
  });
  const snapshot = input.snapshotText;
  if (snapshot === null) return result('unreachable', 'Snapshot could not be retrieved at sampling time.');
  if (/subscribe to (?:continue|read)|paywall|sign in to read/i.test(snapshot))
    return result('paywalled', 'Page is gated; the model could not have verified it either.');
  const object = input.claimObject.toLowerCase().trim(),
    subject = input.claimSubject.toLowerCase().trim();
  const text = snapshot.toLowerCase();
  if (!object || !text.includes(object) || (subject && !text.includes(subject)))
    return result('absent', 'The cited page does not contain the claim it was cited for.');
  if (new RegExp('(?:not|never|no longer)[^.]{0,40}' + escapeRe(object), 'i').test(snapshot))
    return result('contradicts', 'The cited page states the opposite of the claim it was cited for.');
  return result('supports', 'The cited page contains the claim.');
}

/**
 * Agreement between two verdicts on one claim. Production no longer calls this: the rules and
 * the Jev model check are combined by `decide` in `jev.ts`, which records which of them ran.
 */
export function adjudicate(votes: Verdict[]): 'not_required' | 'pending' | 'agreed' | 'disputed' {
  if (votes.length < 2) return 'pending';
  const [a, b] = votes;
  return a === b ? 'agreed' : 'disputed';
}
