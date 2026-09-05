import { html, type Raw } from '../html.js';
import { HOME_FAQ } from '../../http/public-copy.js';

const STEPS = [
  [
    '01',
    'Set the record straight',
    'Add dated facts about your pricing, plans and integrations. Review what your website says before using it as the standard.',
    'You, once',
  ],
  [
    '02',
    'Ask the questions that matter',
    'Start with sales questions, search queries or support conversations. Repeat them on the configured model surfaces.',
    'Us, every week · when scheduled',
  ],
  [
    '03',
    'Follow the evidence',
    'Read the extracted claim, its citation and the fact it conflicts with. Separate a supported answer from a confident mistake.',
    'Us, with the transcript',
  ],
  [
    '04',
    'Make a targeted correction',
    'Review a change to a page you own. Keep the action, its assumptions and its approval history together.',
    'You, with a reviewable draft',
  ],
  [
    '05',
    'Check whether anything changed',
    'Sample again and compare with controls. Keep inconclusive results visible alongside improvements and regressions.',
    'Us, with an honest result',
  ],
];
const ERRORS = [
  ['01 / PRICING', 'A price you changed', 'An old price still appearing in a buyer’s comparison.'],
  ['02 / PRODUCT', 'A plan or limit you retired', 'A discontinued tier presented as something they can buy.'],
  [
    '03 / INTEGRATIONS',
    'An integration you sunset',
    'A connection described as available after support ended.',
  ],
];
const PRINCIPLES = [
  [
    'Evidence you can inspect',
    'Keep the answer, source snapshot when retrievable, dated fact and model setup together. A citation alone is not proof.',
  ],
  [
    'Numbers with their context',
    'Every rate includes its sample size and 95% Wilson interval. Below five runs, we show insufficient data.',
  ],
  [
    'A result you can challenge',
    'Change detection uses a two-proportion z-test and Benjamini-Hochberg correction. Experiments support matched controls and difference-in-differences.',
  ],
];
function exhibit(): Raw {
  return html`<figure class="exhibit" data-exhibit data-phase="idle" aria-labelledby="exhibit-cap" > <figcaption class="exhibit-head"> <span class="who" id="exhibit-cap" >A buyer asking an assistant. Worked example, not a measurement of Slack.</span ><button class="replay" type="button" data-replay aria-label="Replay the exhibit" > Replay </button> </figcaption> <div class="exhibit-body"> <div class="chat-window"> <div class="turn is-user"> <div class="bubble"> Does Slack's free plan keep our message history? </div> </div> <div class="turn is-bot"> <span class="avatar" aria-hidden="true">✳</span> <div class="bubble"> <p class="answer" data-typed> Slack's free plan works well for a small team. <span class="claim" >It keeps your 10,000 most recent messages, so nothing is lost while you stay under that.</span > Paid plans add unlimited history and Slack Connect.<span class="cursor" aria-hidden="true" ></span> </p> </div> </div> <div class="chat-composer" aria-hidden="true"> Ask anything <span>↑</span> </div> </div> <div class="annotations"> <div class="stage verdict-bar"> <span class="stamp is-danger">Miscited caught this</span ><span class="vsub" >Confident, positive, sourced, and out of date since September 2022</span > </div> <div class="stage meta-row"> <span><b>asked on</b> a simulated surface, for illustration</span ><span><b>from</b> the US, in English</span ><span><b>seen in</b> 116 illustrative runs</span> </div> <div class="stage sources"> <table> <caption> Sources the answer cited </caption> <tbody> ${[
    ['top10teamchat.example.com/best-slack-alternatives', 'does not support it'],
    ['slack.com/pricing', 'contradicts the old limit'],
  ].map(
    ([url, verdict]) => html`<tr> <td>${url}</td> <td>${verdict}</td> </tr>`,
  )} </tbody> </table> </div> <div class="stage truth-card"> <div class="t-head"> Your approved fact says otherwise <span class="stamp is-danger">Contradicted</span> </div> <p> The Slack free plan keeps 90 days of message history. The 10,000-message limit ended on 1 September 2022. </p> <p class="t-dates"> Illustrative dated fact · free plan: 90 days of accessible history </p> </div> </div> </div> <div class="exhibit-foot"> <span class="measure is-danger" ><span class="val">9%</span> <span class="ci">95% CI 5%–15%</span> <span class="n">n=116</span></span ><span class="stamp is-danger">Critical</span> </div> </figure>`;
}
function auditForm(rehearsal: boolean): Raw {
  return html`<form class="audit-form" data-audit-form novalidate data-testid="audit-form" > <h3>Request an answer audit</h3> <p class="note"> Two fields. An evidence-linked report. No payment details. </p> ${
    rehearsal
      ? html`<p class="note rehearsal" data-testid="rehearsal-notice"> <b>This deployment has no assistant API keys configured.</b> An audit requested now runs the full pipeline against a deterministic stand-in, not against ChatGPT, Claude, Gemini or Perplexity. The report will say so at the top, and none of its numbers describe what a real assistant tells your buyers. </p>`
      : null
  }${[
    {
      id: 'email',
      label: 'Work email',
      type: 'email',
      auto: 'email',
      hint: 'you@company.com',
    },
    {
      id: 'domain',
      label: 'Domain to audit',
      type: 'text',
      auto: 'url',
      hint: 'company.com',
    },
  ].map(
    (field) =>
      html`<div class="field"> <label for="audit-${field.id}">${field.label}</label ><input id="audit-${field.id}" name="${field.id}" type="${field.type}" autocomplete="${field.auto}" spellcheck="false" placeholder="${field.hint}" aria-describedby="err-audit-${field.id}" data-testid="audit-${field.id}"><span class="err" id="err-audit-${field.id}" data-err-for="audit-${field.id}" role="alert" ></span> </div>`,
  )}<button type="submit" class="btn btn-primary" data-submit data-testid="audit-submit" > Request the audit <span aria-hidden="true">↗</span></button> <div class="outcome" data-outcome role="status" aria-live="polite"></div> <p class="fineprint"> Submitting starts the audit automatically. We store your email, domain and report to operate the audit. Site-derived facts are provisional until reviewed; the report link appears here. </p> </form>`;
}

export function landingView(opts: { liveProviders?: number } = {}): Raw {
  const count = opts.liveProviders ?? 0;
  return html`
    <a class="skip" href="#main">Skip to content</a>
    <div class="announcement"><span class="status-dot" aria-hidden="true"></span> Early access <span class="announcement-divider">/</span> A clearer picture of what AI says about you. <a href="#audit">Explore your answers <span aria-hidden="true">↗</span></a></div>
    <header class="lp-nav shell">
      <a class="lp-brand" href="/" aria-label="Miscited home"><span class="mark" aria-hidden="true">m<span>·</span></span>miscited</a>
      <nav class="lp-nav-links" aria-label="Sections"><a href="#loop">How it works</a><a href="#teams">Who it’s for</a><a href="#design">The evidence</a><a href="#plans">Early access</a></nav>
      <a class="signin" href="/login" data-testid="nav-signin">Sign in <span aria-hidden="true">↗</span></a>
    </header>
    <main id="main">
      <section class="shell hero">
        <div class="hero-copy"><p class="label"><span class="cross" aria-hidden="true">+</span> AI answer accuracy for B2B SaaS</p>
          <h1>Quality control for what AI says about <em>your company.</em></h1>
          <p class="lede">Your product changed. The answer didn’t.</p>
          <p class="hero-description">Find outdated prices, retired plans and unsupported claims. Trace the evidence, correct the source, and test whether the next answer gets it right.</p>
          <div class="hero-actions"><a class="btn btn-primary" href="#audit" data-testid="cta-hero">Get a free answer audit <span aria-hidden="true">↗</span></a><a class="text-link" href="#example">See a worked example <span aria-hidden="true">↓</span></a></div>
          <p class="hero-note">No payment details. Every finding comes with its context.</p>
          <div class="hero-rule"><span>01 / FIND</span><span>02 / CORRECT</span><span>03 / RECHECK</span></div>
        </div>
        <div class="hero-evidence" id="example"><div class="evidence-kicker"><span>THE ANSWER LOOKS RIGHT.</span><span>LOOK CLOSER. ↙</span></div>${exhibit()}<p class="example-note">Illustrative data, not a customer result. <a href="https://slack.com/help/articles/27204752526611-Feature-limitations-on-the-free-version-of-Slack">Read Slack’s current free-plan limits ↗</a></p></div>
      </section>
      <div class="surface-strip"><div class="shell surface-inner"><p class="label">Built for multiple model providers</p><div class="provider-names"><span>OpenAI</span><span>Anthropic</span><span>Google</span><span>Perplexity</span></div><p class="surface-note">Coverage depends on configured API surfaces. API results can differ from consumer apps.</p></div></div>
      <section id="catches" class="shell section"><div class="section-heading"><p class="label">01 / The blind spot</p><h2>A mention can still get you wrong.</h2><p>Being named is one question. Being described accurately is another. Start with the facts your buyers use to decide.</p></div><div class="error-grid">${ERRORS.map(([tag, title, body]) => html`<article class="error-card"><span class="label">${tag}</span><div class="error-symbol" aria-hidden="true">≠</div><h3>${title}</h3><p>${body}</p></article>`)}</div></section>
      <section id="loop" class="workflow"><div class="shell"><div class="section-heading"><p class="label">02 / From finding to follow-through</p><h2>Give every wrong answer a next step.</h2><p>A report is the beginning. Keep the evidence, the correction and the follow-up measurement connected.</p></div><div class="steps">${STEPS.map(([n, title, body, who]) => html`<article class="step"><span class="step-number">${n}</span><div><h3>${title}</h3><p>${body}</p></div><span class="step-owner">${who}</span></article>`)}</div><a class="text-link" href="#audit">Start with your domain <span aria-hidden="true">↗</span></a></div></section>
      <section id="teams" class="shell section"><div class="section-heading"><p class="label">03 / Built around the people who fix it</p><h2>For teams with a record to protect.</h2></div><div class="team-grid"><article><span class="label">B2B SaaS teams</span><h3>Keep the product story current.</h3><p>Bring product marketing, content and support around the same evidence. Review old prices, missing qualifications and retired capabilities before they become another conversation to untangle.</p><a class="text-link" href="#audit">Audit your company ↗</a></article><article><span class="label">Specialist agencies</span><h3>Bring clients the finding and the follow-up.</h3><p>Work across brands with separate permissions and evidence histories. Make a concrete correction part of your engagement, then report what changed and what remains uncertain.</p><a class="text-link" href="#audit">Start with one client ↗</a></article></div></section>
      <section id="design" class="evidence-section"><div class="shell"><div class="section-heading"><p class="label">04 / The standard of proof</p><h2>Show your work.</h2><p>The useful question is whether you can defend a finding when someone opens the source.</p></div><div class="principles">${PRINCIPLES.map(([title, body], i) => html`<article><span class="principle-number">0${i + 1}</span><h3>${title}</h3><p>${body}</p></article>`)}</div><div class="evidence-links"><a href="/blog/how-many-prompts-ai-visibility-sample-size">Read the measurement guide ↗</a><a href="https://github.com/jooliperbush/ai-roadmap">Inspect the project on GitHub ↗</a></div><details id="refusals" class="refusals"><summary>What we refuse to claim <span aria-hidden="true">+</span></summary><p>We cannot decide what an external model says. A corrected page may help; it may not. We do not promise a ranking, hide an inconclusive experiment or combine unlike buyer questions into a single score. Source access and extraction coverage have limits, and human review matters.</p></details></div></section>
      <section id="plans" class="shell section"><div class="section-heading"><p class="label">05 / Early access</p><h2>Start with one useful finding.</h2><p>Find out whether this is a problem worth solving for your team before committing to an ongoing program.</p></div><div class="plan-grid"><article class="plan featured"><span class="label">Answer Risk Audit</span><h3>First, see the evidence.</h3><p class="price">Free<span>one-time sample</span></p><p>Submit your domain. Get a dated report with provisional site facts, sampled answers, citations and coverage limits.</p><a class="btn btn-primary" href="#audit">Start the audit ↗</a></article><article class="plan"><span class="label">Founding teams & agencies</span><h3>Then, scope the follow-through.</h3><p>Ongoing monitoring and correction work are scoped during early access. Agree the brands, questions, provider usage and review responsibilities before a paid engagement.</p><p class="plan-note">Pilot scope and pricing agreed individually. No subscription checkout on this page.</p><a class="text-link" href="#audit">Begin with an audit ↗</a></article></div></section>
      <section class="shell faq-section" id="faq"><div><p class="label">A few fair questions</p><h2>Before you begin.</h2></div><div class="faq-list">${HOME_FAQ.map(({ q, a }) => html`<details><summary>${q}<span aria-hidden="true">+</span></summary><p>${a}</p></details>`)}</div></section>
      <section class="audit-section" id="audit"><div class="shell audit-grid"><div class="audit-copy"><p class="label">Your domain. The actual record.</p><h2>See what the answers say.</h2><p class="lede">A concrete place to start the conversation.</p><ul><li>A dated report you can inspect.</li><li>Extracted claims and the sources behind them.</li><li>Clear labels for simulated results and missing coverage.</li></ul><p class="coverage-note">${count >= 4 ? 'We sample your questions across all four assistants through their configured APIs.' : 'We sample your questions on the configured API surfaces.'} Results depend on the model, access mode, region and date.</p></div>${auditForm(count === 0)}</div></section>
    </main>
    <footer class="shell lp-footer"><div class="footer-top"><a class="lp-brand" href="/">miscited<span class="footer-period">.</span></a><p>A better record.<br>A more accountable answer.</p></div><nav aria-label="Footer"><a href="/blog">Writing</a><a href="#design">Measurement</a><a href="https://github.com/jooliperbush/ai-roadmap">GitHub ↗</a><a href="/login">Sign in</a></nav><div class="footer-bottom"><span>Miscited / Answer accuracy</span><span>Measured, not controlled.</span></div></footer>
  `;
}
