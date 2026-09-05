/**
 * Claim and citation verifier — the wedge.
 *
 * Sentiment analysis says "73% positive". This module says "the answer states you were
 * acquired by the wrong company, two years early, and cites nothing". One of those is a
 * defect report; the other is decoration.
 */

import { CanonicalClaim, objectMatches, resolveTruth, truthHistory, normalizeKey } from './truth.js';

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
 * exactly why we decided their answer asserted something. Model-based extraction is layered
 * on top in production (see `evaluatorVotes`), never underneath it.
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
const YEAR_RE = /\b(19|20)\d{2}\b/;
const RELATIVE_TIME_RE =
  /\b(?:last year|this year|recently|as of \w+ (?:19|20)\d{2}|since (?:19|20)\d{2})\b/i;

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
      const temporalMarker = clause.match(YEAR_RE)?.[0] ?? clause.match(RELATIVE_TIME_RE)?.[0] ?? null;
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
            temporalMarker,
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

export function verifyClaim(input: VerificationInput): VerificationResult {
  const { claim, asOf, canonicalClaims } = input;
  const current = resolveTruth(canonicalClaims, claim.subject, claim.predicate, asOf);
  const history = truthHistory(canonicalClaims, claim.subject, claim.predicate);
  const unverifiable = (canonicalClaimId: string | null, explanation: string): VerificationResult => ({
    verdict: 'UNVERIFIABLE',
    canonicalClaimId,
    severity: 'low',
    misconceptionKey: null,
    explanation,
    requiresAdjudication: false,
  });
  if (!current) {
    if (!history.length)
      return {
        verdict: 'UNSUPPORTED',
        canonicalClaimId: null,
        severity: 'medium',
        misconceptionKey: misconception(claim),
        explanation:
          'No approved canonical fact exists for ' +
          claim.subject +
          ' / ' +
          claim.predicate +
          '. The model is asserting something the truth registry cannot confirm or deny — a registry gap, not yet a defect.',
        requiresAdjudication: false,
      };
    const expired = history.find((row) => objectMatches(row.object, claim.object));
    return expired
      ? staleResult(expired, claim, 'the fact it states expired and has no current successor')
      : unverifiable(null, 'No canonical fact is in force for this subject/predicate at the sampled time.');
  }
  const same = objectMatches(current.object, claim.object);
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
  return {
    verdict: 'SUPPORTED',
    canonicalClaimId: current.id,
    severity: 'low',
    misconceptionKey: null,
    explanation: 'Matches the canonical fact in force since ' + current.effectiveFrom + '.',
    requiresAdjudication: false,
  };
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
 * Dual adjudication for high-risk verdicts: two independent evaluators must agree before a
 * material/regulated contradiction is allowed to alert a customer.
 */
export function adjudicate(votes: Verdict[]): 'not_required' | 'pending' | 'agreed' | 'disputed' {
  if (votes.length < 2) return 'pending';
  const [a, b] = votes;
  return a === b ? 'agreed' : 'disputed';
}
