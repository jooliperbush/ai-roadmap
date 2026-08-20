import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, ALLOWED_TRANSITIONS, ACTION_STATES, assertEvidence, IllegalTransitionError, MissingEvidenceError } from '../../src/domain/actions.js';

describe('action lifecycle', () => {
  it('walks the intended path', () => {
    const path = ['detected', 'approved', 'shipped', 'crawled', 'observed', 'confirmed'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });

  it('refuses to skip the evidence-gathering states', () => {
    expect(canTransition('detected', 'confirmed')).toBe(false);
    expect(canTransition('approved', 'observed')).toBe(false);
    expect(() => assertTransition('detected', 'shipped')).toThrow(IllegalTransitionError);
  });

  it('treats confirmed, rejected and dismissed as terminal', () => {
    for (const s of ['confirmed', 'rejected', 'dismissed'] as const) {
      expect(ALLOWED_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('names the legal transitions in the error so the UI can explain itself', () => {
    try {
      assertTransition('detected', 'shipped');
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toMatch(/Allowed from detected: approved, dismissed/);
    }
  });

  it('never allows a transition back out of a terminal state', () => {
    for (const from of ['confirmed', 'rejected', 'dismissed'] as const) {
      for (const to of ACTION_STATES) expect(canTransition(from, to)).toBe(false);
    }
  });
});

describe('evidence requirement', () => {
  it('rejects an empty or whitespace-only evidence list', () => {
    expect(() => assertEvidence([])).toThrow(MissingEvidenceError);
    expect(() => assertEvidence(['   '])).toThrow(MissingEvidenceError);
  });
  it('accepts a real observation id', () => {
    expect(() => assertEvidence(['obs_123'])).not.toThrow();
  });
});
