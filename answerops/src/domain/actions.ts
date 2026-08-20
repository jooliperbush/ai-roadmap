/**
 * Action lifecycle. A recommendation that cannot be shipped, crawled and re-measured is
 * advice, and advice is what the incumbent products already sell too much of.
 *
 *   detected -> approved -> shipped -> crawled -> observed -> confirmed | rejected
 *          \-> dismissed
 */

export const ACTION_STATES = [
  'detected',
  'approved',
  'shipped',
  'crawled',
  'observed',
  'confirmed',
  'rejected',
  'dismissed',
] as const;

export type ActionState = (typeof ACTION_STATES)[number];

export const ALLOWED_TRANSITIONS: Record<ActionState, ActionState[]> = {
  detected: ['approved', 'dismissed'],
  approved: ['shipped', 'dismissed'],
  shipped: ['crawled', 'rejected'],
  crawled: ['observed', 'rejected'],
  observed: ['confirmed', 'rejected'],
  confirmed: [],
  rejected: [],
  dismissed: [],
};

export const STATE_LABEL: Record<ActionState, string> = {
  detected: 'Detected',
  approved: 'Approved',
  shipped: 'Shipped',
  crawled: 'Crawled',
  observed: 'Observed',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  dismissed: 'Dismissed',
};

export function canTransition(from: ActionState, to: ActionState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(public from: ActionState, public to: ActionState) {
    super(
      `Illegal action transition ${from} -> ${to}. Allowed from ${from}: ` +
        `${(ALLOWED_TRANSITIONS[from] ?? []).join(', ') || 'none (terminal state)'}.`,
    );
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: ActionState, to: ActionState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** An action with no evidence is an opinion. Opinions do not enter the queue. */
export class MissingEvidenceError extends Error {
  constructor() {
    super('An action requires at least one evidence reference (observed claim, citation or crawler event).');
    this.name = 'MissingEvidenceError';
  }
}

export function assertEvidence(evidence: string[]): void {
  if (!Array.isArray(evidence) || evidence.filter((e) => typeof e === 'string' && e.trim()).length === 0) {
    throw new MissingEvidenceError();
  }
}
