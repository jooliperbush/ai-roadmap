/**
 * Two-stage claim extraction.
 *
 * Stage one proposes tuples. Stage two — `verifyClaim()` in verifier.ts — is the only thing
 * that ever assigns a verdict. That split is the whole design: a proposer may be a regex, a
 * heuristic, or a language model, and none of them are allowed to decide whether a customer
 * has a defect. Widening recall must never widen who gets to adjudicate.
 *
 * Every proposal is grounded: if the object it claims to have found is not actually present in
 * the answer text, it is discarded. A model that helpfully infers "they were acquired by
 * Meta" from a sentence that does not say so produces a defect report about nothing.
 */

import {
  extractClaims,
  PREDICATE_PATTERNS,
  NEGATION_RE as CANONICAL_NEGATION,
  type ExtractedClaim,
} from './verifier.js';
import { normalizeKey } from './truth.js';

export const EXTRACTOR_VERSION = 'v2-pattern+heuristic';

/**
 * The gates the published evaluation must clear.
 *
 * They live here rather than in the eval script so the test suite and the script cannot drift
 * apart: a gate the script enforces and the tests do not is a gate nobody enforces on the day
 * it matters.
 */
export const PRECISION_GATE = 0.9;
export const RECALL_LIFT_GATE = 0.25;

export type ExtractorStage = 'pattern' | 'heuristic' | 'model_proposed';

export interface ProposedClaim {
  claim: ExtractedClaim;
  stage: ExtractorStage;
  proposer: string;
}

/** The closed vocabulary a proposer may use. Anything outside it is dropped. */
export const PREDICATE_VOCAB: string[] = [
  ...new Set([
    ...PREDICATE_PATTERNS.map((p) => p.predicate),
    'funding',
    'employee_count',
    'founded_year',
    'certification',
    'partnership',
  ]),
];

export interface ClaimProposer {
  key: string;
  stage: ExtractorStage;
  propose(text: string, brand: string): ExtractedClaim[];
}

// ------------------------------------------------------------------- grounding

/** Bounded Levenshtein: stops early once the distance exceeds `max`. */
export function levenshtein(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let row = Array.from({ length: b.length + 1 }, (_, column) => column);
  for (let i = 0; i < a.length; i++) {
    let diagonal = row[0];
    row[0] = i + 1;
    let best = row[0];
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = Math.min(previous + 1, row[j - 1] + 1, diagonal + Number(a[i] !== b[j - 1]));
      diagonal = previous;
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
  }
  return row[b.length];
}

/**
 * Is this object actually in the text? Exact substring first, then a windowed fuzzy match at
 * edit distance 2, which tolerates a stray comma or a plural but not an invention.
 */
export function isGrounded(object: string, text: string, maxDistance = 2): boolean {
  const needle = object.trim().toLowerCase(),
    haystack = text.toLowerCase();
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  if (needle.length <= 3) return false;
  const finalStart = haystack.length - needle.length + maxDistance;
  for (let start = 0; start <= finalStart; start++) {
    for (let length = needle.length - 1; length <= needle.length + 1; length++) {
      const candidate = haystack.substring(start, start + length);
      if (candidate.length && levenshtein(needle, candidate, maxDistance) <= maxDistance) return true;
    }
  }
  return false;
}

export function groundProposal(claim: ExtractedClaim, text: string): boolean {
  if (!PREDICATE_VOCAB.includes(claim.predicate)) return false;
  return isGrounded(claim.object, text);
}

// ------------------------------------------------------------------- proposers

/** Stage one as it has always been: the auditable regex layer. */
export const patternProposer: ClaimProposer = {
  key: 'pattern',
  stage: 'pattern',
  propose: (text, brand) => extractClaims(text, brand),
};

interface HeuristicRule {
  predicate: string;
  patterns: RegExp[];
  negatable?: boolean;
}

/**
 * Deterministic recall widening. Every rule here exists because a real phrasing slipped past
 * the strict patterns: "bought out by", "they're run by", "charges about", "we're told they
 * have no SSO". Still auditable, still explainable to a customer, just less brittle.
 */
export const HEURISTIC_RULES: HeuristicRule[] = [
  {
    predicate: 'acquired_by',
    patterns: [
      /\b(?:bought(?: out)?|snapped up|taken over|picked up|absorbed) by ([A-Z][\w&.'\- ]+?)(?=[,.;)]|\s+in\b|\s+back\b|\s+a few\b|$)/,
      /\b(?:part of|a subsidiary of|under the (?:umbrella|ownership) of) ([A-Z][\w&.'\- ]+?)(?=[,.;)]|$)/,
      /\b([A-Z][\w&.'\- ]+?) (?:acquired|bought|purchased) (?:them|it|the company)\b/,
    ],
  },
  {
    predicate: 'ceo',
    patterns: [
      /\b(?:run|headed|founded and led|currently led) by ([A-Z][\w.'\- ]+?)(?=[,.;)]|\s+since\b|$)/,
      /\b(?:their|its|the) (?:chief exec(?:utive)?|boss|founder and ceo) (?:is )?([A-Z][\w.'\- ]+?)(?=[,.;)]|$)/,
    ],
  },
  {
    predicate: 'fees',
    patterns: [
      /\b(?:charges?|charging|you(?:'ll| will) pay|works out (?:at|to)) (?:around |about |roughly |approximately |~)?(\$?[\d.,]+\s?(?:%|usd|cents?|per (?:transaction|tx))?)/i,
      /\b(?:gas|network|transaction) costs? (?:of |around |about )?(\$?[\d.,]+)/i,
    ],
  },
  {
    predicate: 'pricing',
    patterns: [
      /\b(?:plans? (?:start|begin)|entry tier is|cheapest plan is) (?:from |at )?(\$[\d,.]+(?:\s?(?:per|\/)\s?\w+)?)/i,
      /\b(?:it(?:'s| is)|they(?:'re| are)) (free|paid[- ]only|freemium)\b/i,
    ],
  },
  {
    predicate: 'feature_support',
    negatable: true,
    patterns: [
      /\b(?:no|without|missing|lacking|lacks|there(?:'s| is) no) ((?:sso|single sign-on|saml|scim|api access|webhooks|audit logs|two-factor authentication|mfa|staking|bridging|smart contracts)\b)/i,
      /\b(?:you (?:can|do) get|ships? with|comes? with|built[- ]in) ((?:sso|single sign-on|saml|scim|api access|webhooks|audit logs|two-factor authentication|mfa|staking|bridging|smart contracts)\b)/i,
    ],
  },
  {
    predicate: 'integration',
    negatable: true,
    patterns: [
      /\b(?:connects?|hooks?) (?:up )?(?:to|with) ([A-Z][\w&.'\- ]+?)(?=[,.;)]|\s+and\b|$)/,
      /\b(?:there(?:'s| is) )?no (?:native |direct |official )?integration with ([A-Z][\w&.'\- ]+?)(?=[,.;)]|$)/i,
      /\b[Ii]ntegration(?:s)? (?:with|for) ([A-Z][\w&.'\- ]+?)(?=[,.;)]|\s+and\b|\s+is\b|$)/,
      /\b(?:native |first[- ]class )?integration(?:s)? (?:with|for) ([A-Z][\w&.'\- ]+?)(?=[,.;)]|\s+and\b|$)/,
    ],
  },
  {
    predicate: 'product_status',
    patterns: [
      /\b(?:they|it|the (?:product|project|chain)) (?:has|have)? ?(?:since )?(shut down|wound down|gone quiet|been mothballed)\b/i,
      /\b(?:still|very much) (going|active|alive|shipping)\b/i,
    ],
  },
  {
    predicate: 'availability',
    negatable: true,
    patterns: [
      /\b[Yy]ou can (?:buy|trade|get) it on ([A-Z][\w&.'\- ]+?)(?=[,.;)]|\s+and\b|$)/,
      /\b(?:trades on|can be bought on|is tradable on) ([A-Z][\w&.'\- ]+?)(?=[,.;)]|\s+and\b|$)/,
      /\b(?:is(?:n't| not) (?:on|listed on)|was delisted from) ([A-Z][\w&.'\- ]+?)(?=[,.;)]|$)/,
    ],
  },
  {
    predicate: 'headquarters',
    patterns: [
      /\b(?:out of|operates? from|offices? in|team (?:is )?in) ([A-Z][\w.'\- ]+?(?:, ?[A-Z][\w.'\- ]+)?)(?=[,.;)]|$)/,
    ],
  },
  {
    predicate: 'compliance',
    patterns: [
      /\b(?:certified|audited|attested) (?:for |to |against )?(soc ?2(?: type ?(?:i{1,2}|\d))?|iso ?27001|pci[- ]dss)\b/i,
    ],
  },
  // Predicates the pattern layer never had at all.
  {
    predicate: 'funding',
    patterns: [
      /\b(?:raised|closed|secured|landed) (?:a )?(\$[\d.,]+ ?(?:billion|million|bn|m|k)?)/i,
      /\b(?:series [a-e]|seed) round of (\$[\d.,]+ ?(?:billion|million|bn|m|k)?)/i,
    ],
  },
  {
    predicate: 'employee_count',
    patterns: [
      /\b(?:employs|has|around|about|roughly) ([\d,]+(?:\+|\s?\+)?) (?:employees|staff|people)\b/i,
      /\bteam of (?:around |about |roughly )?([\d,]+)\b/i,
    ],
  },
  {
    predicate: 'founded_year',
    patterns: [
      /\b(?:founded|started|launched|established|incorporated) in ((?:19|20)\d{2})\b/i,
      /\b(?:has been (?:around|operating)) since ((?:19|20)\d{2})\b/i,
    ],
  },
  {
    predicate: 'certification',
    patterns: [
      /\b(?:holds?|carries|has) (?:an? )?([A-Z]{2,6}(?:[- ]\d{3,5})?) (?:licen[cs]e|registration|certification)\b/,
      /\b(?:licen[cs]ed|registered) (?:by|with) (?:the )?([A-Z][\w&.\- ]{2,40}?)(?=[,.;)]|$)/,
    ],
  },
  {
    predicate: 'partnership',
    patterns: [
      /\b(?:partnered|partners|has a partnership) with ([A-Z][\w&.'\- ]+?)(?=[,.;)]|\s+and\b|$)/,
      /\b(?:works|working) (?:closely )?with ([A-Z][\w&.'\- ]+?)(?=[,.;)]|\s+and\b|$)/,
    ],
  },
];

/**
 * The heuristic layer sees looser phrasings, so it recognises a few more negations than the
 * canonical set. It must never recognise fewer: a claim the pattern layer reads as negated and
 * the heuristic layer reads as affirmed produces two contradictory observations of one
 * sentence, which is worse than missing it.
 */
const EXTRA_NEGATION = /\b(?:lacking|without|isn't|is not|aren't|are not|missing|dropped|removed)\b/i;
function isNegated(text: string): boolean {
  return CANONICAL_NEGATION.test(text) || EXTRA_NEGATION.test(text);
}
const YEAR_RE = /\b(19|20)\d{2}\b/;
const RELATIVE_TIME_RE =
  /\b(?:last year|this year|recently|a few years back|back in \d{4}|as of \w+ (?:19|20)\d{2}|since (?:19|20)\d{2})\b/i;

export const heuristicProposer: ClaimProposer = {
  key: 'heuristic',
  stage: 'heuristic',
  propose(text, brand) {
    const out: ExtractedClaim[] = [];
    for (const sentence of splitForHeuristics(text)) {
      for (const rule of HEURISTIC_RULES) {
        for (const re of rule.patterns) {
          const m = sentence.match(re);
          if (!m) continue;
          const object = (m[1] ?? m[0]).trim().replace(/[.,;:]+$/, '');
          if (!object) continue;
          const negated = rule.negatable ? isNegated(sentence) : false;
          const temporal = sentence.match(YEAR_RE)?.[0] ?? sentence.match(RELATIVE_TIME_RE)?.[0] ?? null;
          out.push({
            statement: sentence.trim(),
            subject: brand,
            predicate: rule.predicate,
            object,
            polarity: negated ? 'negate' : 'affirm',
            temporalMarker: temporal,
          });
          break;
        }
      }
    }
    return out;
  },
};

function splitForHeuristics(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .flatMap((s) => s.split(/,? (?:but|and|while|whereas|though) /i))
    .map((s) => s.trim())
    .filter(Boolean);
}

// -------------------------------------------------------------- model proposer

export interface ModelProposalFn {
  (text: string, vocab: string[], brand: string): Promise<Array<Partial<ExtractedClaim>>>;
}

/**
 * A language model may propose tuples. It may not decide anything. Its output is filtered to
 * the vocabulary and grounded against the source text before it is allowed anywhere near
 * `verifyClaim`, and every claim it survives into carries `extractor_stage = model_proposed`
 * so a precision regression on one predicate can be suppressed without touching the rest.
 */
export class ModelProposer {
  key = 'model';
  stage: ExtractorStage = 'model_proposed';
  constructor(private call: ModelProposalFn) {}
  async proposeAsync(text: string, brand: string): Promise<ExtractedClaim[]> {
    let payload: unknown;
    try {
      payload = await this.call(text, PREDICATE_VOCAB, brand);
    } catch {
      return [];
    }
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((row: Partial<ExtractedClaim> | null) => {
      if (
        !row ||
        typeof row !== 'object' ||
        typeof row.predicate !== 'string' ||
        !row.predicate ||
        !row.object
      )
        return [];
      const claim: ExtractedClaim = {
        statement: typeof row.statement === 'string' ? row.statement : text.slice(0, 300),
        subject: typeof row.subject === 'string' ? row.subject : brand,
        predicate: row.predicate,
        object: String(row.object).trim(),
        polarity: row.polarity === 'negate' ? 'negate' : 'affirm',
        temporalMarker: typeof row.temporalMarker === 'string' ? row.temporalMarker : null,
      };
      return groundProposal(claim, text) ? [claim] : [];
    });
  }
}

// ---------------------------------------------------------------- composition

export interface ProposeOptions {
  proposers?: ClaimProposer[];
  /** predicates whose model/heuristic proposals are recall-only: kept, but not alertable */
  suppressed?: string[];
}

/**
 * Run the deterministic proposers, ground everything, and de-duplicate with the earliest
 * stage winning. Pattern beats heuristic beats model, so a claim both layers find is
 * attributed to the more conservative one.
 */
export function proposeClaims(text: string, brand: string, opts: ProposeOptions = {}): ProposedClaim[] {
  const proposals = (opts.proposers ?? [patternProposer, heuristicProposer]).flatMap((proposer) =>
    proposer
      .propose(text, brand)
      .filter((claim) => groundProposal(claim, text))
      .map((claim) => ({ claim, stage: proposer.stage, proposer: proposer.key })),
  );
  return mergeProposals(proposals);
}

export function mergeProposals(...lists: ProposedClaim[][]): ProposedClaim[] {
  const keys = new Set<string>();
  return lists.flat().filter((proposal) => {
    const claim = proposal.claim;
    const key = [
      normalizeKey(claim.subject),
      claim.predicate,
      normalizeKey(claim.object),
      claim.polarity,
    ].join('|');
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}
