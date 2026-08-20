/**
 * Product-integrity lint.
 *
 * The claims this product refuses to make are part of the specification, so they are tested
 * like any other requirement. If someone later ships a blended visibility score or a promise
 * to "control" what models say, this fails before a customer sees it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|css|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const SRC = walk(join(process.cwd(), 'src'));
const VIEWS = SRC.filter((f) => f.includes(join('web', 'views')));

describe('claims we refuse to make', () => {
  const banned: Array<[RegExp, string]> = [
    [/control how ai (talks|speaks|describes)/i, 'Nobody controls an external model. Measure, influence, correct.'],
    [/\bguaranteed? (ranking|visibility|mention)/i, 'No guarantee is available to give.'],
    [/end-to-end encryption/i, 'TLS in transit is not end-to-end encryption.'],
    [/\bno storage\b/i, 'We do store historical runs; saying otherwise is false.'],
    [/overall visibility score/i, 'There is deliberately no blended score.'],
    [/\bREPLACE THIS\b|\bTODO: image\b|placeholder\.(png|jpg)/i, 'No developer notes in shipped copy.'],
  ];

  for (const [re, why] of banned) {
    it(`never claims: ${re.source}`, () => {
      const hits = SRC.filter((f) => re.test(readFileSync(f, 'utf8')));
      expect(hits, why).toEqual([]);
    });
  }

  it('states the measure-not-control position in the shipped shell', () => {
    const layout = readFileSync(join(process.cwd(), 'src', 'web', 'views', 'layout.ts'), 'utf8');
    expect(layout).toMatch(/Measured, not controlled/);
  });
});

describe('numbers never ship bare', () => {
  it('renders every rate through the measurement component or the shared formatter', () => {
    // A view that hand-rolls `(k / n * 100)` would bypass the interval and the sample size.
    const offenders: string[] = [];
    for (const file of VIEWS) {
      const src = readFileSync(file, 'utf8');
      if (/\/\s*\w+\s*\)\s*\*\s*100/.test(src) && !/formatMeasurement|measureEl/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('exposes the sample floor and the interval method on the methodology page', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'web', 'views', 'pages.ts'), 'utf8');
    expect(src).toMatch(/Wilson score interval/);
    expect(src).toMatch(/insufficient data/);
    expect(src).toMatch(/Benjamini-Hochberg/);
  });
});

describe('the action catalogue excludes spam', () => {
  it('contains no connector for third-party posting or review generation', () => {
    const priority = readFileSync(join(process.cwd(), 'src', 'domain', 'priority.ts'), 'utf8');
    for (const banned of ['post_to_reddit', 'generate_review', 'synthetic_mention', 'buy_backlink', 'auto_comment']) {
      expect(priority).not.toContain(banned);
    }
  });

  it('asks for reviews only from genuine customers', () => {
    const priority = readFileSync(join(process.cwd(), 'src', 'domain', 'priority.ts'), 'utf8');
    expect(priority).toContain('request_genuine_reviews');
  });
});

describe('answer highlighting', () => {
  it('escapes the answer before marking the defective statement', async () => {
    const { highlight } = await import('../../src/web/views/dashboard.js');
    const out = highlight('Vanar is <script>alert(1)</script> and fees are $0.05 per transaction.', ['fees are $0.05 per transaction.']);
    expect(out.value).not.toContain('<script>');
    expect(out.value).toContain('<mark>');
  });

  it('leaves the answer untouched when the statement is not present verbatim', async () => {
    const { highlight } = await import('../../src/web/views/dashboard.js');
    expect(highlight('An unrelated answer.', ['something else entirely']).value).not.toContain('<mark>');
  });
});
