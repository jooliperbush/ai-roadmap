import { describe, it, expect } from 'vitest';
import { analyzeExperiment, OUTCOME_CAVEAT } from '../../src/domain/experiments.js';

describe('experiment analysis', () => {
  it('confirms a large, well-sampled improvement against a flat control', () => {
    const a = analyzeExperiment(
      { baselineK: 5, baselineN: 50, postK: 30, postN: 50, controlBaselineK: 10, controlBaselineN: 50, controlPostK: 11, controlPostN: 50 },
      true,
    );
    expect(a.verdict).toBe('confirmed');
    expect(a.probabilityReal).toBeGreaterThan(0.95);
    expect(a.narrative).toMatch(/probability the improvement is real/);
  });

  it('refuses to confirm when the control moved just as much', () => {
    const a = analyzeExperiment(
      { baselineK: 5, baselineN: 50, postK: 30, postN: 50, controlBaselineK: 5, controlBaselineN: 50, controlPostK: 30, controlPostN: 50 },
      true,
    );
    expect(a.didEffect).toBeCloseTo(0, 6);
    expect(a.verdict).not.toBe('confirmed');
  });

  it('returns inconclusive rather than a verdict when underpowered', () => {
    const a = analyzeExperiment({ baselineK: 0, baselineN: 3, postK: 3, postN: 3 }, false);
    expect(a.verdict).toBe('inconclusive');
    expect(a.underpowered).toBe(true);
    expect(a.alternativeExplanations[0]).toMatch(/below the 5-run floor/);
  });

  it('rejects an intervention that made things worse', () => {
    const a = analyzeExperiment({ baselineK: 30, baselineN: 50, postK: 5, postN: 50 }, false);
    expect(a.verdict).toBe('rejected');
    expect(a.narrative).toMatch(/did not help/);
  });

  it('always states alternative explanations, including on a confirmed win', () => {
    const a = analyzeExperiment({ baselineK: 5, baselineN: 50, postK: 30, postN: 50 }, false);
    expect(a.alternativeExplanations.length).toBeGreaterThanOrEqual(4);
    expect(a.alternativeExplanations.join(' ')).toMatch(/model or version change/i);
  });

  it('says so when no control cluster existed', () => {
    const a = analyzeExperiment({ baselineK: 5, baselineN: 50, postK: 30, postN: 50 }, false);
    expect(a.alternativeExplanations[0]).toMatch(/No matched control cluster/);
  });

  it('does not call a small movement a win', () => {
    const a = analyzeExperiment({ baselineK: 25, baselineN: 50, postK: 27, postN: 50 }, false);
    expect(a.verdict).toBe('inconclusive');
  });
});

describe('business outcome caveat', () => {
  it('states the attribution limit rather than implying precision', () => {
    expect(OUTCOME_CAVEAT).toMatch(/Correlational/);
    expect(OUTCOME_CAVEAT).toMatch(/not attribution/i);
  });
});

describe('controlled inference', () => {
  it('reports probability-real from the controlled comparison, not the raw movement', () => {
    // Treatment rose 15 points; the control rose 15 points too. The raw movement looks
    // convincing; the controlled reading must not.
    const a = analyzeExperiment(
      { baselineK: 0, baselineN: 20, postK: 3, postN: 20, controlBaselineK: 0, controlBaselineN: 20, controlPostK: 3, controlPostN: 20 },
      true,
    );
    expect(a.verdict).toBe('inconclusive');
    expect(a.probabilityReal).toBeLessThan(0.8);
  });

  it('stays confident when the control genuinely did not move', () => {
    const a = analyzeExperiment(
      { baselineK: 10, baselineN: 60, postK: 45, postN: 60, controlBaselineK: 10, controlBaselineN: 60, controlPostK: 11, controlPostN: 60 },
      true,
    );
    expect(a.verdict).toBe('confirmed');
    expect(a.probabilityReal).toBeGreaterThan(0.95);
  });

  it('does not let a 0/20 control manufacture zero uncertainty', () => {
    const a = analyzeExperiment(
      { baselineK: 0, baselineN: 20, postK: 4, postN: 20, controlBaselineK: 0, controlBaselineN: 20, controlPostK: 0, controlPostN: 20 },
      true,
    );
    expect(a.pValue).toBeGreaterThan(0);
    expect(a.pValue).toBeLessThan(1);
  });
});
