/**
 * The public page.
 *
 * Editorial rule for this file: it is held to the same evidence standard as the console.
 * No number appears without its interval and its sample size, no customer results are
 * shown (the reference workspace samples a simulated upstream, and simulated runs are
 * excluded from any customer-facing claim), and the worked example is labelled as one.
 * The numbers that do appear are the sampling constants and the prices, both of which
 * are verifiable on the methodology page.
 *
 * Second rule: plain words. If a sentence needs two readings, it is wrong. No aphorisms,
 * no rhetorical inversions, no "X because we Y" trust framing. State the fact and stop.
 */
import { html, raw, Raw } from '../html.js';

/** A rate, rendered the only way this product allows: point, interval, sample size. */
function measure(point: string, ciLow: string, ciHigh: string, n: number, tone: 'danger' | 'success' | ''): Raw {
  return html`<span class="measure ${tone ? `is-${tone}` : ''}"
    ><span class="val">${point}</span
    ><span class="ci">95% CI ${ciLow}–${ciHigh}</span
    ><span class="n">n=${n}</span
  ></span>`;
}

const LOOP = [
  {
    n: '01',
    title: 'Write down what is true',
    body: 'Each fact gets a source, an owner, a start date and an expiry.',
    where: 'Truth registry',
  },
  {
    n: '02',
    title: 'Ask what buyers ask',
    body: 'Real buyer questions, asked repeatedly across four assistants. We save the exact setup: model, version, grounding, country.',
    where: 'Observatory',
  },
  {
    n: '03',
    title: 'Check every claim',
    body: 'Every statement is checked against your facts. Every citation is checked for whether it backs the claim.',
    where: 'Answer desk',
  },
  {
    n: '04',
    title: 'Fix the record',
    body: 'A fixed list of moves: publish a dated correction, fix the doc, add the comparison page. Each carries its evidence.',
    where: 'Actions',
  },
  {
    n: '05',
    title: 'Prove it moved',
    body: 'Ask again, compare against an untouched baseline, report the difference with a p-value and what we cannot rule out.',
    where: 'Experiments',
  },
];

const REFUSALS = [
  {
    title: 'One score you can screenshot',
    why: 'Ask about you by name and you get mentioned. Ask for a vendor recommendation and you might not. Averaging the two makes a flattering number that means nothing. We keep them apart.',
    proof: 'assertNoBlending() throws · <b>tests/unit/intent.test.ts</b>',
  },
  {
    title: 'A percentage with no sample size',
    why: 'Every rate ships with its error bar and its run count. Under five runs you get "insufficient data".',
    proof: 'domain/stats.ts · <b>tests/unit/stats.test.ts</b>',
  },
  {
    title: 'An alert because a number wobbled',
    why: 'A change is reported only if it clears a significance test, moves at least ten points, and survives a correction for everything else tested that round.',
    proof: 'two-proportion z-test, BH at q=0.1 · <b>services/dashboard.ts</b>',
  },
  {
    title: 'A made-up impact estimate',
    why: 'A fix gets a predicted range only if your workspace already holds comparable experiments. Otherwise it ships as an experiment.',
    proof: 'deriveExpectedRange() · <b>tests/unit/priority.test.ts</b>',
  },
  {
    title: 'Reviews and posts we manufacture',
    why: 'There is no connector for posting anywhere, and none for generating reviews. The one review action asks your real customers.',
    proof: 'ACTION_TYPES closed enum · <b>tests/unit/product-copy.test.ts</b>',
  },
  {
    title: 'A promise to make the models obey',
    why: 'Nobody outside a lab decides what a model says. We measure it, fix what it reads, and test whether the answers moved. A lint fails the build if this page says otherwise.',
    proof: 'banned-claims lint over src/ · <b>tests/unit/product-copy.test.ts</b>',
  },
];

const SPEC_ROWS: Array<[string, string]> = [
  ['Fewest runs', '5 per question cluster per window before any rate is shown'],
  ['Most runs', '20, spent where demand, value, volatility and defect risk are highest'],
  ['Error bar', '95% Wilson score interval, still correct at 0 hits and at all hits'],
  ['Change detection', 'two-proportion z-test, p < 0.05, at least a 10-point move'],
  ['Multiple testing', 'Benjamini-Hochberg at q = 0.1'],
  ['Under the floor', 'no number, just "insufficient data"'],
  ['Saved with each run', 'provider, model, version, access mode, grounding, search mode, geo, language, personalisation, system config hash, temperature, seed'],
  ['Assistants covered', 'OpenAI, Anthropic, Google, Perplexity'],
];

const PLANS = [
  {
    name: 'Answer Risk Audit',
    price: 'Free',
    unit: 'one time',
    body: 'We load your facts, ask your highest-intent questions, and hand back every wrong answer we can evidence. The report is yours either way.',
    cta: 'Start the audit',
    href: '#audit',
    lead: true,
  },
  {
    name: 'Monitor',
    price: '$750',
    unit: '/ month',
    body: '50 question clusters across four assistants, sampled weekly. Alerts have to clear a significance test.',
    cta: 'Talk it through',
    href: '#audit',
    lead: false,
  },
  {
    name: 'Operate',
    price: '$2,000',
    unit: '/ month',
    body: '100 clusters, sampled daily, plus the full fact registry, the action list and the experiment ledger.',
    cta: 'Talk it through',
    href: '#audit',
    lead: false,
  },
  {
    name: 'Enterprise',
    price: '$5,000+',
    unit: '/ month',
    body: 'Multiple brands or clients in one place, CRM handoff, approval trails and full export.',
    cta: 'Talk it through',
    href: '#audit',
    lead: false,
  },
];

export function landingView(): Raw {
  return html`
<a class="skip" href="#main">Skip to content</a>

<header class="lp-nav">
  <a class="lp-brand" href="/" aria-label="Miscited home">
    <span class="mark" aria-hidden="true">◧</span>
    <span class="word">Miscited</span>
  </a>
  <nav class="lp-nav-links" aria-label="Sections">
    <a href="#anatomy">The problem</a>
    <a href="#loop">How it works</a>
    <a href="#refusals">What we refuse</a>
    <a href="#design">The rules</a>
    <a href="#plans">Pricing</a>
  </nav>
  <a class="btn btn-ghost" href="/login" data-testid="nav-signin">Sign in</a>
</header>

<main id="main">

  <!-- ------------------------------------------------------------------ hero -->
  <section class="shell hero">
    <div class="hero-copy">
      <p class="label">Answer integrity</p>
      <h1>Quality control for what AI says about your company.</h1>
      <p class="lede">
        Your buyers stopped opening ten links. They ask an assistant, get one answer, and act on it.
        When that answer is out of date, you lose the deal before anyone reaches your site.
      </p>
      <p>
        We find the wrong answers across ChatGPT, Claude, Gemini and Perplexity, fix the page they came
        from, then ask again to check the answer changed.
      </p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#audit" data-testid="cta-hero">Get a free answer audit</a>
        <a class="btn btn-ghost" href="#refusals">What we refuse to claim</a>
      </div>
      <dl class="hero-proof">
        <div><dt>We ask</dt><dd>OpenAI · Anthropic · Google · Perplexity</dd></div>
        <div><dt>Every number shows</dt><dd>the rate, the error bar, the run count</dd></div>
        <div><dt>Under 5 runs</dt><dd>no number at all</dd></div>
      </dl>
    </div>

    <!-- signature element: a worked defect, assembled in front of the reader -->
    <figure class="exhibit" data-exhibit data-phase="idle" aria-labelledby="exhibit-cap">
      <figcaption class="exhibit-head">
        <span class="stamp is-muted">Exhibit</span>
        <span class="who" id="exhibit-cap">Worked example, not a measurement of Slack</span>
        <span class="spacer"></span>
        <button type="button" class="replay" data-replay aria-label="Replay the exhibit">Replay</button>
      </figcaption>

      <div class="exhibit-body">
        <p class="answer" data-typed>
          Slack's free plan works well for a small team.
          <span class="claim">It keeps your 10,000 most recent messages, so nothing is lost while you stay
          under that.</span>
          Paid plans add unlimited history and Slack Connect.<span class="cursor" aria-hidden="true"></span>
        </p>

        <div class="stage meta-row" data-shown="false">
          <span><b>surface</b> assistant · api</span>
          <span><b>grounding</b> grounded_search</span>
          <span><b>geo</b> US/en</span>
          <span><b>temp</b> 0.7</span>
        </div>

        <div class="stage sources" data-shown="false">
          <table>
            <caption>Sources the answer cited</caption>
            <tbody>
              <tr>
                <td>top10teamchat.example.com/best-slack-alternatives</td>
                <td><span class="stamp is-danger">does not support it</span></td>
              </tr>
              <tr>
                <td>slack.com/pricing</td>
                <td><span class="stamp is-cite">supports it</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="stage truth-card" data-shown="false">
          <div class="t-head">
            <span>Your approved fact says otherwise</span>
            <span class="stamp is-danger">Contradicted</span>
          </div>
          <p>The Slack free plan keeps 90 days of message history. The 10,000-message limit ended on 1 September 2022.</p>
          <p class="t-dates">in force 2022-09-01 → current · sensitivity material · approved by pricing-ops</p>
        </div>
      </div>

      <div class="exhibit-foot">
        ${measure('9%', '5%', '15%', 116, 'danger')}
        <span class="spacer"></span>
        <span class="stamp is-danger">Critical</span>
      </div>
    </figure>
  </section>

  <!-- --------------------------------------------------------------- anatomy -->
  <section class="shell section" id="anatomy">
    <div class="section-head">
      <p class="label is-danger">Why counting mentions misses this</p>
      <h2>The answer above is sourced, and wrong.</h2>
      <p class="lede">
        The brand is named, the tone is positive, and one of the two citations is Slack's own pricing
        page. Every share-of-voice tool scores that as a win. The limit it quotes ended in 2022.
      </p>
      <p class="note">
        Check it yourself: ask any assistant what Slack's free plan keeps, then open
        <b>slack.com/pricing</b>.
      </p>
    </div>

    <div class="anatomy">
      <div class="anatomy-visual">
        <div class="plate">
          <p>
            Slack's free plan works well for a small team.
            <span class="bad">It keeps your 10,000 most recent messages.</span>
            Paid plans add unlimited history and Slack Connect.
          </p>
        </div>
        <div class="overlay">
          <span class="t-label">Approved record · in force 2022-09-01 → current</span>
          <p>The Slack free plan keeps 90 days of message history.</p>
        </div>
      </div>

      <div class="beats">
        <div class="beat">
          <span class="idx">01</span>
          <div>
            <h3>One answer, no second opinion</h3>
            <p>
              Search handed your buyer ten links to compare. An assistant hands them one answer. If they
              act on the wrong one they never reach your site, so nothing in your analytics records it.
            </p>
          </div>
        </div>
        <div class="beat">
          <span class="idx">02</span>
          <div>
            <h3>It used to be true</h3>
            <p>
              Slack really did keep 10,000 messages until September 2022, and thousands of comparison
              pages still say so. Every fact you give us carries a start date and an expiry, because an
              answer can be correctly sourced and still wrong.
            </p>
          </div>
        </div>
        <div class="beat">
          <span class="idx">03</span>
          <div>
            <h3>The fix is upstream</h3>
            <p>
              A stale comparison page carried the old limit and the pricing page did not outrank it.
              Publish a dated correction, fix the doc, ask again, and see whether the answer moved.
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ------------------------------------------------------------------ loop -->
  <section class="shell section" id="loop">
    <div class="section-head">
      <p class="label">How it works</p>
      <h2>Five steps, run on a schedule.</h2>
      <p class="lede">
        Mention counts are an input here, never the deliverable. The loop turns a wrong answer into a
        corrected one, then into evidence that the fix worked.
      </p>
    </div>

    <div class="loop">
      ${LOOP.map(
        (s) => html`<article class="loop-step">
          <span class="n">${s.n}</span>
          <h3>${s.title}</h3>
          <p>${s.body}</p>
          <span class="where">${s.where}</span>
        </article>`,
      )}
    </div>
  </section>

  <!-- -------------------------------------------------------------- refusals -->
  <section class="shell section" id="refusals">
    <div class="section-head">
      <p class="label is-success">Six refusals, enforced in code</p>
      <h2>Six things this product will not do.</h2>
      <p class="lede">
        Each one is a failing test. If a release ships a blended score or a bare percentage, the build
        goes red before you see it.
      </p>
    </div>

    <div class="ledger">
      ${REFUSALS.map(
        (r) => html`<div class="ledger-row">
          <span class="x" aria-hidden="true">✕</span>
          <div>
            <h3>${r.title}</h3>
            <p class="why">${r.why}</p>
          </div>
          <p class="proof">${raw(r.proof)}</p>
        </div>`,
      )}
    </div>
  </section>

  <!-- ------------------------------------------------------- measurement spec -->
  <section class="shell section" id="design">
    <div class="section-head">
      <p class="label">Measurement design</p>
      <h2>The rules behind every number.</h2>
      <p class="lede">
        These settings decide what the console shows you. The same page ships inside the product. If
        a line on it stops being true, that is a bug.
      </p>
    </div>

    <table class="spec">
      <caption class="note">Sampling and inference settings, current release.</caption>
      <tbody>
        ${SPEC_ROWS.map(
          ([k, v]) => html`<tr>
            <th scope="row">${k}</th>
            <td>${v}</td>
          </tr>`,
        )}
      </tbody>
    </table>

    <p class="note" style="margin-top: 24px; max-width: 72ch;">
      Fifty clusters across four assistants for a month costs $400 to $1,000 in model and search spend
      before anything else. That is why this is not a $49 tool. At $49 nobody can ask often enough to
      know whether the answer is right.
    </p>
  </section>

  <!-- ----------------------------------------------------------------- plans -->
  <section class="shell section" id="plans">
    <div class="section-head">
      <p class="label">Pricing</p>
      <h2>Priced by how many buyer questions we watch.</h2>
    </div>

    <div class="plans">
      ${PLANS.map(
        (p) => html`<article class="plan ${p.lead ? 'is-lead' : ''}">
          <span class="pname">${p.name}</span>
          <span class="price">${p.price} <small>${p.unit}</small></span>
          <p>${p.body}</p>
          <a class="btn ${p.lead ? 'btn-primary' : 'btn-ghost'}" href="${p.href}">${p.cta}</a>
        </article>`,
      )}
    </div>
  </section>

  <!-- ------------------------------------------------------------------- cta -->
  <section class="shell cta" id="audit">
    <div>
      <p class="label">Start with the free audit</p>
      <h2>See what the assistants are telling your buyers this week.</h2>
      <p class="lede">
        The audit is the whole product, run once by hand on your domain. Most teams have never read a
        transcript of what the assistants say about them.
      </p>
      <ul>
        <li>We load your facts from your docs. You approve each one before we ask anything.</li>
        <li>We ask your highest-intent questions across all four assistants.</li>
        <li>You get every wrong answer we can evidence, with transcripts, setups and citations.</li>
        <li>If we find nothing worth fixing, we say so and you owe us nothing.</li>
      </ul>
    </div>

    <form class="audit-form" data-audit-form novalidate data-testid="audit-form">
      <h3>Request an answer audit</h3>
      <p class="note">Two fields. You get a scheduled window back.</p>

      <div class="field">
        <label for="audit-email">Work email</label>
        <input
          id="audit-email"
          name="email"
          type="email"
          autocomplete="email"
          spellcheck="false"
          placeholder="you@company.com"
          aria-describedby="err-audit-email"
        />
        <span class="err" id="err-audit-email" data-err-for="audit-email" role="alert"></span>
      </div>

      <div class="field">
        <label for="audit-domain">Domain to audit</label>
        <input
          id="audit-domain"
          name="domain"
          type="text"
          autocomplete="url"
          spellcheck="false"
          placeholder="company.com"
          aria-describedby="err-audit-domain"
        />
        <span class="err" id="err-audit-domain" data-err-for="audit-domain" role="alert"></span>
      </div>

      <button type="submit" class="btn btn-primary" data-submit data-testid="audit-submit">
        Request the audit
      </button>

      <div class="outcome" data-outcome role="status" aria-live="polite"></div>

      <p class="fineprint">
        We keep your request so we can run the audit, and delete it if you ask. We ask nothing and
        email nobody until you approve the facts we load.
      </p>
    </form>
  </section>
</main>

<footer class="lp-footer">
  <div class="shell">
    <div class="rows">
      <span class="lp-brand"><span class="mark" aria-hidden="true">◧</span> <span class="word">Miscited</span></span>
      <span class="spacer"></span>
      <a href="/login">Sign in</a>
      <a href="#design">Measurement design</a>
      <a href="#refusals">What we refuse to claim</a>
    </div>
    <p class="creed">
      Nobody outside a lab decides what a model says. We measure it, fix the record it reads, and test
      whether it moved. Rates carry a 95% Wilson interval and a sample size, or they are not shown. The
      exhibit above is a worked example against a stand-in model.
    </p>
  </div>
</footer>`;
}
