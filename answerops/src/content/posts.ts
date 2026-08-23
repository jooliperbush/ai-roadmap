/**
 * Writing.
 *
 * These posts live in `src/`, which means the product-integrity lint walks them like any other
 * shipped file. That is deliberate: a marketing claim we would fail the build for making in the
 * console is not one we get to make in a blog post because the audience is colder.
 *
 * Every number below is computed from this codebase or cited to a dated external source. Where
 * a figure is an estimate it says so in the sentence, not in a footnote.
 */

export interface FaqEntry {
  q: string;
  a: string;
}

export interface Post {
  slug: string;
  title: string;
  /** <= 60 characters, because a longer one is truncated in the result and reads as careless. */
  metaTitle: string;
  /** <= 155 characters. */
  metaDescription: string;
  /** One sentence, used on the index, in llms.txt and in the BlogPosting description. */
  summary: string;
  published: string;
  updated: string;
  readingMinutes: number;
  /** The query this post is written to answer, stated plainly for the reader and for us. */
  targetQuery: string;
  faq: FaqEntry[];
  body: string;
}

// ---------------------------------------------------------------------------

const WRONG_ANSWERS: Post = {
  slug: 'fix-wrong-ai-answers-about-your-company',
  title: 'How to fix a wrong AI answer about your company',
  metaTitle: 'Fix wrong AI answers about your company',
  metaDescription:
    'Assistants state stale prices, dead features and wrong facts about companies. A five-step method to find each wrong claim, trace its source, fix it and verify.',
  summary:
    'How to find every wrong claim an assistant makes about your company, trace it to the page it came from, correct that page, and confirm the answer actually changed.',
  published: '2026-08-23',
  updated: '2026-08-23',
  readingMinutes: 9,
  targetQuery: 'ChatGPT says wrong things about my business, how do I fix it',
  faq: [
    {
      q: 'Can you edit what ChatGPT says about your company?',
      a: 'No. There is no field anywhere that sets what a model says about you. What you can change is the material the model retrieves and was trained on: your own pages, the directories and profiles it leans on, and third-party pages that state something false. Change those, then re-ask and measure whether the answer moved.',
    },
    {
      q: 'How long does it take for a corrected page to change an AI answer?',
      a: 'For grounded answers, where the assistant searches the web before replying, the change can appear as soon as the retrieval crawler refetches the page, which is often days. For answers drawn from training memory rather than live retrieval, a correction may not appear until a later training run, and may never appear. The two cases need to be measured separately because they have different fixes.',
    },
    {
      q: 'Why does an assistant cite my own pricing page and still get the price wrong?',
      a: 'Citation is not verification. A model can attach a source to a sentence the source does not support, and it can retrieve a page whose stated fact expired. This is why checking whether each cited page actually contains the claim is a separate step from checking whether the claim is true.',
    },
    {
      q: 'Is one wrong answer worth acting on?',
      a: 'Usually not on its own. A single wrong reply can be sampling noise. What is worth acting on is a claim that recurs across repeated asks on the same question, which is why the unit of work is a rate across many runs rather than a screenshot.',
    },
  ],
  body: `
<p class="lede">
  A buyer asks an assistant what your product costs. It answers confidently, cites your own pricing
  page, and quotes a number you retired eighteen months ago. Nobody clicks through. Nobody emails to
  check. You lose the deal without ever learning it existed.
</p>

<p>
  This is the ordinary failure of AI answers, and it is not the one most tools look for. They ask
  whether you were mentioned and whether the tone was positive. A confident, well-formatted, correctly
  cited, wrong answer passes both tests.
</p>

<h2>Why assistants get your company wrong</h2>

<p>There are four distinct causes, and they have four different fixes. Treating them as one problem is
why most correction efforts stall.</p>

<div class="tw"><table>
  <thead><tr><th>Cause</th><th>What it looks like</th><th>What fixes it</th></tr></thead>
  <tbody>
    <tr><td class="k">Your page is stale</td><td>The answer is right about what your site says, and your site is out of date.</td><td>Correct the page. Cheapest and most common.</td></tr>
    <tr><td class="k">Your pages disagree</td><td>Docs say one thing, pricing page another, a 2023 blog post a third.</td><td>Reconcile them. The model is not wrong so much as forced to choose.</td></tr>
    <tr><td class="k">A third party is wrong</td><td>A directory, a review site or an old article states something false and gets retrieved.</td><td>A correction request to that publisher. Slowest, least within your control.</td></tr>
    <tr><td class="k">It was never retrieved</td><td>The answer came from training memory, not from a live search.</td><td>Nothing you publish today changes it quickly. Worth knowing before you spend a quarter on it.</td></tr>
  </tbody>
</table></div>

<p>
  That last row is the one teams skip. If an answer was produced without grounding, fixing your robots
  rules for a retrieval crawler will not move it, because no retrieval happened. Knowing which mode
  produced the answer is a prerequisite for choosing the fix, not a detail.
</p>

<h2>How to find all of them, not only the one you spotted</h2>

<p>
  The screenshot someone forwards you is a sample of one. Here is the method that produces something
  you can act on.
</p>

<h3>1. Write down what is true, with dates</h3>
<p>
  A claim is only wrong relative to something. Before measuring anything, record your facts with an
  effective date and an expiry: price, fees, limits, integrations, availability, certifications,
  leadership. The dates matter more than they look. Most wrong answers are not fabrications, they are
  facts that expired, and you cannot detect an expired fact without knowing when it stopped being true.
</p>

<h3>2. Ask the questions your buyers actually ask</h3>
<p>
  Not invented prompts. Pull them from search console, site search, support chat, sales calls and loss
  reasons. Keep them in intent families and never average across families: being named when someone
  asks about you by name is a different result from being recommended when someone asks for a vendor,
  and blending the two produces a flattering number that means nothing.
</p>

<h3>3. Ask repeatedly, and record the exact setup</h3>
<p>
  "ChatGPT" is not a measurement surface. Provider, model, model version, access mode, grounding mode,
  search mode, country, language and personalization state all change the answer. Store all of them
  with every run, or you will not be able to reproduce a finding or tell which surface a fix affected.
</p>

<h3>4. Check the claim and the citation separately</h3>
<p>
  Two different checks. First, does the extracted claim contradict a fact in your registry, given the
  dates that fact was in force. Second, does the page the answer cited actually contain the claim
  attached to it. A sourced-but-unsupported claim is a distinct defect with a distinct fix, and it is
  the one that most damages trust when a buyer follows the link.
</p>

<h3>5. Fix the record, then prove the answer moved</h3>
<p>
  Correct the page, wait for the retrieval crawler, then re-ask the same questions on the same surfaces
  and compare against a set of questions you deliberately left alone. Without that untouched control
  you cannot separate your fix from a model update that happened the same week. This is the step almost
  everyone skips, and it is the only one that turns a correction into evidence.
</p>

<h2>What "fixed" has to mean</h2>

<p>
  A number going up is not evidence. Models update, retrieval indexes shift, and a competitor
  publishing something unrelated can move your rate. The claim "our fix worked" requires a before
  window, an after window, matched controls that were not touched, and a stated effect size with its
  uncertainty.
</p>

<p>
  It also requires enough samples to see the change at all. Detecting a ten-point move at a 40% base
  rate needs roughly 388 runs per side at 80% power. If you sampled thirty prompts, a ten-point
  improvement is invisible to you and so is a ten-point regression. We worked that arithmetic through
  in <a href="/blog/how-many-prompts-ai-visibility-sample-size">how many prompts an AI visibility number
  actually needs</a>.
</p>

<h2>The order that matters</h2>

<ol>
  <li>Fix the pages you own first. Highest success rate, lowest cost, fastest feedback.</li>
  <li>Reconcile pages that contradict each other before writing anything new.</li>
  <li>Repair retrieval access only for the crawler class that actually produced the answers you care about.</li>
  <li>Send correction packets to third parties last. They are the least likely to land and the slowest to verify.</li>
</ol>

<p>
  Nobody outside a frontier lab decides what a model says. What you can do is make the record it reads
  correct, and then measure honestly whether the answers changed. That is the whole job.
</p>
`,
};

// ---------------------------------------------------------------------------

const SAMPLE_SIZE: Post = {
  slug: 'how-many-prompts-ai-visibility-sample-size',
  title: 'How many prompts before an AI visibility number means anything?',
  metaTitle: 'How many prompts does AI visibility need?',
  metaDescription:
    'Most AI visibility tools sample 25 to 300 prompts a month. Here is the arithmetic on what that buys you, and what it takes to detect a real change.',
  summary:
    'The arithmetic behind AI visibility percentages: what interval a given sample size actually earns you, and how many runs it takes to detect a change rather than noise.',
  published: '2026-08-23',
  updated: '2026-08-23',
  readingMinutes: 8,
  targetQuery: 'how many prompts do you need to measure AI visibility accurately',
  faq: [
    {
      q: 'How many prompts do you need to measure AI visibility?',
      a: 'It depends entirely on what you intend to conclude. To state a rate with a margin of roughly ten points, you need about 100 runs per question cluster. To detect a ten-point change between two periods at a 40% base rate and 80% power, you need roughly 388 runs per side. Sampling 25 to 50 prompts supports the observation that something occurred, and does not support a percentage.',
    },
    {
      q: 'Why does a 40% AI visibility score need a confidence interval?',
      a: 'Because 40% from 10 runs and 40% from 1,000 runs are different findings presented identically. At 10 runs the 95% Wilson interval is 17% to 69%. At 1,000 runs it is 37% to 43%. Without the interval and the sample size, a reader cannot tell which one they are looking at.',
    },
    {
      q: 'What is a Wilson score interval and why use it for AI answer measurement?',
      a: 'A Wilson score interval is a confidence interval for a proportion that stays correct at small samples and at the boundaries. The commonly used normal approximation breaks down exactly where AI answer measurement operates: small n, and rates near 0% or 100%. At zero hits the normal approximation reports an interval of zero width, which is plainly false.',
    },
    {
      q: 'Is a single wrong AI answer a finding?',
      a: 'No. One run out of two reads as 50% and carries a 95% interval of 9% to 91%. That is compatible with almost any true rate. A single observation is a reason to look, not a result to report.',
    },
  ],
  body: `
<p class="lede">
  Almost every AI visibility tool reports a percentage. Very few report how many times they asked.
  Those two facts together are the reason most of these numbers cannot support the decisions being
  made on them.
</p>

<p>
  This post is arithmetic, not opinion. Every figure below is computed with a 95% Wilson score
  interval and a standard two-proportion power calculation, and you can reproduce all of them.
</p>

<h2>What a 40% visibility rate is actually worth</h2>

<p>
  Suppose a tool tells you that you appear in 40% of relevant answers. Here is the same 40%, measured
  at different sample sizes, with the 95% interval it earns.
</p>

<div class="tw"><table>
  <thead><tr><th>Runs</th><th>Result</th><th>95% interval</th><th>Interval width</th></tr></thead>
  <tbody>
    <tr><td class="num">10</td><td class="num">4/10 = 40%</td><td class="num">17% to 69%</td><td class="num bad">52 points</td></tr>
    <tr><td class="num">25</td><td class="num">10/25 = 40%</td><td class="num">23% to 59%</td><td class="num bad">36 points</td></tr>
    <tr><td class="num">50</td><td class="num">20/50 = 40%</td><td class="num">28% to 54%</td><td class="num bad">26 points</td></tr>
    <tr><td class="num">100</td><td class="num">40/100 = 40%</td><td class="num">31% to 50%</td><td class="num">19 points</td></tr>
    <tr><td class="num">200</td><td class="num">80/200 = 40%</td><td class="num">33% to 47%</td><td class="num">13 points</td></tr>
    <tr><td class="num">500</td><td class="num">200/500 = 40%</td><td class="num">36% to 44%</td><td class="num good">9 points</td></tr>
    <tr><td class="num">1000</td><td class="num">400/1000 = 40%</td><td class="num">37% to 43%</td><td class="num good">6 points</td></tr>
  </tbody>
</table></div>

<p>
  A widely repeated piece of advice in this category is that a 40% visibility rate across 200 prompt
  runs is meaningful data. By the arithmetic above, 200 runs buys you a band from 33% to 47%. That is
  real information. It is not enough to tell a 40% quarter from a 45% quarter, and it will be reported
  to you as though it were.
</p>

<h2>How many runs it takes to detect a change</h2>

<p>
  Stating a rate is the easy half. The reason anyone buys this software is to know whether something
  moved. That is a much more expensive question.
</p>

<p>
  At a 40% base rate, with 80% power and a 95% significance threshold, here is what each size of change
  costs to detect:
</p>

<div class="tw"><table>
  <thead><tr><th>Change you want to detect</th><th>Runs needed per side</th></tr></thead>
  <tbody>
    <tr><td class="k">5 points</td><td class="num">1,534</td></tr>
    <tr><td class="k">10 points</td><td class="num">388</td></tr>
    <tr><td class="k">15 points</td><td class="num">173</td></tr>
    <tr><td class="k">20 points</td><td class="num">97</td></tr>
    <tr><td class="k">30 points</td><td class="num">42</td></tr>
  </tbody>
</table></div>

<p>
  Read that against a tool sampling 25 to 300 prompts per month in total, across every question it
  tracks. Split across even ten question clusters, that is a few dozen runs each. Such a tool can tell
  you that a thirty-point collapse happened. It cannot tell you that your content programme produced a
  ten-point gain, and it will not say so.
</p>

<h2>The small-sample trap</h2>

<p>
  Small samples do not merely produce vague numbers. They produce confident, specific, wrong ones,
  because a percentage hides its own denominator.
</p>

<div class="tw"><table>
  <thead><tr><th>Observed</th><th>Reads as</th><th>Actual 95% interval</th></tr></thead>
  <tbody>
    <tr><td class="num">1 of 2</td><td class="num">50%</td><td class="num">9% to 91%</td></tr>
    <tr><td class="num">2 of 5</td><td class="num">40%</td><td class="num">12% to 77%</td></tr>
    <tr><td class="num">3 of 10</td><td class="num">30%</td><td class="num">11% to 60%</td></tr>
    <tr><td class="num">30 of 100</td><td class="num">30%</td><td class="num">22% to 40%</td></tr>
  </tbody>
</table></div>

<p>
  Rows one and three both round to a tidy figure a slide will happily carry. Neither distinguishes a
  serious problem from a rounding artefact. This is why we suppress rates entirely below a floor of
  five runs per question cluster per window and print "insufficient data" instead. A blank is annoying.
  A number that reads like a measurement and is not one is worse.
</p>

<h2>Three rules that follow from the arithmetic</h2>

<ol>
  <li><b>Never publish a rate without its sample size and interval.</b> The same percentage from 10 runs and 1,000 runs are different findings, and only the denominator distinguishes them.</li>
  <li><b>Never average across intent families.</b> Being named when asked about you by name and being recommended when asked for a vendor are separate questions with separate base rates. Averaging them raises n while destroying the meaning.</li>
  <li><b>Correct for multiple comparisons.</b> Testing forty question clusters at p &lt; 0.05 produces roughly two false alarms per round by construction. A Benjamini-Hochberg correction across everything tested in the round is the cheapest fix.</li>
</ol>

<h2>What this costs</h2>

<p>
  Sampling properly is not expensive, which is the frustrating part. At list prices reviewed on
  21 August 2026, a grounded answer of roughly 2,000 input and 700 output tokens with one search call
  costs about $0.0095 on Gemini 2.5 Pro, $0.0195 on GPT-5.1, $0.0215 on Sonar Pro and $0.0375 on Claude
  Opus 4.5. Blended, about $0.022 a run.
</p>

<p>
  So 388 runs per side, the number that buys you a defensible ten-point detection, costs roughly $8.50
  of provider spend. The reason most tools sample 25 prompts is not the cost of the tokens.
</p>
`,
};

// ---------------------------------------------------------------------------

const VISIBILITY_VS_ACCURACY: Post = {
  slug: 'ai-visibility-vs-answer-accuracy',
  title: 'AI visibility and answer accuracy are different things',
  metaTitle: 'AI visibility vs answer accuracy',
  metaDescription:
    'Visibility tools count mentions and sentiment. Accuracy tools check whether the claim is true. One test tells them apart, and it changes what you should buy.',
  summary:
    'Visibility tools score a mention; accuracy tools score a claim. A single worked example separates the two categories and shows which problem each one leaves unsolved.',
  published: '2026-08-23',
  updated: '2026-08-23',
  readingMinutes: 7,
  targetQuery: 'AI visibility monitoring vs AI answer accuracy, which do I need',
  faq: [
    {
      q: 'What is the difference between AI visibility monitoring and answer accuracy monitoring?',
      a: 'Visibility monitoring measures whether your brand appears in AI answers and how the mention reads: mention count, sentiment and share of voice. Accuracy monitoring measures whether the statements in those answers are true, by checking each claim against a dated registry of your own facts and checking whether each citation supports the claim attached to it. A confident answer that names you positively and states a price you retired scores as a success in the first category and a defect in the second.',
    },
    {
      q: 'Do I need both AI visibility and accuracy tracking?',
      a: 'Visibility is an input to accuracy: you cannot check a claim in an answer that never mentions you. The practical question is which failure costs you more. If buyers cannot find you in AI answers at all, visibility is the binding constraint. If they find you and act on something false, accuracy is.',
    },
    {
      q: 'Why does share of voice not catch a wrong AI answer?',
      a: 'Because share of voice counts mentions and weighs their tone. It has no representation of what is true. A wrong claim delivered in a positive tone with a citation to your own domain increases share of voice and sentiment at the same time as it costs you the deal.',
    },
  ],
  body: `
<p class="lede">
  Both categories sell dashboards about AI answers, so they look like the same product bought for the
  same reason. They are not, and one worked example separates them permanently.
</p>

<h2>The example</h2>

<p>Ask any assistant what Slack's free plan keeps. Many will answer something close to this:</p>

<blockquote>
  "Slack's free plan keeps your 10,000 most recent messages, so nothing is lost while you stay under
  that limit."
</blockquote>

<p>
  The brand is named. The tone is positive. One of the citations is Slack's own pricing page. The
  10,000-message limit ended on 1 September 2022; the free plan keeps 90 days of history. You can verify
  both halves in under a minute.
</p>

<p>
  Now score that answer with each kind of tool. A visibility tool records a mention, positive sentiment
  and a citation to the brand's own domain, which is the best result it knows how to record. An
  accuracy tool records a defect: the claim contradicts a fact whose expiry date has passed, and the
  cited page does not support the sentence attached to it.
</p>

<p>Same answer. Opposite scores. That is the whole distinction.</p>

<h2>What each category actually measures</h2>

<div class="tw"><table>
  <thead><tr><th></th><th>Visibility monitoring</th><th>Answer accuracy</th></tr></thead>
  <tbody>
    <tr><td class="k">Unit</td><td>A mention</td><td>A claim, in an intent family, on a surface, in a market, at a time</td></tr>
    <tr><td class="k">Core metrics</td><td>Mention rate, sentiment, share of voice</td><td>Defect rate against dated facts, citation support rate</td></tr>
    <tr><td class="k">Needs from you</td><td>A list of prompts</td><td>A registry of your facts, with effective dates and expiries</td></tr>
    <tr><td class="k">Catches a stale price</td><td>No</td><td>Yes</td></tr>
    <tr><td class="k">Catches a citation that does not support its claim</td><td>No</td><td>Yes</td></tr>
    <tr><td class="k">Catches total absence from a category answer</td><td>Yes</td><td>Yes</td></tr>
    <tr><td class="k">Proves a fix worked</td><td>Rarely, and usually by before/after alone</td><td>Requires matched controls and a stated effect size</td></tr>
  </tbody>
</table></div>

<h2>The three questions that tell them apart on a demo call</h2>

<p>Ask any vendor in this space these, in this order.</p>

<h3>1. "What is the sample size behind this percentage, and its interval?"</h3>
<p>
  If the answer is a number with no denominator, the dashboard cannot tell a real change from noise.
  We worked through what each sample size actually earns you in
  <a href="/blog/how-many-prompts-ai-visibility-sample-size">how many prompts an AI visibility number
  needs</a>. Short version: 25 prompts supports the observation that something happened, not a rate.
</p>

<h3>2. "Show me an answer that mentions us positively and is still wrong."</h3>
<p>
  A visibility product has no way to represent this state, because nothing in its data model holds what
  is true. If the demo cannot produce the case, the tool cannot detect the case.
</p>

<h3>3. "When we fix something, how do you know the fix caused the change?"</h3>
<p>
  Watch for a control group. Models update on their own schedule. Without a set of questions
  deliberately left untouched over the same window, a before-and-after comparison attributes every
  model update to your content team.
</p>

<h2>Which problem do you have?</h2>

<p>
  This is genuinely situational, and vendors in each category have an obvious incentive to tell you it
  is theirs.
</p>

<ul>
  <li><b>Visibility is your constraint</b> if buyers ask category questions and you are simply not in the answer. Absence is the finding, and there is no claim to check yet.</li>
  <li><b>Accuracy is your constraint</b> if you appear regularly and the facts move: pricing changes, limits change, integrations ship and get deprecated, certifications get renewed. Fast-moving categories generate wrong answers faster than they generate missing ones.</li>
  <li><b>Neither is urgent</b> if your facts have not changed in three years and your category is not one buyers research through an assistant. Some businesses are genuinely in this position and are better served by ignoring both.</li>
</ul>

<p>
  The honest summary: visibility tells you whether you are in the room, accuracy tells you whether what
  is being said about you in that room is true. The second question only exists once the answer to the
  first is yes, and for most established B2B companies the answer to the first is already yes.
</p>
`,
};

// ---------------------------------------------------------------------------

export const POSTS: Post[] = [SAMPLE_SIZE, WRONG_ANSWERS, VISIBILITY_VS_ACCURACY];

export function postBySlug(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/** Newest first, which is also the order the index and the sitemap use. */
export function postsNewestFirst(): Post[] {
  return [...POSTS].sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));
}
