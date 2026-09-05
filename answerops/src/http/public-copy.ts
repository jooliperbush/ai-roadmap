export const PUBLIC_DESCRIPTION =
  'Find outdated prices and unsupported claims in AI answers about your company. Inspect the evidence, correct sources and test what changes with Miscited.';

/** Shared by the visible homepage FAQ and its structured data. */
export const HOME_FAQ = [
  {
    q: 'What does Miscited do?',
    a: 'Miscited checks extracted claims in sampled AI answers against dated facts about your company. It keeps transcripts and citation evidence, helps you track a source correction, and supports follow-up experiments to test whether answers changed.',
  },
  {
    q: 'How is this different from AI visibility?',
    a: 'Visibility asks where your brand appears. Miscited focuses on whether factual claims about it are supported and current. Other platforms also offer optimization workflows; our focus is the connection between a dated fact, an answer, its evidence and a measured correction.',
  },
  {
    q: 'Can you make an assistant change its answer?',
    a: 'No. You can correct sources you control and measure subsequent answers, but external models may not change. Model updates, search results and sampling variation can also affect the result. An inconclusive experiment is a valid outcome.',
  },
  {
    q: 'Which AI assistants can I check?',
    a: 'The project includes adapters for OpenAI, Anthropic, Google and Perplexity. Actual coverage depends on configured API keys and model availability. API responses may differ from consumer applications. When no provider keys are configured, the audit uses clearly labelled simulated results.',
  },
  {
    q: 'What happens when I submit my domain?',
    a: 'The audit starts automatically and a report link appears on this page. It reads your public site and uses provisional site-derived facts for comparison. Those facts need human review; running an audit does not make them independently verified truth. Your email, domain and report are stored to operate the audit.',
  },
  {
    q: 'How much does it cost?',
    a: 'The one-time Answer Risk Audit is free. Ongoing monitoring and correction pilots are scoped individually during early access. Agree the usage, responsibilities and price before a paid engagement; there is no subscription checkout on this page.',
  },
];
