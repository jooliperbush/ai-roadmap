/**
 * Entity relationship graph.
 *
 * Co-occurrence is not competition. A tool that sees "Clearbit" and "Slack" in the same
 * answer and concludes they compete has learned that words appear near other words.
 * Relations here are typed and carry a BASIS; observed co-mention is the weakest basis
 * there is and can never, on its own, produce a `competitor` edge.
 */

export const RELATIONS = [
  'competitor',
  'partner',
  'parent',
  'subsidiary',
  'integration',
  'publisher',
  'review_site',
  'unrelated_comention',
] as const;

export type Relation = (typeof RELATIONS)[number];

export const RELATION_BASES = ['customer_declared', 'market_registry', 'contract', 'observed_comention'] as const;
export type RelationBasis = (typeof RELATION_BASES)[number];

export const RELATION_LABEL: Record<Relation, string> = {
  competitor: 'Competitor',
  partner: 'Partner',
  parent: 'Parent company',
  subsidiary: 'Subsidiary',
  integration: 'Integration',
  publisher: 'Publisher',
  review_site: 'Review site',
  unrelated_comention: 'Unrelated co-mention',
};

/** Bases strong enough to assert a commercial relationship. */
const STRONG_BASES: RelationBasis[] = ['customer_declared', 'market_registry', 'contract'];

export class WeakBasisError extends Error {
  constructor(relation: Relation) {
    super(
      `Refusing to assert "${relation}" from observed co-mention alone. ` +
        'Commercial relationships require a declared, contractual or registry basis; ' +
        'co-occurrence yields "unrelated_comention" until a human confirms otherwise.',
    );
    this.name = 'WeakBasisError';
  }
}

export function resolveRelation(proposed: Relation, basis: RelationBasis): Relation {
  if (proposed === 'unrelated_comention') return proposed;
  if (STRONG_BASES.includes(basis)) return proposed;
  throw new WeakBasisError(proposed);
}

/** Co-mention observations become candidates for human classification, not conclusions. */
export function comentionCandidate(entityName: string, count: number): {
  entityName: string;
  relation: Relation;
  basis: RelationBasis;
  confidence: number;
  note: string;
} {
  return {
    entityName,
    relation: 'unrelated_comention',
    basis: 'observed_comention',
    confidence: Math.min(0.5, count / 20),
    note: `Seen alongside the brand in ${count} sampled answers. Awaiting human classification — co-mention is not a market relationship.`,
  };
}

/** Extract capitalised organisation-shaped names from an answer, minus the brand itself. */
export function extractCandidateEntities(answerText: string, brandName: string, known: string[] = []): string[] {
  const found = new Set<string>();
  const re = /\b([A-Z][a-zA-Z0-9]+(?:\.[a-z]{2,3})?(?: [A-Z][a-zA-Z0-9]+){0,2})\b/g;
  const stop = new Set([
    'The','This','That','These','Those','It','If','You','Your','I','A','An','And','But','However','While',
    'For','With','From','As','At','In','On','To','Of','Note','Yes','No','Both','Their','There','When','What',
    'Overall','Summary','Key','Sources','Source','Based','According','Here','One','Two','Three','Most','Some',
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(answerText))) {
    const name = m[1].trim();
    if (stop.has(name.split(' ')[0])) continue;
    if (name.toLowerCase() === brandName.toLowerCase()) continue;
    if (name.split(' ').every((w) => stop.has(w))) continue;
    found.add(name);
  }
  for (const k of known) found.add(k);
  return [...found].sort();
}
