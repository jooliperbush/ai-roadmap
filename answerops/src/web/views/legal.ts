/**
 * The privacy policy and the terms.
 *
 * Every statement here describes what the code does today: what the audit form stores, which
 * cookies exist, what leaves for which provider. When a data practice changes, this page changes
 * in the same commit. Operator details come from src/content/operator.ts; an undeclared field is
 * left out, never printed as a gap.
 */
import { html, type Raw } from '../html.js';
import { LEGAL_UPDATED, OPERATOR, type Operator } from '../../content/operator.js';
import { SNAPSHOT_RETENTION_DAYS } from '../../domain/fetcher.js';
import { siteFooter, siteHeader } from './landing.js';

const updated = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${LEGAL_UPDATED}T00:00:00Z`));

function section(id: string, title: string, body: Raw): Raw {
  return html`<section id="${id}"><h2>${title}</h2>${body}</section>`;
}
function mail(operator: Operator): Raw {
  return html`<a href="mailto:${operator.email}">${operator.email}</a>`;
}
function identity(operator: Operator): Raw {
  const lines: Array<[string, string | null]> = [
    ['Operator', operator.legalName],
    ['Company number', operator.companyNumber],
    ['Address', operator.address],
  ];
  return html`<dl class="legal-contact">${lines.map(([label, value]) => (value ? html`<dt>${label}</dt><dd>${value}</dd>` : null))}<dt>Email</dt><dd>${mail(operator)}</dd></dl>`;
}
function contact(operator: Operator, topic: string): Raw {
  return html`<p>Email ${mail(operator)} with any question or request about ${topic}${operator.address ? html`, or write to us at ${operator.address}` : null}.</p>`;
}
function legalPage(title: string, lede: string, sections: Array<Raw | null>): Raw {
  return html`
    <a class="skip" href="#main">Skip to content</a>
    ${siteHeader('/')}
    <main id="main" class="shell legal">
      <header class="legal-head"><p class="label">Legal</p><h1>${title}</h1><p class="legal-updated">Last updated: ${updated}</p><p class="lede">${lede}</p></header>
      ${sections}
    </main>
    ${siteFooter('/')}
  `;
}

export function privacyView(operator: Operator = OPERATOR): Raw {
  return legalPage(
    'Privacy Policy',
    'What personal data Miscited collects, why, who else handles it, and how to ask for a copy or deletion. It describes the service as it works today.',
    [
      section(
        'who-we-are',
        'Who we are',
        html`<p>Miscited checks what AI assistants say about companies. “Miscited”, “we” and “us” mean the operator of miscited.com. We decide how your personal data is used, which makes us its “controller” under data protection law.</p>${identity(operator)}`,
      ),
      section(
        'what-we-collect',
        'What we collect',
        html`<ul><li><strong>When you request an audit:</strong> your work email address, the domain you want audited and the time of the request. If you followed a link tagged with one of a few channels, such as LinkedIn or our newsletter, we record that channel name too.</li><li><strong>The audit:</strong> a report and a provisional workspace for the domain. They hold the public pages we read, the facts we proposed from them, the questions we asked AI assistants, the answers and citations we received, and copies of the pages those answers cited.</li><li><strong>If you have an account:</strong> your email address, a salted hash of your password (never the password itself), your role, your weekly email preference, and a log of account actions, such as sign-ins and approvals, recording who took them and when.</li><li><strong>What you add:</strong> facts, questions, notes and settings in your workspace, including any email, Slack or webhook addresses you add for alerts.</li><li><strong>Site visits:</strong> daily counts of page views and two interactions (opening the worked example and clicking the main button), grouped by the channel you arrived from. These counts contain no visitor ID, cookie, IP address, browser details or page address, and your browser does not send them if Do Not Track is on.</li></ul><p>We do not store IP addresses or browser details (user agents) in our database. To stop abuse, the server counts recent requests per IP address in memory; the count is never written to disk and is cleared when the server restarts. Our hosting provider, Railway, handles IP addresses to deliver the site.</p>`,
      ),
      section(
        'cookies',
        'Cookies',
        html`<p>Our public pages set no cookies. Signed-in pages use two cookies that the service needs to work:</p><ul><li><code>aops</code> keeps you signed in. It holds a random session ID. The session ends when you sign out or after 24 hours.</li><li><code>brand</code> remembers which brand you are working on, if your account covers more than one.</li></ul><p>Both are HttpOnly, so page scripts cannot read them, and SameSite=Lax. We use no analytics, advertising or third-party cookies.</p>`,
      ),
      section(
        'how-we-use-it',
        'How we use your data',
        html`<ul><li>To run the audit you asked for and show you the report.</li><li>To reply to you and contact you about your audit or account.</li><li>To run the monitoring, weekly briefings and alerts you switch on.</li><li>To keep the service secure and prevent abuse.</li><li>To see, in total, which channels bring visitors to the site.</li></ul><p>We do not sell your personal data or use it for advertising.</p><p>Where UK or EU data protection law applies, we rely on two legal bases: performing our contract with you, or taking the steps you ask for before one, such as running your audit; and our legitimate interests in running a secure service and understanding, in total, how people find it. You can object to any use based on legitimate interests.</p>`,
      ),
      section(
        'pages-we-read',
        'Pages we read',
        html`<p>To audit a domain, we fetch up to 12 of its public pages, such as the home, pricing and about pages. We also fetch the pages that AI answers cite, and keep copies as evidence. Our crawler identifies itself as Miscited and follows robots.txt, so a site can block it with a <code>User-agent: Miscited</code> rule. It reads public pages only and refuses private network addresses.</p><p>These pages can include personal data, such as names on a team page. We use them only as evidence for the audit and any monitoring that follows.</p>`,
      ),
      section(
        'reports',
        'Who can open a report',
        html`<p>Each report has its own long, random link. Anyone with the link can open the report, so share it only with people you trust. Report pages tell search engines not to index them.</p>`,
      ),
      section(
        'who-else',
        'Who else handles your data',
        html`<p>We use a few providers to run the service. They handle data on our behalf and only for that purpose.</p><ul><li><strong>Railway</strong> hosts the application and the database that holds everything described above.</li><li><strong>OpenAI</strong> answers the questions we ask about your company. We send only the question text, never your email address or account details.</li><li><strong>Anthropic, Google and Perplexity</strong> are supported in the same way but are not switched on. We will update this policy before we use them.</li><li><strong>TypeSafe</strong> (api.typesafe.ai) is used for model checking, which is on only when we have configured a TypeSafe API key. When model checking is on, we send TypeSafe the text of the AI answer being checked, your brand and competitor names, and the facts from your truth registry that it is checked against.</li><li><strong>Resend</strong> delivers any email the service sends you, such as a weekly briefing you have switched on.</li><li><strong>Slack and webhook addresses you add</strong> receive the alerts you set up.</li><li><strong>GitHub, Webflow or WordPress</strong>, if you ask us to connect one, receive draft changes for your review, using the access token you give us. Nothing is published automatically.</li></ul><p>If you choose to contribute to the AI Brand Accuracy Index, only these fields from your results are pooled with other workspaces: provider, model version, claim type, verdict, industry category and quarter. No brand name, question or answer text is included, no published figure draws on fewer than five workspaces, and you can stop contributing at any time.</p><p>We may also disclose data when the law requires it, to protect our rights or someone’s safety, or to a buyer if the business is sold, in which case this policy continues to apply.</p>`,
      ),
      section(
        'transfers',
        'International transfers',
        html`<p>Railway, OpenAI and Resend are based in the United States, so your data may be processed there. Where UK or EU law applies, we rely on the safeguards in their data processing terms, such as standard contractual clauses.</p>`,
      ),
      section(
        'retention',
        'How long we keep it',
        html`<p>We keep audit requests, reports, workspaces and account data until you ask us to delete them; we do not yet delete them automatically. Copies of the pages AI answers cite are kept for as long as a checked citation or a confirmed experiment relies on them as evidence; a copy nothing relies on is deleted once it is more than ${SNAPSHOT_RETENTION_DAYS} days old. Sign-in sessions end after 24 hours. Rate-limit counts exist only in memory, and visit counts are daily totals that identify no one.</p>`,
      ),
      section(
        'your-rights',
        'Your rights',
        html`<p>Depending on where you live, you can ask us to:</p><ul><li>give you a copy of the personal data we hold about you;</li><li>correct it;</li><li>delete it;</li><li>restrict how we use it, or object to our using it;</li><li>send it to you or to another service in a portable format.</li></ul><p>Email ${mail(operator)} from the address you used with us, or tell us how we can confirm it is you. We will reply within one month. You can also complain to the data protection authority where you live or work.</p>`,
      ),
      section(
        'security',
        'Security',
        html`<p>We serve the site over HTTPS, store passwords only as salted scrypt hashes, keep session cookies out of reach of page scripts, check a token on every signed-in form, rate-limit sign-in attempts and audit requests, and give reports links that cannot be guessed. No system is perfectly secure. If a breach affects your data, we will tell you as the law requires.</p>`,
      ),
      section(
        'children',
        'Children',
        html`<p>Miscited is a service for businesses. It is not meant for anyone under 18, and we do not knowingly collect children’s personal data.</p>`,
      ),
      section(
        'changes',
        'Changes to this policy',
        html`<p>When we change this policy, we update the date at the top. If a change significantly affects how we use your data, we will tell account holders before it takes effect.</p>`,
      ),
      section('contact', 'Contact', contact(operator, 'your data')),
    ],
  );
}

export function termsView(operator: Operator = OPERATOR): Raw {
  return legalPage(
    'Terms of Service',
    'The rules for using Miscited. By requesting an audit, creating an account or otherwise using the service, you agree to them.',
    [
      section(
        'who-we-are',
        'Who we are',
        html`<p>“Miscited”, “we” and “us” mean the operator of miscited.com. “You” means the person using the service and, if you use it for an organisation, that organisation. Miscited is for business use. If you accept these terms for an organisation, you confirm you are authorised to bind it.</p>${identity(operator)}`,
      ),
      section(
        'the-service',
        'The service',
        html`<p>Miscited checks what AI assistants say about a company. It reads public pages on a domain, proposes facts from them, asks AI models questions about the company, and compares their answers and citations with those facts. It produces reports and, for accounts, ongoing monitoring, alerts and suggested corrections.</p>`,
      ),
      section(
        'early-access',
        'Early access',
        html`<p>Miscited is in early access. Features may change or be withdrawn, and the service may sometimes be unavailable. When no AI provider is connected, audits run against a labelled stand-in and the report says so.</p>`,
      ),
      section(
        'accuracy',
        'AI answers and our checks can be wrong',
        html`<p>AI models write their own answers, and those answers change over time. Our checks are automated and can also be wrong: they can miss an error, flag a correct answer, misread a page or rely on a fact that has gone out of date. Results are samples, not a complete record of what any assistant says.</p><p>Treat what Miscited produces as a starting point for your own review. Verify findings, proposed facts and suggested corrections before you act on them or publish anything. Nobody controls what an external model says, and we do not promise that a correction will change an answer.</p>`,
      ),
      section(
        'acceptable-use',
        'Acceptable use',
        html`<p>Only request audits of, and monitor, brands and domains you represent or are authorised to assess. Do not:</p><ul><li>give a false email address or pretend to be someone else;</li><li>scrape the service, or collect its content or results in bulk by automated means;</li><li>overload the service, send repeated or automated requests, or try to get around rate limits or other restrictions;</li><li>probe, scan or test the security of the service without our written permission;</li><li>try to reach another customer’s data, or a report you were not given;</li><li>add personal data about other people unless you are allowed to share it with us;</li><li>use Miscited for anything unlawful, misleading or harmful.</li></ul><p>We may refuse or stop an audit, or suspend access, if we believe these rules have been broken.</p>`,
      ),
      section(
        'your-content',
        'Your content',
        html`<p>You keep your rights in the information you give us, such as facts, questions and settings, and you allow us to store and use it to provide the service to you. Pages we read from public websites stay their owners’ property; we keep copies as evidence for your reports.</p>`,
      ),
      section(
        'reports',
        'Reports',
        html`<p>Anyone with a report’s link can open it, so share links with care. You may use the reports we produce for you in your own business, including with your team, clients and advisers.</p>`,
      ),
      section(
        'fees',
        'Fees',
        html`<p>Miscited is currently free, including the one-time Answer Risk Audit. If we offer a paid plan, such as ongoing monitoring or a pilot, its price and terms will be agreed with you in writing before you are charged.</p>`,
      ),
      section(
        'intellectual-property',
        'Our intellectual property',
        html`<p>We own the Miscited service, including its software, design and name. These terms give you the right to use the service as described here and nothing more. If you send us feedback or ideas, we may use them freely.</p>`,
      ),
      section(
        'other-services',
        'Other services',
        html`<p>The service depends on others, including AI model providers and our hosting provider. We are not responsible for their outages or changes, for what their models say, or for third-party websites that answers link to.</p>`,
      ),
      section(
        'no-warranty',
        'No warranty',
        html`<p>The service is provided “as is” and “as available”. As far as the law allows, we give no warranties or conditions of any kind, express or implied, including about accuracy, completeness, fitness for a particular purpose or availability.</p>`,
      ),
      section(
        'liability',
        'Limits on our liability',
        html`<p>Nothing in these terms limits liability that the law does not allow us to limit, such as liability for death or personal injury caused by negligence, or for fraud.</p><p>Subject to that, we are not liable for indirect or consequential loss, or for loss of profit, revenue, business, goodwill or data. Our total liability for all claims connected with the service is limited to the greater of the fees you paid us in the 12 months before the claim and US$100.</p>`,
      ),
      section(
        'ending',
        'Suspension and ending',
        html`<p>You can stop using Miscited at any time and ask us to delete your data, as our <a href="/privacy">Privacy Policy</a> explains. We may suspend or end your access if you break these terms, if we must for legal or security reasons, or if we stop offering the service. Where we reasonably can, we will tell you first. Terms that by their nature should continue after access ends, including the limits on liability, still apply.</p>`,
      ),
      section(
        'changes',
        'Changes to these terms',
        html`<p>We may update these terms. We will change the date at the top and tell account holders about significant changes before they take effect. If you keep using the service after that, the updated terms apply.</p>`,
      ),
      operator.jurisdiction
        ? section(
            'governing-law',
            'Governing law',
            html`<p>These terms are governed by the law of ${operator.jurisdiction}, and the courts of ${operator.jurisdiction} will deal with any dispute about them.</p>`,
          )
        : null,
      section(
        'general',
        'General',
        html`<p>If a court finds part of these terms unenforceable, the rest still applies. If we delay enforcing a term, we can still enforce it later. These terms, our Privacy Policy and any written agreement for a paid plan are the whole agreement between us about the service; where a written agreement conflicts with these terms, the written agreement wins.</p>`,
      ),
      section('contact', 'Contact', contact(operator, 'these terms')),
    ],
  );
}
