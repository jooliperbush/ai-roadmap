export const PUBLIC_DESCRIPTION =
  'Find the wrong answers AI assistants give about your company, correct the pages they came ' +
  'from, and prove the answers changed. Every rate carries its n.';

/**
 * The questions a buyer actually types, answered in the 40 to 60 words an answer engine will
 * lift. These are the same answers a salesperson would give; a FAQ written for extraction and
 * a FAQ written for a human diverge only when one of them is dishonest.
 */
export const HOME_FAQ = [
  {
    q: 'What does Miscited do?',
    a: 'Miscited measures whether AI assistants state true things about your company. It checks every claim in an answer against a dated registry of your own facts, checks whether each citation actually supports the claim attached to it, helps you correct the source pages, then re-samples to test whether the answers changed.',
  },
  {
    q: 'How is Miscited different from AI visibility tools?',
    a: 'Visibility tools count mentions, sentiment and share of voice. Miscited checks whether the claim is true. An answer that names you, sounds positive, cites your own pricing page and quotes a price you retired two years ago scores as a success for a visibility tool and as a defect here.',
  },
  {
    q: 'Can you control what ChatGPT says about my company?',
    a: 'No, and neither can anyone else outside a frontier lab. What is possible is to measure what the assistants say, correct the sources they read, and run a controlled test of whether the answers moved. Miscited refuses to claim otherwise, and a failing test enforces that in the codebase.',
  },
  {
    q: 'Which AI assistants does Miscited check?',
    a: 'OpenAI, Anthropic, Google and Perplexity. Every run records the provider, model, model version, access mode, grounding mode, country, language and system configuration, because those change the answer and a result without them cannot be reproduced.',
  },
  {
    q: 'How much does Miscited cost?',
    a: 'The Answer Risk Audit is free and one-time. Monitor is $750 a month for 50 question clusters sampled weekly. Operate is $2,000 a month for 100 clusters sampled daily, with the fact registry, action list and experiment ledger. Enterprise starts at $5,000 a month for multiple brands.',
  },
  {
    q: 'How many prompts do you need to measure AI answers accurately?',
    a: 'More than most tools use. A rate needs at least five runs per question cluster before Miscited will show it at all, and detecting a ten-point change at a 40% base rate takes roughly 388 runs per side at 80% power. Any percentage without its sample size cannot be checked.',
  },
];
