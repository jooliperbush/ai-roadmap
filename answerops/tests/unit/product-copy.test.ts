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

/**
 * The public page is read by a marketing lead in about ninety seconds, not by an engineer
 * auditing our methodology. It once labelled its own "how it works" steps with the console's
 * screen names — Truth registry, Observatory, Answer desk — which are the right nouns for the
 * product and inert to the person who signs for it.
 *
 * The rigour stays on the page, because it is the reason to believe us and a technical
 * evaluator will look for it. What is enforced here is the order: the promise a buyer
 * understands comes first, the mechanism that delivers it comes second.
 */
describe('the public page speaks the buyer\'s language', () => {
  const landing = landingView({ liveProviders: 4 }).value;
  const headings = [...landing.matchAll(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  );

  it('never puts a console screen name in a heading', () => {
    const internal = /\b(observatory|answer desk|truth registry|experiment ledger|action catalogue|demand graph)\b/i;
    const offenders = headings.filter((h) => internal.test(h));
    expect(offenders, 'these are our nouns, not the buyer\'s').toEqual([]);
  });

  it('never leads a heading with a statistical method', () => {
    const jargon = /\b(wilson|benjamini|hochberg|z-test|p\s*<|q\s*=|difference-in-differences|two-proportion)\b/i;
    const offenders = headings.filter((h) => jargon.test(h));
    expect(offenders, 'the method belongs under the promise, not in front of it').toEqual([]);
  });

  it('still carries the methods somewhere on the page, because they are the reason to believe it', () => {
    for (const method of ['Wilson', 'Benjamini-Hochberg', 'two-proportion z-test', 'difference-in-differences']) {
      expect(landing, `${method} is the proof and must not be deleted in the name of simplicity`).toContain(method);
    }
  });

  it('names the concrete failures a marketer recognises', () => {
    for (const phrase of [/price you changed/i, /plan or limit you retired/i, /integration you sunset/i]) {
      expect(landing).toMatch(phrase);
    }
  });

  it('says who does the work at each step, since the answer is mostly us', () => {
    expect(landing).toMatch(/You, once/);
    expect(landing).toMatch(/Us, every week/);
  });
});

/**
 * Headings get rewritten toward cleverness over time, and the page has now been pulled back from
 * it twice. "It is almost never a lie. It is almost always something that used to be true." said
 * in twenty words what "Most wrong answers used to be true." says in six, and it made the reader
 * work out the point rather than handing it to them.
 *
 * These are the shapes that kept appearing, so these are the shapes that fail the build.
 */
describe('headings stay short and plain', () => {
  const landing = landingView({ liveProviders: 4 }).value;
  const headings = [...landing.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  );

  it('finds the headings it is meant to be checking', () => {
    expect(headings.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps every heading to one sentence', () => {
    // A full stop followed by more words is two sentences wearing one heading.
    const offenders = headings.filter((h) => /[.?!]\s+\S/.test(h));
    expect(offenders, 'split these, or cut one half').toEqual([]);
  });

  it('keeps every heading short enough to read at a glance', () => {
    const offenders = headings.filter((h) => h.length > 65).map((h) => `${h.length}: ${h}`);
    expect(offenders).toEqual([]);
  });

  it('refuses the negative-parallelism construction', () => {
    const offenders = headings.filter((h) => /\bnot just\b|\bnot only\b|it is not .*,? it is\b/i.test(h));
    expect(offenders, '"not just X, it is Y" is a tic, not a sentence').toEqual([]);
  });

  it('refuses a heading that repeats a clause to make a point', () => {
    // "It is almost never a lie. It is almost always ..." — same opening twice.
    const offenders = headings.filter((h) => {
      const halves = h.split(/[.;]\s*/).filter(Boolean);
      return halves.length > 1 && halves[0].split(' ').slice(0, 3).join(' ') === halves[1]?.split(' ').slice(0, 3).join(' ');
    });
    expect(offenders).toEqual([]);
  });
});
