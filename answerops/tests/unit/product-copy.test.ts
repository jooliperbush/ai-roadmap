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
import { landingView } from '../../src/web/views/landing.js';
import { actionDetailView } from '../../src/web/views/pages.js';
import { escapeHtml } from '../../src/web/html.js';

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

/**
 * The public page promises four assistants. A deployment with no API keys cannot keep that
 * promise, and the first real audit shipped a report built entirely from the stand-in while
 * this page was still selling the real thing.
 */
describe('the public page does not promise a surface it cannot sample', () => {
  it('names the stand-in on the request form when no provider key is configured', () => {
    const html = landingView({ liveProviders: 0 }).value;
    expect(html).toContain('rehearsal-notice');
    expect(html).toMatch(/no assistant API keys configured/i);
    expect(html).not.toMatch(/across all four assistants/);
  });

  it('promises all four only when four can actually be asked', () => {
    const html = landingView({ liveProviders: 4 }).value;
    expect(html).not.toContain('rehearsal-notice');
    expect(html).toMatch(/across all four assistants/);
  });

  it('defaults to the honest copy when the caller says nothing', () => {
    expect(landingView().value).toContain('rehearsal-notice');
  });
});

/**
 * An attribute interpolated as a value is escaped, and an escaped attribute is not an
 * attribute. `data-illegal="1"` reached the browser as data-illegal=&quot;1&quot;, so
 * `dataset.illegal` read `"1"` with the quotes still on it, the comparison against '1' never
 * matched, and the client-side guard against an illegal action transition never once fired in
 * production. A conditional e2e assertion hid it for as long as the action it happened to open
 * was not in a state where the guard mattered.
 *
 * Three sibling interpolations were correct only because 'selected' has no character worth
 * escaping. That is luck, not a rule, so the rule is enforced here.
 */
describe('attributes are emitted as attributes, not as escaped text', () => {
  const VIEWS = join(process.cwd(), 'src', 'web', 'views');

  it('never interpolates an attribute into a template without raw()', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(VIEWS).filter((f) => f.endsWith('.ts'))) {
      readFileSync(join(VIEWS, file), 'utf8').split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\$\{[^}]*\}/g)) {
          const expr = m[0];
          if (expr.includes('raw(')) continue;
          // A quoted literal inside an interpolation that looks like `foo="bar"` or a bare
          // boolean attribute word is an attribute being rendered through the escaper.
          if (/'[a-zA-Z-]+=\\?"/.test(expr) || /'(selected|checked|disabled|required|readonly|multiple|autofocus|open)'/.test(expr)) {
            offenders.push(`${file}:${i + 1} ${expr.trim().slice(0, 90)}`);
          }
        }
      });
    }
    expect(offenders, `wrap these in raw(): \n${offenders.join('\n')}`).toEqual([]);
  });

  it('escapeHtml would have destroyed the attribute, which is why raw() is required', () => {
    expect(escapeHtml('data-illegal="1"')).toBe('data-illegal=&quot;1&quot;');
    expect(escapeHtml('data-illegal="1"')).not.toContain('"');
  });

  it('renders a real data-illegal attribute for every transition that is not legal', () => {
    const view = actionDetailView({
      action: { id: 'act_1', title: 'T', action_type: 'update_owned_page', state: 'detected', rationale: 'r' },
      next: ['approved', 'dismissed'],
      evidence: [], assumptions: [], transitions: [], factors: {}, experiment: null,
    } as any).value;

    // The legal targets carry no marker; every illegal one does, unescaped.
    expect(view).toContain('<option value="confirmed" data-illegal="1"');
    expect(view).toContain('<option value="approved" >');
    expect(view).not.toContain('data-illegal=&quot;');
  });
});
