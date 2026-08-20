/**
 * The public page.
 *
 * Editorial rule for this file: it is held to the same evidence standard as the console.
 * No number appears without its interval and its sample size, no customer results are
 * shown (the reference workspace samples a simulated upstream, and simulated runs are
 * excluded from any customer-facing claim), and the worked example is labelled as one.
 * The numbers that do appear are the sampling constants and the prices, both of which
 * are verifiable on the methodology page.
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
    title: 'Record what is true',
    body: 'Every fact carries an effective date, an expiry, a source and an approver. Facts are true over an interval, not forever.',
    where: 'Truth registry',
  },
  {
    n: '02',
    title: 'Ask what buyers ask',
    body: 'Real question clusters, sampled repeatedly across four providers, with the exact surface stored: model, version, grounding, geo, personalisation.',
    where: 'Observatory',
  },
  {
    n: '03',
    title: 'Verify claim by claim',
    body: 'Each claim in each answer is adjudicated against the registry, and each cited source is checked for whether it actually supports the claim.',
    where: 'Answer desk',
  },
  {
    n: '04',
    title: 'Correct the record',
    body: 'A closed catalogue of interventions, each carrying its evidence and its stated assumptions. Publish a dated correction, fix the doc, add the comparison page.',
    where: 'Actions',
  },
  {
    n: '05',
    title: 'Prove it moved',
    body: 'Re-sample against a matched baseline, report difference-in-differences with a p-value, and record what could not be ruled out.',
    where: 'Experiments',
  },
];

const REFUSALS = [
  {
    title: 'One blended score you can screenshot',
    why: 'A branded prompt nearly guarantees a mention. An unaided one does not. Averaging them makes a number that flatters you and tells you nothing, so metrics stay keyed by intent family.',
    proof: 'assertNoBlending() throws · <b>tests/unit/intent.test.ts</b>',
  },
  {
    title: 'A percentage without its sample size',
    why: 'Every rate ships as a point estimate, a 95% Wilson interval and an n. Below the five-run floor the number is suppressed and labelled insufficient data, never rounded into a figure.',
    proof: 'domain/stats.ts · <b>tests/unit/stats.test.ts</b>',
  },
  {
    title: 'An alert because a number wobbled',
    why: 'A change is only reported after a two-proportion test at p < 0.05, a minimum effect of ten points, and a Benjamini-Hochberg correction across everything tested that round.',
    proof: 'two-proportion z-test, BH at q=0.1 · <b>services/dashboard.ts</b>',
  },
  {
    title: 'An invented impact percentage',
    why: 'A recommendation gets an expected range only when this workspace already holds comparable confirmed experiments. Otherwise the range is null and the fix ships as an experiment, not a prediction.',
    proof: 'deriveExpectedRange() · <b>tests/unit/priority.test.ts</b>',
  },
  {
    title: 'Reviews, mentions and posts we manufacture',
    why: 'The intervention catalogue is a closed enum. There is no connector for third-party posting or review generation, and the only review action asks genuine customers.',
    proof: 'ACTION_TYPES closed enum · <b>tests/unit/product-copy.test.ts</b>',
  },
  {
    title: 'A promise to make the models obey',
    why: 'Nobody outside a lab decides what a model says. We measure it, correct the record it draws on, and test whether the answers moved. A lint fails the build if this page ever claims otherwise.',
    proof: 'banned-claims lint over src/ · <b>tests/unit/product-copy.test.ts</b>',
  },
];

const SPEC_ROWS: Array<[string, string]> = [
  ['Minimum samples', '5 runs per cluster per window before any rate is displayed'],
  ['Maximum samples', '20 runs, allocated by demand × value × volatility × defect risk'],
  ['Interval', '95% Wilson score interval, correct at k=0 and k=n'],
  ['Change detection', 'two-proportion z-test, p < 0.05, minimum effect 10 points'],
  ['Multiple testing', 'Benjamini-Hochberg at q = 0.1'],
  ['Below the floor', 'suppressed and labelled "insufficient data"'],
  ['Surface recorded', 'provider, model, version, access mode, grounding, search mode, geo, language, personalisation, system config hash, temperature, seed'],
  ['Providers', 'OpenAI, Anthropic, Google, Perplexity'],
];

const PLANS = [
  {
    name: 'Answer Risk Audit',
    price: 'Free',
    unit: 'one time',
    body: 'We seed your truth registry, sample your highest-intent questions, and hand back every defect we can evidence. You keep the report either way.',
    cta: 'Start the audit',
    href: '#audit',
    lead: true,
  },
  {
    name: 'Monitor',
    price: '$750',
    unit: '/ month',
    body: '50 intent clusters across four surfaces, weekly and adaptive sampling, alerting that survives a significance test.',
    cta: 'Talk it through',
    href: '#audit',
    lead: false,
  },
  {
    name: 'Operate',
    price: '$2,000',
    unit: '/ month',
    body: '100 clusters, daily sampling, the full truth registry, the action catalogue and the experiment ledger.',
    cta: 'Talk it through',
    href: '#audit',
    lead: false,
  },
  {
    name: 'Enterprise',
    price: '$5,000+',
    unit: '/ month',
    body: 'Multi-brand and agency workspaces, CRM handoff, governance and approval trails, full export.',
    cta: 'Talk it through',
    href: '#audit',
    lead: false,
  },
];

export function landingView(): Raw {
  return html`
<a class="skip" href="#main">Skip to content</a>

<header class="lp-nav">
  <a class="lp-brand" href="/" aria-label="AnswerOps home">
    <span class="mark" aria-hidden="true">◧</span>
    <span class="word">AnswerOps</span>
  </a>
  <nav class="lp-nav-links" aria-label="Sections">
    <a href="#anatomy">The defect</a>
    <a href="#loop">The loop</a>
    <a href="#refusals">What we refuse</a>
    <a href="#design">Measurement</a>
    <a href="#plans">Pricing</a>
  </nav>
  <a class="btn btn-ghost" href="/login" data-testid="nav-signin">Sign in</a>
</header>

<main id="main">

  <!-- ------------------------------------------------------------------ hero -->
  <section class="shell hero">
    <div class="hero-copy">
      <p class="label">Answer integrity · measured, not controlled</p>
      <h1>The worst thing an AI says about you is the part that <em>sounds right</em>.</h1>
      <p class="lede">
        Assistants describe your company to buyers all day. When they get it wrong, the answer is
        still fluent, still positive, still convincing — and a tool that counts mentions scores it
        as a win. AnswerOps finds those answers, corrects the record they were drawn from, and
        proves whether the correction landed.
      </p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#audit" data-testid="cta-hero">Run a free answer risk audit</a>
        <a class="btn btn-ghost" href="#refusals">See what we refuse to claim</a>
      </div>
      <dl class="hero-proof">
        <div><dt>Surfaces sampled</dt><dd>OpenAI · Anthropic · Google · Perplexity</dd></div>
        <div><dt>Every rate ships as</dt><dd>point · 95% CI · n</dd></div>
        <div><dt>Below 5 runs</dt><dd>suppressed, not rounded</dd></div>
      </dl>
    </div>

    <!-- signature element: a worked defect, assembled in front of the reader -->
    <figure class="exhibit" data-exhibit data-phase="idle" aria-labelledby="exhibit-cap">
      <figcaption class="exhibit-head">
        <span class="stamp is-muted">Exhibit</span>
        <span class="who" id="exhibit-cap">Worked example · not a customer result</span>
        <span class="spacer"></span>
        <button type="button" class="replay" data-replay aria-label="Replay the exhibit">Replay</button>
      </figcaption>

      <div class="exhibit-body">
        <p class="answer" data-typed>
          Vanar positions itself as a low-cost L1 for high-volume consumer transactions.
          <span class="claim">Transaction fees are around $0.05 per transaction, which is competitive for
          consumer applications.</span>
          Vanar is headquartered in London and supports staking natively.<span class="cursor" aria-hidden="true"></span>
        </p>

        <div class="stage meta-row" data-shown="false">
          <span><b>surface</b> anthropic / claude · api</span>
          <span><b>grounding</b> grounded_search</span>
          <span><b>geo</b> US/en</span>
          <span><b>temp</b> 0.7</span>
        </div>

        <div class="stage sources" data-shown="false">
          <table>
            <caption>Sources the answer cited</caption>
            <tbody>
              <tr>
                <td>top10cryptolists.example.com/best-layer1-chains-2024</td>
                <td><span class="stamp is-danger">does not support it</span></td>
              </tr>
              <tr>
                <td>vanarchain.com/docs/fees</td>
                <td><span class="stamp is-cite">supports it</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="stage truth-card" data-shown="false">
          <div class="t-head">
            <span>Conflicting canonical fact</span>
            <span class="stamp is-danger">Contradicted</span>
          </div>
          <p>Vanar Chain transaction fees are approximately $0.0002 per transaction.</p>
          <p class="t-dates">in force 2025-01-15 → current · sensitivity material · approved by ops@vanar.example</p>
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
      <p class="label is-danger">Why a mention count cannot see this</p>
      <h2>The answer above is positive, well sourced, and wrong.</h2>
      <p class="lede">
        Sentiment is good. The brand is named. One of the two citations is your own documentation.
        Every share-of-voice tool on the market records this as a success, because the thing that
        broke is not the mention — it is the claim inside it.
      </p>
    </div>

    <div class="anatomy">
      <div class="anatomy-visual">
        <div class="plate">
          <p>
            Vanar positions itself as a low-cost L1 for high-volume consumer transactions.
            <span class="bad">Transaction fees are around $0.05 per transaction.</span>
            Vanar is headquartered in London and supports staking natively.
          </p>
        </div>
        <div class="overlay">
          <span class="t-label">Approved record · in force 2025-01-15 → current</span>
          <p>Vanar Chain transaction fees are approximately $0.0002 per transaction.</p>
        </div>
      </div>

      <div class="beats">
        <div class="beat">
          <span class="idx">01</span>
          <div>
            <h3>It is off by 250×</h3>
            <p>
              A buyer comparing chains on cost reads $0.05, closes the tab, and never appears in any
              funnel you measure. Nothing in your analytics records the loss.
            </p>
          </div>
        </div>
        <div class="beat">
          <span class="idx">02</span>
          <div>
            <h3>It was true once</h3>
            <p>
              Most bad answers are not invented, they are expired. That is why every fact in the
              registry carries a date range, and why an answer can be correctly sourced and still wrong.
            </p>
          </div>
        </div>
        <div class="beat">
          <span class="idx">03</span>
          <div>
            <h3>The fix is upstream</h3>
            <p>
              A spam listicle carried the claim and your own fees page did not rank against it. The
              intervention is a dated correction and a documentation fix, then a re-sample to see
              whether the answers actually changed.
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ------------------------------------------------------------------ loop -->
  <section class="shell section" id="loop">
    <div class="section-head">
      <p class="label">The operating loop</p>
      <h2>Not a dashboard. Five steps that close.</h2>
      <p class="lede">
        Visibility is an input here, never the deliverable. The product is the cycle that turns a
        wrong answer into a corrected record and then into evidence that the correction worked.
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
      <h2>The reason to trust the numbers is that we publish what we will not claim.</h2>
      <p class="lede">
        Each of these is a failing test, not a paragraph of positioning. If a future release ships a
        blended score or a bare percentage, the build goes red before a customer sees it.
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
      <h2>Published in full, because it is the product.</h2>
      <p class="lede">
        These constants govern every figure the console will show you. They are on the methodology
        page inside the product too, where that page doubles as the bug report: if any of it stops
        being true, that is a defect.
      </p>
    </div>

    <table class="spec">
      <caption class="note">Sampling and inference parameters, current release.</caption>
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
      Coverage at this depth costs real money in inference: fifty clusters across four providers,
      sampled repeatedly for thirty days, runs roughly $400–$1,000 a month in model and grounded-search
      spend before anything else. That is why serious monitoring is not sold at $49 — at $49 nobody
      can afford to sample enough to know whether the answer they gave you is right.
    </p>
  </section>

  <!-- ----------------------------------------------------------------- plans -->
  <section class="shell section" id="plans">
    <div class="section-head">
      <p class="label">Pricing</p>
      <h2>Priced on monitored intent coverage, not on raw prompt count.</h2>
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
      <h2>Find out what the models are telling your buyers this week.</h2>
      <p class="lede">
        The audit is the whole product run once, by hand, on your domain. It is free because the
        finding is usually enough — most teams have never seen a transcript of what an assistant
        actually says about them under an unaided question.
      </p>
      <ul>
        <li>We seed a truth registry from your documentation and you approve every fact before anything is sampled.</li>
        <li>We sample your highest-intent question clusters across all four providers.</li>
        <li>You get every defect we can evidence, with the transcripts, the surfaces and the citations.</li>
        <li>If we find nothing worth fixing, we say so, and you owe us nothing.</li>
      </ul>
    </div>

    <form class="audit-form" data-audit-form novalidate data-testid="audit-form">
      <h3>Request an answer risk audit</h3>
      <p class="note">Two fields. We reply with a scheduled window, not a sales sequence.</p>

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
        We store the request so we can run the audit and so you can ask us to delete it. Nothing is
        sampled, and no email is sent to anyone else, until you approve the facts we seed.
      </p>
    </form>
  </section>
</main>

<footer class="lp-footer">
  <div class="shell">
    <div class="rows">
      <span class="lp-brand"><span class="mark" aria-hidden="true">◧</span> <span class="word">AnswerOps</span></span>
      <span class="spacer"></span>
      <a href="/login">Sign in</a>
      <a href="#design">Measurement design</a>
      <a href="#refusals">What we refuse to claim</a>
    </div>
    <p class="creed">
      Measured, not controlled. Nobody controls what an external model says — we measure it, correct
      the record, and prove whether it moved. Rates carry a 95% Wilson interval and a sample size, or
      they are not shown. The exhibit on this page is a worked example built from the reference
      workspace, which samples a deterministic stand-in upstream; simulated runs are labelled as such
      everywhere in the product and are excluded from any customer-facing claim.
    </p>
  </div>
</footer>`;
}
