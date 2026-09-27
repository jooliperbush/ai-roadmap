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

/** The topics a post can be filed under. blog.css has one filter rule per topic, so add both together. */
export const TAGS = ['Accuracy', 'Measurement', 'Corrections', 'Case studies', 'Risk'] as const;
export type Tag = (typeof TAGS)[number];

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
  /** One to three, most specific first. Related posts are chosen by shared tags. */
  tags: Tag[];
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
  tags: ['Corrections', 'Accuracy'],
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
  tags: ['Measurement'],
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
  tags: ['Accuracy', 'Measurement'],
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

// Moffatt v. Air Canada: paragraphs 15 to 17, 27 and 44 only, read against the CanLII text. Air
// Canada is not a customer, and every place the post names it says so.
const AIR_CANADA_RULING: Post = {
  slug: 'air-canada-chatbot-ruling-ai-answers',
  title: 'What the Air Canada chatbot ruling means for what AI says about your company',
  metaTitle: 'What the Air Canada chatbot ruling means for AI answers',
  metaDescription:
    'Air Canada argued it was not liable for what its chatbot said. A tribunal ordered it to pay. What that means for your own bot and for ChatGPT answers.',
  summary:
    'What the chatbot told a customer, what the tribunal ordered, and what the ruling means for answers from your own bot and from assistants you do not run.',
  published: '2026-09-27',
  updated: '2026-09-27',
  readingMinutes: 11,
  targetQuery: 'what does the Air Canada chatbot case mean for businesses',
  tags: ['Risk', 'Case studies'],
  faq: [
    {
      q: 'What happened in the Air Canada chatbot case?',
      a: "A customer asked Air Canada's chatbot about bereavement fares and was told that someone who had already travelled could submit their ticket for a reduced bereavement rate within 90 days. The bereavement travel page the chatbot linked to said, according to the tribunal, that the policy did not apply after travel. In Moffatt v. Air Canada, 2024 BCCRT 149, Air Canada was ordered to pay C$812.02 in total. Air Canada is not a Miscited customer.",
    },
    {
      q: 'Is a company responsible for what its own chatbot says?',
      a: 'Air Canada argued that it could not be held liable for information provided by its agents, including a chatbot. The tribunal called that "a remarkable submission" (para 27) and ordered the airline to pay. That is one tribunal decision, not a rule for every country, and this is not legal advice, but the safe working assumption is that your bot speaks for you. Air Canada is not a Miscited customer.',
    },
    {
      q: 'Does the ruling apply to ChatGPT, Gemini or Perplexity answers about my company?',
      a: 'Not directly. The case concerned a company and its own chatbot. When a third-party assistant gets your company wrong, you do not run the model and cannot edit the answer, but your buyers still read it. What you can change is the record it draws on: your own pages, and third-party pages that state something false. This is not legal advice.',
    },
    {
      q: 'What should a company do after the Air Canada ruling?',
      a: 'If you run a chatbot, test it against your current, dated policies before customers find the gaps, and test again whenever a policy or the bot changes. For assistants you do not run, ask the questions buyers ask, check each claim against your facts and correct the pages that wrong claims trace back to. Air Canada is not a Miscited customer.',
    },
  ],
  body: `
<p class="lede">
  A customer asked Air Canada's chatbot about bereavement fares. The chatbot answered, linked to a policy
  page that said something different, and the airline later argued before a tribunal that it could not be
  held liable for what its chatbot had said. The tribunal ordered it to pay.
</p>

<p>
  The decision is Moffatt v. Air Canada, 2024 BCCRT 149, from a tribunal in British Columbia, dated
  14 February 2024. Air Canada is not a Miscited customer. We use the case because the decision is public
  and the facts are unusually clear. This post is not legal advice.
</p>

<h2>What the chatbot said</h2>

<p>The decision quotes the chatbot's reply, including this passage:</p>

<figure class="quote">
  <blockquote>
    "…have already travelled and would like to submit your ticket for a reduced bereavement rate, kindly
    do so within 90 days…"
  </blockquote>
  <figcaption>Moffatt v. Air Canada, 2024 BCCRT 149, para 15</figcaption>
</figure>

<p>
  In the same reply, the words bereavement fares linked to Air Canada's own page on bereavement travel.
  According to the tribunal, that page said the bereavement policy does not apply to requests made once
  travel has been completed (paras 16 to 17). The answer and the page it linked to disagreed.
</p>

<h2>The argument that did not work</h2>

<p>
  Air Canada's position was that it could not be held liable for information provided by its agents,
  including a chatbot. The tribunal called this "a remarkable submission" (para 27). It ordered Air Canada
  to pay C$812.02 in total (para 44).
</p>

<p>
  The sum is small, and this is one decision from one tribunal. It does not tell you how a court elsewhere
  would rule on different facts. What it does show is how the defence sounds when a company makes it out
  loud: the bot talks to our customers, and what it tells them is somebody else's problem. One tribunal
  was not persuaded. We would not plan on the next one seeing it differently.
</p>

<h2>Your own bot and someone else's assistant</h2>

<p>
  The case was about a company's own chatbot. Buyers also read answers about companies from assistants
  those companies do not run: ChatGPT, Gemini, Perplexity and others. The two situations differ in almost
  every way that matters for a fix.
</p>

<div class="tw"><table>
  <thead><tr><th></th><th>Your own chatbot</th><th>A third-party assistant</th></tr></thead>
  <tbody>
    <tr><td class="k">Who runs it</td><td>You, or a vendor working for you</td><td>OpenAI, Google, Perplexity and others</td></tr>
    <tr><td class="k">What it reads</td><td>The content you give it, plus whatever its underlying model already holds</td><td>The open web, including your site and pages about you</td></tr>
    <tr><td class="k">Who answers for it</td><td>You, if Moffatt is any guide</td><td>Unsettled, and slow to settle</td></tr>
    <tr><td class="k">What you can change</td><td>The bot, its sources and its instructions</td><td>The pages it reads, not the model</td></tr>
    <tr><td class="k">How you find wrong answers</td><td>Test it against your current policies</td><td>Ask it repeatedly and check each claim</td></tr>
  </tbody>
</table></div>

<p>
  The right-hand column is the harder one. When an assistant you do not run states your old price, there is
  no bot of yours to fix and no quick legal remedy. There is still a buyer reading the answer and acting on
  it. The lever you have is the record the assistant reads, which is why the work starts with finding each
  wrong claim and tracing it to a page. What the courts have said so far about that column is in
  <a href="/blog/ai-false-statements-about-businesses-cases">when AI says something false about a
  business</a>.
</p>

<h2>The failure is a familiar one</h2>

<p>
  Take the legal outcome away and the Moffatt answer is a specific, checkable defect: a confident claim
  attached to a source that says something else. Checking whether a claim is true and checking whether its
  cited page supports it are separate tests, and this answer fails both. We described that pair of checks
  in <a href="/blog/fix-wrong-ai-answers-about-your-company">how to fix a wrong AI answer about your
  company</a>.
</p>

<p>
  It is also the kind of answer a mention count scores as a success. The company is named, the tone is
  helpful, and the link points at the company's own domain. We set out why that passes a visibility
  dashboard and fails an accuracy check in
  <a href="/blog/ai-visibility-vs-answer-accuracy">AI visibility and answer accuracy are different
  things</a>.
</p>

<p>
  One more lesson sits in the facts. The dispute was about a single conversation, preserved well enough to
  be quoted. Your own checks cannot work that way. One transcript shows that an answer is possible, not how
  often buyers get it: one wrong reply in two asks reads as 50%, with a 95% interval of 9% to 91%. We
  worked through how many runs a rate needs in
  <a href="/blog/how-many-prompts-ai-visibility-sample-size">how many prompts an AI visibility number
  actually needs</a>.
</p>

<h2>What to do about it</h2>

<ul>
  <li><b>If you run a chatbot,</b> list the policies it can talk about, with the date each one took effect, and test the bot against them whenever a policy or the bot changes. Treat a link to your own page as a claim to check, not as proof.</li>
  <li><b>For assistants you do not run,</b> ask the questions your buyers ask, split the answers into claims and compare each claim with your dated facts. The full method is in <a href="/blog/check-what-ai-says-about-your-company">how to check what ChatGPT, Gemini and Perplexity say about your company</a>.</li>
  <li><b>Keep dated records</b> of what was said, where and when, and of every correction you ask for. If a wrong answer ever becomes a dispute, the record is what you will have.</li>
</ul>

<figure class="video">
  <div class="frame"><video controls preload="none" playsinline width="1920" height="1080" poster="/static/video/miscited-explainer-poster.jpg" src="/static/video/miscited-explainer.mp4"></video></div>
  <figcaption>The Miscited method in a short explainer. Air Canada appears as a public case, not as a customer.</figcaption>
</figure>

<p>
  If you would rather start from evidence than from a method, the <a href="/#audit">free answer audit</a>
  samples buyer questions about your company, compares the answers with facts read from your own site and
  returns the wrong answers it can evidence, with the pages they cited.
</p>

<h2>Sources</h2>

<ol class="sources">
  <li><a href="https://www.canlii.org/en/bc/bccrt/doc/2024/2024bccrt149/2024bccrt149.html">Moffatt v. Air Canada, 2024 BCCRT 149</a>, 14 February 2024, paras 15 to 17, 27 and 44. Full text on CanLII.</li>
</ol>
`,
};

// ---------------------------------------------------------------------------

// The one market figure is G2's own release, quoted with its sample, month and caveat.
const CHECKING_ANSWERS: Post = {
  slug: 'check-what-ai-says-about-your-company',
  title: 'How to check what ChatGPT, Gemini and Perplexity say about your company',
  metaTitle: 'Check what ChatGPT, Gemini and Perplexity say about you',
  metaDescription:
    'A seven-step method for checking what AI assistants tell buyers about your company: dated facts, real questions, repeated runs and claim-by-claim checks.',
  summary:
    'A seven-step method for checking what ChatGPT, Gemini and Perplexity tell buyers about your company, from a dated list of facts to a claim-by-claim comparison you can repeat.',
  published: '2026-09-27',
  updated: '2026-09-27',
  readingMinutes: 11,
  targetQuery: 'how to check what ChatGPT says about my company',
  tags: ['Measurement', 'Accuracy'],
  faq: [
    {
      q: 'How do I find out what ChatGPT says about my company?',
      a: 'Ask it the questions your buyers ask, several times each and in fresh sessions, and record every answer with its date, setup and cited pages. Then split the answers into single claims and compare each one with a list of your facts that records when each fact became true and, where it applies, when it stopped.',
    },
    {
      q: 'How many times should I ask an assistant the same question?',
      a: 'More often than feels necessary. One wrong answer in two asks reads as 50% with a 95% interval of 9% to 91%, which fits almost any true rate. To state a rate with a margin of roughly ten points, you need about 100 runs per question group. A handful of runs can show that a problem exists, but it cannot size it.',
    },
    {
      q: 'What is the difference between a stale and a contradicted AI answer?',
      a: 'A stale claim matches something that used to be true, such as a retired price or a former owner. A contradicted claim conflicts with your facts and was never true. The fixes differ: a stale claim usually leads back to an old page that still states the expired fact, while a contradicted claim has to be traced before it can be fixed.',
    },
    {
      q: 'How often should I re-check what AI assistants say about my company?',
      a: 'On a fixed schedule, and again after anything that changes your facts: a price change, a launch, a rename or a correction you made. Keep some question groups you deliberately leave alone as controls, so that when an answer moves you can tell whether your fix moved it or a model update did.',
    },
  ],
  body: `
<p class="lede">
  One question to ChatGPT, one reply, one screenshot forwarded to the team. That tells you what a single
  answer said on a single day. It does not tell you what your buyers are reading.
</p>

<p>
  It is worth doing properly because buyers are asking. In a G2 survey of B2B software buyers and
  decision-makers run in March 2026 (n = 1,076), 51% said they now begin software research with an AI
  chatbot more often than with Google, up from 29% in April 2025. In the same survey, 64% said they get
  inaccurate recommendations from AI chatbots often or very often. That is one vendor's survey of one kind
  of buyer, so treat it as a reason to check rather than as a measure of your market.
</p>

<p>
  Here is a method you can run by hand. It has seven steps, and the first two happen before you ask an
  assistant anything.
</p>

<h2>Before you ask anything</h2>

<h3>1. List your facts, with dates</h3>
<p>
  A claim can only be wrong relative to something. Write down the facts a buyer might act on: prices and
  plans, limits, integrations, regions, certifications, ownership and leadership. Give each one the date it
  became true and, if it has stopped being true, the date it stopped. An old price is not a random error.
  It was right until a date, and without that date you cannot tell a stale answer from an invented one.
</p>

<h3>2. Write the questions buyers actually ask</h3>
<p>
  Take them from search console, site search, sales calls, support tickets and lost-deal notes rather than
  from a brainstorm. Group them by intent: questions that name you, questions that compare you with a
  competitor, and category questions where you may or may not appear at all. Keep the groups apart in
  everything that follows. They have different answers and different base rates, and averaging them
  produces a number that describes none of them.
</p>

<h2>Asking the assistants</h2>

<h3>3. Ask each assistant, repeatedly</h3>
<p>
  The same question can get a different answer each time it is asked, so one reply shows you what is
  possible, not what is typical. Ask each question several times on each assistant, in fresh sessions, and
  record the setup with every run: the assistant, the model where it is shown, whether web search was on,
  the country, the language and the date.
</p>
<p>
  Then be honest about what the count supports. One wrong answer in two asks reads as 50%, and the 95%
  interval on that is 9% to 91%. To state a rate with a margin of roughly ten points you need about 100
  runs per question group. By hand, use a few runs to find the claims worth worrying about, then measure
  those properly. The arithmetic is in
  <a href="/blog/how-many-prompts-ai-visibility-sample-size">how many prompts an AI visibility number
  actually needs</a>.
</p>

<h3>4. Split every answer into claims</h3>
<p>
  The unit of work is the claim, not the answer. An answer saying the Pro plan costs $49 a month and
  includes single sign-on holds two claims, and one can be right while the other is wrong. Write each claim
  as a short sentence that is either true or false, and note the question and the run it came from.
</p>

<h3>5. Record the pages each answer cites</h3>
<p>
  When an answer shows sources, record the exact URL next to the claim it is attached to. Then open the
  page and check that it says what the answer says it says. A citation to your own site does not make a
  claim right: the page may be out of date, or it may not contain the claim at all. That second case is its
  own defect with its own fix, covered in
  <a href="/blog/fix-wrong-ai-answers-about-your-company">how to fix a wrong AI answer about your
  company</a>.
</p>

<h2>Scoring what came back</h2>

<h3>6. Compare each claim with your facts</h3>
<p>Put every claim in one of four classes, using the dates from step 1.</p>

<div class="tw"><table>
  <thead><tr><th>Class</th><th>What it means</th><th>Where the fix starts</th></tr></thead>
  <tbody>
    <tr><td class="k good">Correct</td><td>Matches a fact in force on the day of the answer</td><td>No fix. Keep checking it.</td></tr>
    <tr><td class="k bad">Stale</td><td>Matches a fact whose end date has passed</td><td>The pages that still state the old fact</td></tr>
    <tr><td class="k bad">Contradicted</td><td>Conflicts with your facts and never matched any of them</td><td>Tracing the claim to wherever it came from</td></tr>
    <tr><td class="k">Unsupported</td><td>Your list neither confirms nor refutes it</td><td>Deciding whether it is true, then adding the fact</td></tr>
  </tbody>
</table></div>

<p>
  The difference between stale and contradicted is the reason step 1 needs dates. A stale claim was true
  once, so look first for a page that still says it: an old pricing page, a launch post, a directory
  profile nobody updated. A contradicted claim has no such history, so finding its source takes longer. We
  look at where stale answers come from in
  <a href="/blog/why-ai-answers-go-stale">why AI answers about your company go stale</a>.
</p>

<h2>Keeping it true</h2>

<h3>7. Re-check on a schedule</h3>
<p>
  Answers move when models update, when search indexes refresh and when your own facts change. Re-run the
  same questions on the same assistants on a fixed schedule, and again after a price change, a launch or a
  correction. Keep a few question groups you deliberately leave alone. Without them you cannot tell whether
  an answer changed because of your fix or because the model changed the same week.
</p>

<h2>The shortcut</h2>

<p>
  Done by hand, this is slow, careful work. The <a href="/#audit">free answer audit</a> does a first pass
  for you. Submit your domain and you get a dated report: facts read from your own site, sampled answers
  from the assistants the audit is connected to, the pages those answers cited, and the limits of what was
  covered. It may not ask every assistant named above; the report lists the ones it did. The
  site facts are provisional until a person reviews them, and answers collected through an API can differ
  from what the consumer apps show. If the audit finds nothing worth fixing, it says so.
</p>

<h2>Sources</h2>

<ol class="sources">
  <li><a href="https://www.prnewswire.com/news-releases/new-g2-research-half-of-b2b-software-buyers-now-start-their-research-with-ai-chatbots-302742807.html">New G2 Research: Half of B2B Software Buyers Now Start Their Research With AI Chatbots</a>, G2 press release on PR Newswire, 15 April 2026. Online survey of 1,076 B2B software buyers and decision-makers, March 2026.</li>
</ol>
`,
};

// ---------------------------------------------------------------------------

// The Aeroplan example is dated from the two announcements alone and says so. It is an
// illustration of dating a fact, not something we measured.
const STALE_ANSWERS: Post = {
  slug: 'why-ai-answers-go-stale',
  title: 'Why AI answers about your company go stale',
  metaTitle: 'Why AI answers about your company go stale',
  metaDescription:
    'Assistants repeat facts that used to be true. How training cutoffs and live retrieval each produce stale answers, and why a dated fact list comes first.',
  summary:
    'Why assistants keep repeating facts that used to be true, how training memory and live retrieval each produce stale answers, and why the fix starts with a dated list of your own facts.',
  published: '2026-09-27',
  updated: '2026-09-27',
  readingMinutes: 11,
  targetQuery: 'why does ChatGPT have outdated information about my company',
  tags: ['Accuracy', 'Corrections'],
  faq: [
    {
      q: 'Why does ChatGPT have outdated information about my company?',
      a: 'Either the answer came from training memory, which stops at the training cutoff, or the assistant searched the web and read a page that still states the old fact. The first changes only when a later model is trained. The second can change once the old page is corrected and fetched again. Knowing which one you are looking at decides the fix.',
    },
    {
      q: 'What is a training cutoff?',
      a: 'It is the point after which a model saw no new training text. Anything that changed later, such as a new price, owner or product name, the model can only learn by retrieving a page while it answers. Without retrieval, it answers from what was true before the cutoff, which is how a fluent but stale answer is produced.',
    },
    {
      q: 'Is a stale answer the same as a false one?',
      a: 'Not quite. A stale claim was true once and has since been superseded, while a false one was never true. The difference matters because a stale claim points to a findable source: an old page or profile published while the fact was in force. Correcting or retiring that source is where the fix starts.',
    },
    {
      q: 'How do I stop an old fact about my company being repeated?',
      a: 'Record the fact with the date it stopped being true, then find the pages that still state it: your own old pages first, then directories and third-party articles. Correct or retire them, re-ask the same questions and compare the results with questions you left alone, so you know the change came from your fix.',
    },
  ],
  body: `
<p class="lede">
  A stale answer repeats a fact that was true once, after it stopped being true. That makes it harder to
  catch than an invented one, because every part of it checks out against somebody's old page.
</p>

<p>
  Stale answers come from two places, and they need different fixes. Both come down to the same missing
  piece: knowing when each of your facts was true.
</p>

<h2>Two ways an answer gets its facts</h2>

<p>An assistant answering a question about your company draws on one of two things, and often both.</p>

<div class="tw"><table>
  <thead><tr><th></th><th>Training memory</th><th>Live retrieval</th></tr></thead>
  <tbody>
    <tr><td class="k">What it is</td><td>What the model absorbed from text collected before its training cutoff</td><td>Pages the assistant fetches from the web while it answers</td></tr>
    <tr><td class="k">How it goes stale</td><td>The cutoff passes and your facts keep changing</td><td>It finds a page that still states the old fact</td></tr>
    <tr><td class="k">When a fix can show up</td><td>Only in a model trained after the fix, if then</td><td>After the corrected page is fetched again</td></tr>
    <tr><td class="k">A sign to look for</td><td>No sources, or sources that do not contain the claim</td><td>A citation to a page that states the old fact</td></tr>
  </tbody>
</table></div>

<p>
  A training cutoff is the point after which a model saw no new training text. Anything that changed later,
  the model can only learn by retrieving a page while it answers. Retrieval solves that in principle and
  brings it back in practice. An assistant that searches the web can just as easily read a pricing page you
  forgot to retire, a directory profile nobody updated, or a news story from the week of an old
  announcement.
</p>

<p>
  Which mode produced an answer decides which fix can work. We covered that split in
  <a href="/blog/fix-wrong-ai-answers-about-your-company">how to fix a wrong AI answer about your
  company</a>.
</p>

<h2>Superseded is not the same as wrong</h2>

<p>
  A fact list that only records what is true today cannot catch a stale answer, because a stale answer was
  true. What catches it is the date. Every fact about a company has a period when it was in force: a price
  between two dates, an owner until a sale completed, a product name until a rebrand.
</p>

<p>
  That gives you two questions to ask of any claim. Was it ever true? Was it true on the day the answer was
  given? A claim that fails the first is contradicted. A claim that passes the first and fails the second
  is stale, and it points somewhere specific: a source that was accurate when it was written and was never
  updated.
</p>

<p>
  There is a third state worth recording: a change that has been announced and has not yet taken effect.
  An answer that repeats the new fact before its effective date is wrong too, in the other direction.
</p>

<h2>An illustration: who runs Aeroplan?</h2>

<p>
  This is an illustrative example built from two public announcements. It is not a Miscited finding: we
  have not measured what any assistant says about Aeroplan. Air Canada is not a Miscited customer.
</p>

<div class="tw"><table>
  <thead><tr><th>Date</th><th>What happened</th></tr></thead>
  <tbody>
    <tr><td class="num">26 Nov 2018</td><td>An agreement for Air Canada to buy Aimia Canada, the owner and operator of Aeroplan, is announced</td></tr>
    <tr><td class="num">10 Jan 2019</td><td>Aimia completes the sale of Aimia Canada to Air Canada</td></tr>
    <tr><td class="num">11 Aug 2020</td><td>Air Canada announces a redesigned Aeroplan, launching on 8 November 2020, with Aeroplan miles to be known as Aeroplan points</td></tr>
    <tr><td class="num">8 Nov 2020</td><td>The announced launch date of the new programme</td></tr>
  </tbody>
</table></div>

<p>Now take three claims an assistant could make about Aeroplan and check each against those dates.</p>

<div class="tw"><table>
  <thead><tr><th>Claim</th><th>Made</th><th>Verdict</th><th>Why</th></tr></thead>
  <tbody>
    <tr><td>Aeroplan is Aimia's loyalty programme</td><td>After 10 Jan 2019</td><td class="bad">Stale</td><td>True until the sale completed that day</td></tr>
    <tr><td>Aeroplan members collect miles</td><td>After 8 Nov 2020</td><td class="bad">Stale</td><td>Miles were to be known as points from that date</td></tr>
    <tr><td>Aeroplan members collect points</td><td>Sep 2020</td><td class="bad">Early</td><td>The change was announced and not yet in force</td></tr>
  </tbody>
</table></div>

<p>
  The second row assumes the change took effect as announced. Our sources are the announcements, and a real
  fact list would confirm it.
</p>

<p>
  None of these claims was invented. A list of today's facts alone would flag the first two as
  contradictions and send you looking for a fabrication that does not exist. With dates, each one points
  at its likely source: pages written before 10 January 2019 in the first case and before 8 November 2020
  in the second. A model whose training text ends before January 2019 cannot know about the sale unless it
  retrieves a newer page, and one that retrieves an old article can repeat the old owner with a citation
  attached. The third row shows why a fact needs the date it takes effect as well as the date it was
  announced.
</p>

<h2>Why a dated fact list fixes this</h2>

<p>
  Everything above comes down to one habit: record each fact with the date it took effect, the date it
  stopped if it has, and the source that says so. For the example, the list would look like this.
</p>

<div class="tw"><table>
  <thead><tr><th>Fact</th><th>Value</th><th>From</th><th>Until</th><th>Source</th></tr></thead>
  <tbody>
    <tr><td class="k">Company behind Aeroplan</td><td>Aimia</td><td>—</td><td class="num">10 Jan 2019</td><td>Aimia, 10 Jan 2019</td></tr>
    <tr><td class="k">Company behind Aeroplan</td><td>Air Canada</td><td class="num">10 Jan 2019</td><td>open</td><td>Aimia, 10 Jan 2019</td></tr>
    <tr><td class="k">Aeroplan currency</td><td>Miles</td><td>—</td><td class="num">8 Nov 2020</td><td>Air Canada, 11 Aug 2020</td></tr>
    <tr><td class="k">Aeroplan currency</td><td>Points</td><td class="num">8 Nov 2020</td><td>open</td><td>Air Canada, 11 Aug 2020</td></tr>
  </tbody>
</table></div>

<p>
  Open means no end date has been recorded, not that someone confirmed the fact this morning. A working
  list also records when each entry was last checked.
</p>

<p>
  With a list like this, classifying a claim is mechanical. A claim that matches a row in force on the day
  of the answer is correct. One that matches a row whose end date has passed is stale. One that matches a
  row that has not started yet is early. One that matches no row at all needs checking before it can be
  called contradicted or unsupported. The same list tells you where to look for the source of a stale
  answer: pages published while the old row was in force.
</p>

<p>
  The full checking method is in
  <a href="/blog/check-what-ai-says-about-your-company">how to check what ChatGPT, Gemini and Perplexity
  say about your company</a>, and how many runs a stale rate needs before it means anything is in
  <a href="/blog/how-many-prompts-ai-visibility-sample-size">how many prompts an AI visibility number
  actually needs</a>. The <a href="/#audit">free answer audit</a> starts from facts read from your own site
  and flags answers that conflict with them. Those site facts are provisional until a person reviews them,
  which is the moment to add the dates.
</p>

<h2>Sources</h2>

<ol class="sources">
  <li><a href="https://www.aimia.com/aimia-completes-sale-of-aimia-canada-to-air-canada/">Aimia Completes Sale of Aimia Canada to Air Canada</a>, Aimia, 10 January 2019.</li>
  <li><a href="https://www.prnewswire.com/news-releases/air-canada-unveils-details-of-transformed-aeroplan-program-offering-more-value-and-new-benefits-301109775.html">Air Canada Unveils Details of Transformed Aeroplan Program, Offering More Value and New Benefits</a>, Air Canada on PR Newswire, 11 August 2020.</li>
</ol>
`,
};

// ---------------------------------------------------------------------------

// Status of every case is as of the published date. Quotes are from the court documents
// themselves; everything attributed to a law firm or a newspaper is paraphrased.
const LEGAL_CASES: Post = {
  slug: 'ai-false-statements-about-businesses-cases',
  title: 'When AI says something false about a business: what the cases show so far',
  metaTitle: 'AI false statements about businesses: the cases so far',
  metaDescription:
    'Moffatt, Walters v. OpenAI, Wolf River and Keene v. Google: what the cases on false AI answers show so far, and why fixing the record comes first.',
  summary:
    'A plain summary of the public cases on false AI statements, from a company answering for its own chatbot to the suits over Google AI Overviews, and what they mean for a business now.',
  published: '2026-09-27',
  updated: '2026-09-27',
  readingMinutes: 17,
  targetQuery: 'can you sue if AI says something false about your business',
  tags: ['Risk', 'Case studies'],
  faq: [
    {
      q: 'Can you sue if an AI tool says something false about your business?',
      a: 'People have tried, with mixed results. A Georgia court granted summary judgment to OpenAI in Walters v. OpenAI in May 2025, while claims over two Google AI Overviews survived a motion to dismiss in Keene v. Google in September 2026. The law is unsettled and slow. This is not legal advice, so speak to a lawyer about your own facts.',
    },
    {
      q: 'Has a company been held to what its own chatbot said?',
      a: 'In Moffatt v. Air Canada, 2024 BCCRT 149, the airline argued it could not be held liable for information provided by its agents, including a chatbot. The tribunal called that "a remarkable submission" (para 27) and ordered it to pay C$812.02 in total. One decision is not a rule everywhere, and this is not legal advice. Air Canada is not a Miscited customer.',
    },
    {
      q: 'Why did Walters v. OpenAI fail?',
      a: 'The court gave three separate grounds. A reasonable reader in the position of the journalist who saw the output could not have taken it as stating actual facts. There was no evidence of negligence, and Walters, as at least a limited-purpose public figure, needed to show actual malice. Walters also conceded no damages, and punitive damages required a correction request that was never made.',
    },
    {
      q: 'What should a business do about false AI answers while the law settles?',
      a: 'Fix the record you can reach. Find the false claims across repeated asks, trace each one to the page it came from, correct that page or ask its publisher to, and test again. Keep dated records of what the answers said and of every correction you requested, because notice and correction requests came up in Walters, in Keene and in the Munich case.',
    },
  ],
  body: `
<p class="lede">
  When an AI answer says something false about a business, an obvious question is whether anyone can be
  made to answer for it. A handful of public cases now give a partial answer. It is mixed, slow and still
  moving.
</p>

<p>
  This is a summary of public decisions and filings as of 27 September 2026, written for people who run
  companies. It is not legal advice. Air Canada is not a Miscited customer, and neither is any other
  company named here.
</p>

<h2>The cases at a glance</h2>

<div class="tw"><table>
  <thead><tr><th>Case</th><th>What the AI said</th><th>Where it stands</th></tr></thead>
  <tbody>
    <tr><td class="k">Moffatt v. Air Canada<br>British Columbia, decided 2024</td><td>The airline's own chatbot described a bereavement fare option that its linked policy page ruled out</td><td>Air Canada ordered to pay C$812.02 in total</td></tr>
    <tr><td class="k">Walters v. OpenAI<br>Georgia, decided 2025</td><td>ChatGPT told a journalist that radio host Mark Walters had been accused of embezzlement, which was false</td><td>Summary judgment for OpenAI, 19 May 2025</td></tr>
    <tr><td class="k">LTL LED (Wolf River Electric) v. Google<br>Minnesota, filed 2025</td><td>AI Overviews allegedly said the Minnesota Attorney General was suing the company</td><td>Sent back to state court in January 2026; no ruling on the merits that we could find</td></tr>
    <tr><td class="k">Keene v. Google<br>Illinois, filed 2025</td><td>AI Overviews allegedly said author Jimmy Keene was serving a life sentence</td><td>Claims over two AI Overviews survived a motion to dismiss, 14 September 2026</td></tr>
    <tr><td class="k">Two publishers v. Google<br>Munich, 2026</td><td>AI Overviews linked the publishers to scams and dubious business practices</td><td>Preliminary ruling against Google, reported in June 2026; Google suggested it could appeal</td></tr>
  </tbody>
</table></div>

<h2>A company answers for its own chatbot</h2>

<p>
  Moffatt v. Air Canada, 2024 BCCRT 149, is the only case here about a company's own bot. A customer asked
  Air Canada's chatbot about bereavement fares and got an answer that the policy page it linked to
  contradicted. Air Canada argued that it could not be held liable for information provided by its agents,
  including a chatbot. The tribunal called that "a remarkable submission" (para 27) and ordered the airline
  to pay C$812.02 in total (para 44). We went through the decision in
  <a href="/blog/air-canada-chatbot-ruling-ai-answers">what the Air Canada chatbot ruling means for what AI
  says about your company</a>.
</p>

<p>
  The practical reading is the plain one: if the bot is yours, treat its answers as yours. The rest of this
  page is about assistants a business does not run, where the position is much less settled.
</p>

<h2>Walters v. OpenAI: a false answer nobody believed</h2>

<p>
  Mark Walters, a radio host, sued OpenAI after ChatGPT gave a journalist a false summary of a lawsuit
  brought by the Second Amendment Foundation, saying Walters had been accused of embezzling from it. On
  19 May 2025 the Superior Court of Gwinnett County in Georgia granted summary judgment to OpenAI. As
  summarised by Loeb &amp; Loeb and by Cleary Gottlieb, it gave three separate grounds.
</p>

<ol>
  <li><b>No defamatory meaning.</b> A reasonable reader in the journalist's position could not have concluded that the output stated actual facts. ChatGPT had said it could not access the internet and had a knowledge cutoff, OpenAI's terms warned that its output can be inaccurate, and the journalist established within about an hour and a half that the summary was untrue.</li>
  <li><b>No fault.</b> There was no evidence of ordinary negligence, and the court held that Walters was at least a limited-purpose public figure who had to show actual malice, which the evidence did not support.</li>
  <li><b>No damages.</b> Walters conceded that there had been no harm. Punitive damages were not available because nobody had asked OpenAI for a correction or retraction, as Georgia law requires.</li>
</ol>

<p>
  For a business, the reasons matter more than the result. The result rested on unusual facts: one reader,
  who did not believe the output and did not pass it on. The more useful detail is the last one. Punitive
  damages failed because nobody had asked OpenAI to correct the output. Asking for a correction, and keeping
  a record that you asked, comes up again in the cases below.
</p>

<h2>AI Overviews: the claims still open</h2>

<p>Two suits in the United States over Google's AI Overviews are still open.</p>

<h3>Wolf River Electric</h3>

<p>
  LTL LED, LLC, a Minnesota solar installer trading as Wolf River Electric, sued Google in Minnesota state
  court in March 2025, together with four of its executives. The complaint alleges that AI Overviews told
  searchers the Minnesota Attorney General was suing the company over deceptive sales practices, that no
  such lawsuit existed, and that the pages Google cited did not support the statement:
</p>

<figure class="quote">
  <blockquote>
    "Google cited numerous sources in support of its false assertions; however, none of the referenced
    materials in fact contained the information Google claimed they did."
  </blockquote>
  <figcaption>Plaintiffs' Joint Amended Complaint, LTL LED, LLC v. Google LLC, para 139</figcaption>
</figure>

<p>
  The complaint describes a customer ending a contract with a total price of $150,000 because of what Google
  published (paras 175 to 176), and the plaintiffs' initial disclosures estimated damages at about
  $110 million to $210 million. These are allegations and estimates, not findings.
</p>

<p>
  So far the case has turned on procedure. Google moved it to federal court on 9 June 2025. On 9 January
  2026 the federal court held that the move came too late, because a letter served with the complaint in
  March 2025 had already claimed $24.7 million in damages for 2024, and sent the case back to Ramsey County
  District Court. We could not find a ruling on the merits in the public record as of 27 September 2026.
</p>

<h3>Keene v. Google</h3>

<p>
  Author Jimmy Keene alleges that at least four AI Overviews, between about May and June 2025, made false
  statements about Keene, including one that described Keene as serving a life sentence without parole.
  Each cited a Wikipedia page that, according to the complaint, did not contain the statements.
</p>

<p>
  On 14 September 2026, Judge Thomas M. Durkin of the Northern District of Illinois denied Google's motion
  to dismiss the claims over two of those AI Overviews. The court dismissed a third as substantially true
  and a fourth because publication to anyone else was not alleged, both without prejudice. Two points in the
  opinion matter to any business.
</p>

<ul>
  <li><b>A citation does not turn a statement into an opinion.</b> In the court's words: "The mere act of providing a citation to an assertion does not convert that assertion from fact to opinion." (Memorandum Opinion and Order, p. 5.)</li>
  <li><b>Notice matters.</b> Keene alleges three complaints to Google, and Google's own exhibit showed a legal removal request submitted on 25 May 2025. Either someone at Google read it, the court reasoned, which could support knowledge of falsity, or nobody did, which could support reckless disregard. Actual malice was plausibly alleged.</li>
</ul>

<p>
  The court also found Google's reliance on Walters unpersuasive. Asking an AI tool to produce work and
  getting several signs that the output may be false, it reasoned, is different from a basic Google search,
  where an ordinary user is looking for factual information rather than AI work product.
</p>

<h3>Munich</h3>

<p>
  Outside the United States, the Munich Regional Court preliminarily ruled that Google is liable for false
  statements in AI Overviews that linked two publishers to scams and dubious business practices, with an
  order requiring a temporary injunction, according to reports by Ars Technica and WIRED in June 2026.
  Google had not corrected the output even after a cease-and-desist letter, and the court reasoned that only
  Google could correct it. A Google spokesperson suggested the decision could be appealed.
</p>

<h2>What the cases show so far</h2>

<ul>
  <li><b>Your own bot speaks for you.</b> Moffatt is the clearest signal, and it points one way.</li>
  <li><b>For assistants you do not run, the law is unsettled.</b> Walters lost on facts specific to one reader. Keene and the Munich publishers have got further, at early stages. In the United States cases here, no court has yet found an AI company liable.</li>
  <li><b>Notice and correction requests keep coming up.</b> Walters could not seek punitive damages without having asked for a correction. Keene's removal request supported the claim of actual malice. In Munich, the publishers had sent a cease-and-desist letter, and the court stressed that only Google could correct the output.</li>
  <li><b>It is slow.</b> Wolf River was served in March 2025 and, more than 18 months later, has no ruling on the merits that we could find. Keene took more than a year from filing to get past a motion to dismiss.</li>
</ul>

<h2>The practical path</h2>

<p>
  None of this makes a lawsuit a plan. The claims that have survived took more than a year to get past the
  first round, and the buyers who read the false answer made their decisions long before that.
</p>

<p>
  The path you control is shorter: find the false claims, trace each one to the page it came from, correct
  that page or ask its publisher to, and test whether the answer changed. Keep dated records of what the
  answers said and of every correction you asked for. The cases above suggest those records matter if a
  dispute ever does reach a court.
</p>

<p>
  We set out the checking method in
  <a href="/blog/check-what-ai-says-about-your-company">how to check what ChatGPT, Gemini and Perplexity
  say about your company</a> and the fixes in
  <a href="/blog/fix-wrong-ai-answers-about-your-company">how to fix a wrong AI answer about your
  company</a>. Before acting on a single transcript, read
  <a href="/blog/how-many-prompts-ai-visibility-sample-size">how many prompts an AI visibility number
  actually needs</a>. To see whether there is anything to fix, the <a href="/#audit">free answer audit</a>
  is a quick way to start.
</p>

<h2>Sources</h2>

<ol class="sources">
  <li><a href="https://www.canlii.org/en/bc/bccrt/doc/2024/2024bccrt149/2024bccrt149.html">Moffatt v. Air Canada, 2024 BCCRT 149</a>, 14 February 2024, paras 27 and 44.</li>
  <li><a href="https://www.loeb.com/en/insights/publications/2025/05/walters-v-openai-llc">Walters v. OpenAI, L.L.C.</a>, Loeb &amp; Loeb, May 2025.</li>
  <li><a href="https://www.clearyiptechinsights.com/2025/05/georgia-court-dismisses-defamation-lawsuit-against-openai-over-chatgpt-output/">Georgia Court Dismisses Defamation Lawsuit Against OpenAI Over ChatGPT Output</a>, Cleary Gottlieb, 27 May 2025.</li>
  <li><a href="https://storage.courtlistener.com/recap/gov.uscourts.mnd.225722/gov.uscourts.mnd.225722.11.13.pdf">Plaintiffs' Joint Amended Complaint</a>, LTL LED, LLC v. Google LLC, filed in the federal case as Doc. 11-13, No. 25-cv-2394 (D. Minn.).</li>
  <li><a href="https://storage.courtlistener.com/recap/gov.uscourts.mnd.225722/gov.uscourts.mnd.225722.34.0.pdf">Order granting the motion to remand</a>, LTL LED, LLC v. Google LLC, No. 25-cv-2394 (D. Minn.), 9 January 2026. <a href="https://www.courtlistener.com/docket/70504071/ltl-led-llc-v-google-llc/">Federal docket</a>.</li>
  <li><a href="https://reason.com/volokh/2025/06/11/large-libel-models-small-business-sues-google-claiming-ai-overview-in-searches-hallucinated-attorney-general-lawsuit/">Large Libel Models: Small Business Sues Google, Claiming AI Overview in Searches Hallucinated Attorney General Lawsuit</a>, Eugene Volokh, The Volokh Conspiracy, 11 June 2025.</li>
  <li><a href="https://reason.com/volokh/2026/01/12/google-missed-key-deadline-in-suit-alleging-googles-ai-libeled-business-court-holds/">Google Missed Key Deadline in Suit Alleging Google's AI Libeled Business, Court Holds</a>, Eugene Volokh, The Volokh Conspiracy, 12 January 2026.</li>
  <li><a href="https://storage.courtlistener.com/recap/gov.uscourts.ilnd.486629/gov.uscourts.ilnd.486629.29.0.pdf">Memorandum Opinion and Order</a>, Keene v. Google LLC, No. 1:25-cv-11431 (N.D. Ill.), 14 September 2026. <a href="https://www.courtlistener.com/docket/71417738/keene-v-google-llc/">Federal docket</a>.</li>
  <li><a href="https://www.law.com/2026/09/14/defamation-claims-cleared-to-proceed-against-googles-ai-overviews-federal-judge-rules-/">Defamation Claims Cleared to Proceed Against Google's AI Overviews, Federal Judge Rules</a>, Law.com, 14 September 2026.</li>
  <li><a href="https://arstechnica.com/tech-policy/2026/06/nobody-needs-ai-to-search-the-internet-court-says-in-ruling-against-google/">Nobody needs AI to search the Internet, court says in ruling against Google</a>, Ashley Belanger, Ars Technica, 10 June 2026.</li>
  <li><a href="https://www.wired.com/story/a-court-has-ruled-that-google-is-liable-for-false-statements-generated-by-ai-overviews/">A Court Has Ruled That Google Is Liable for False Statements Generated by AI Overviews</a>, WIRED, 13 June 2026.</li>
</ol>
`,
};

// ---------------------------------------------------------------------------

/** Same-day posts keep this order everywhere, so it doubles as the editorial order for a day. */
export const POSTS: Post[] = [
  AIR_CANADA_RULING,
  CHECKING_ANSWERS,
  STALE_ANSWERS,
  LEGAL_CASES,
  SAMPLE_SIZE,
  WRONG_ANSWERS,
  VISIBILITY_VS_ACCURACY,
];

export function postBySlug(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

const rank = (post: Pick<Post, 'slug'>): number => {
  const index = POSTS.findIndex((p) => p.slug === post.slug);
  return index === -1 ? POSTS.length : index;
};

/** Newest first, with same-day posts in POSTS order, so the index, the sitemap and the previous/next links agree. */
export function compareNewestFirst(a: Pick<Post, 'slug' | 'published'>, b: Pick<Post, 'slug' | 'published'>): number {
  if (a.published !== b.published) return a.published < b.published ? 1 : -1;
  return rank(a) - rank(b);
}

/** Newest first, which is also the order the index and the sitemap use. */
export function postsNewestFirst(): Post[] {
  return [...POSTS].sort(compareNewestFirst);
}
