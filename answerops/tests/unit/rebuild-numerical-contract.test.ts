import { expect, test } from 'vitest';
import { measure, twoProportionTest, benjaminiHochberg } from '../../src/domain/stats.js';
import { analyzeExperiment } from '../../src/domain/experiments.js';
import contract from '../fixtures/numerical-contract.json';
const operations: Record<string, (...args: any[]) => unknown> = {
  measure,
  twoProportionTest,
  benjaminiHochberg,
  analyzeExperiment,
};
function compare(actual: unknown, expected: unknown, path = 'result'): void {
  if (typeof expected === 'number') {
    expect(actual, path).toBeTypeOf('number');
    expect(actual, path).toBeCloseTo(expected, 10);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((v, i) => compare((actual as unknown[])[i], v, `${path}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected))
      compare((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}
for (const [index, c] of contract.cases.entries())
  test(`reference numerical contract ${index}: ${c.operation}`, () =>
    compare(operations[c.operation](...c.args), c.expected));
