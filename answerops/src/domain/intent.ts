/**
 * Intent taxonomy. The single most important rule in the product: metrics are keyed by
 * intent family and are NEVER averaged across families. A branded prompt nearly guarantees
 * a mention; blending it with unaided discovery is how competitors manufacture a 70%
 * "visibility score" that means nothing.
 */

export const INTENT_FAMILIES = [
  'unaided_discovery',
  'comparison',
  'branded_reputation',
  'factual',
  'transactional',
  'support',
  'navigational',
] as const;

export type IntentFamily = (typeof INTENT_FAMILIES)[number];

export const BUYER_STAGE: Record<IntentFamily, string> = {
  unaided_discovery: 'awareness',
  comparison: 'consideration',
  branded_reputation: 'consideration',
  factual: 'evaluation',
  transactional: 'purchase',
  support: 'retention',
  navigational: 'any',
};

/** Buyer-intent weight used in the priority formula. Transparent, fixed, documented. */
export const INTENT_WEIGHT: Record<IntentFamily, number> = {
  transactional: 1.0,
  comparison: 0.9,
  unaided_discovery: 0.8,
  factual: 0.7,
  branded_reputation: 0.6,
  support: 0.4,
  navigational: 0.2,
};

export const FAMILY_LABEL: Record<IntentFamily, string> = {
  unaided_discovery: 'Unaided discovery',
  comparison: 'Comparison',
  branded_reputation: 'Branded reputation',
  factual: 'Factual',
  transactional: 'Transactional',
  support: 'Support',
  navigational: 'Navigational',
};

const COMPARISON_RE = /\b(vs\.?|versus|compared to|alternative(s)? to|better than|instead of)\b/i;
const TRANSACTIONAL_RE =
  /\b(buy|purchase|pricing|price|cost|sign ?up|get started|where can i|how much|subscribe|trial|checkout|listed on)\b/i;
const SUPPORT_RE =
  /\b(how do i|how to|troubleshoot|error|not working|reset|migrate|migration|configure|setup|set up|fix)\b/i;
const NAVIGATIONAL_RE =
  /\b(docs|documentation|login|log in|dashboard|status page|website|homepage|contact)\b/i;
const REPUTATION_RE =
  /\b(legit|legitimate|scam|safe|trustworthy|reliable|reviews?|complaints?|lawsuit|shut down|dead|rug)\b/i;
const FACTUAL_RE =
  /\b(what (is|are)|who (is|are|owns)|when (did|was)|does .* (support|have)|fees?|supply|integrations?|acquired|acquisition|founder|ceo|headquarters|compliance|certified)\b/i;
const DISCOVERY_RE =
  /\b(best|top|leading|recommend(ed)?|options for|solutions for|help with|which .* should)\b/i;

/**
 * Classify a raw buyer question into an intent family.
 * `brandTerms` matter: the same phrasing is reputation when branded and discovery when not.
 */
export function classifyIntent(question: string, brandTerms: string[] = []): IntentFamily {
  const normalized = question.trim().toLowerCase();
  const branded = brandTerms.some(
    (term) => term.trim().length > 1 && normalized.includes(term.toLowerCase()),
  );
  const rules: Array<[RegExp, IntentFamily, boolean]> = [
    [COMPARISON_RE, 'comparison', true],
    [NAVIGATIONAL_RE, 'navigational', branded],
    [REPUTATION_RE, 'branded_reputation', branded],
    [TRANSACTIONAL_RE, 'transactional', true],
    [SUPPORT_RE, 'support', true],
    [FACTUAL_RE, 'factual', true],
    [DISCOVERY_RE, branded ? 'branded_reputation' : 'unaided_discovery', true],
  ];
  return (
    rules.find(([pattern, , enabled]) => enabled && pattern.test(normalized))?.[1] ??
    (branded ? 'branded_reputation' : 'unaided_discovery')
  );
}

/** Guard invoked wherever a caller might be tempted to produce a single blended score. */
export function assertNoBlending(families: IntentFamily[]): void {
  const unique = new Set(families);
  if (unique.size > 1) {
    throw new Error(
      `Refusing to aggregate across intent families (${[...unique].join(', ')}). ` +
        'Branded and unaided prompts answer different questions; report them separately.',
    );
  }
}

/**
 * Cluster demand signals by normalised token overlap. Deliberately simple and
 * deterministic — clustering quality is a data problem, not a magic problem, and a
 * reproducible clusterer is worth more here than an opaque embedding call.
 */
const STOP = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'to',
  'for',
  'of',
  'and',
  'or',
  'in',
  'on',
  'with',
  'my',
  'i',
  'me',
  'do',
  'does',
  'can',
  'what',
  'how',
  'which',
  'best',
  'you',
  'your',
  'it',
  'that',
  'this',
  'be',
  'have',
  'has',
  'was',
  'were',
  'from',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.+-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.+-]+|[.+-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function jaccard(a: string[], b: string[]): number {
  const left = new Set(a),
    right = new Set(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].reduce((size, token) => size + Number(right.has(token)), 0);
  return intersection / new Set([...left, ...right]).size;
}

export interface ClusterInput {
  id: string;
  question: string;
  volume: number;
}

export interface ClusterOutput {
  label: string;
  intentFamily: IntentFamily;
  buyerStage: string;
  memberIds: string[];
  volume: number;
}

export function clusterDemand(
  inputs: ClusterInput[],
  brandTerms: string[] = [],
  threshold = 0.34,
): ClusterOutput[] {
  const groups: Array<{ tokens: string[]; output: ClusterOutput }> = [];
  const ordered = inputs.slice().sort((a, b) => b.volume - a.volume || a.question.localeCompare(b.question));
  for (const item of ordered) {
    const tokens = tokenize(item.question),
      family = classifyIntent(item.question, brandTerms);
    const candidates = groups
      .filter((group) => group.output.intentFamily === family)
      .map((group) => ({ group, overlap: jaccard(group.tokens, tokens) }))
      .sort((a, b) => b.overlap - a.overlap);
    const best = candidates[0];
    if (best && best.overlap > 0 && best.overlap >= threshold) {
      best.group.output.memberIds.push(item.id);
      best.group.output.volume += item.volume;
    } else
      groups.push({
        tokens,
        output: {
          label: titleCase(item.question),
          intentFamily: family,
          buyerStage: BUYER_STAGE[family],
          memberIds: [item.id],
          volume: item.volume,
        },
      });
  }
  return groups.map((group) => group.output);
}

function titleCase(s: string): string {
  const t = s.trim().replace(/\?$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Deterministic paraphrase set so a cluster is sampled with more than one wording. */
export function promptVariantsFor(label: string, family: IntentFamily): string[] {
  const base = label.replace(/\?$/, '');
  switch (family) {
    case 'comparison':
      return [`${base}?`, `Which is better: ${base}?`, `Give me an honest comparison — ${base}`];
    case 'transactional':
      return [`${base}?`, `${base} — and what does it cost?`, `Walk me through ${base.toLowerCase()}`];
    case 'branded_reputation':
      return [`${base}?`, `Should I trust them — ${base}?`, `${base}? Be specific about the risks.`];
    case 'factual':
      return [`${base}?`, `${base}? Cite your sources.`, `Give me the current facts: ${base}`];
    case 'support':
      return [`${base}?`, `Step by step: ${base}`];
    case 'navigational':
      return [`${base}?`];
    default:
      return [`${base}?`, `What are my options — ${base}?`, `${base}? Rank the top choices.`];
  }
}
