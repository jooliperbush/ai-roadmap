import { html, Raw, raw } from '../html.js';

export interface NavContext {
  email: string | null;
  tenantName: string | null;
  brandName: string | null;
  active: string;
}

const NAV = [
  { href: '/', label: 'Answer desk', key: 'dashboard' },
  { href: '/clusters', label: 'Demand', key: 'clusters' },
  { href: '/truth', label: 'Truth registry', key: 'truth' },
  { href: '/observatory', label: 'Observatory', key: 'observatory' },
  { href: '/actions', label: 'Actions', key: 'actions' },
  { href: '/experiments', label: 'Experiments', key: 'experiments' },
  { href: '/crawlers', label: 'Crawlers', key: 'crawlers' },
  { href: '/entities', label: 'Entities', key: 'entities' },
  { href: '/methodology', label: 'Methodology', key: 'methodology' },
  { href: '/audit', label: 'Audit', key: 'audit' },
];

export function page(title: string, ctx: NavContext, body: Raw): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · AnswerOps</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
${ctx.email ? renderShell(ctx, body).value : body.value}
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

function renderShell(ctx: NavContext, body: Raw): Raw {
  return html`
<header class="topbar">
  <a class="brandmark" href="/">
    <span class="mark">◧</span>
    <span class="wordmark">AnswerOps</span>
  </a>
  <div class="promise">Find the AI answers costing you trust or customers. Correct them. Prove the correction worked.</div>
  <div class="whoami" data-testid="whoami">
    <span class="tenant">${ctx.tenantName}</span>
    <span class="sep">·</span>
    <span class="email">${ctx.email}</span>
    <form method="post" action="/logout"><button class="linkbtn" data-testid="logout">Sign out</button></form>
  </div>
</header>
<nav class="mainnav">
  ${NAV.map(
    (n) => html`<a href="${n.href}" class="${n.key === ctx.active ? 'navlink active' : 'navlink'}" data-testid="nav-${n.key}">${n.label}</a>`,
  )}
</nav>
<main>${body}</main>
<footer class="footer">
  <span>Measured, not controlled. Nobody controls what an external model says — we measure it, correct the record, and prove whether it moved.</span>
  <a href="/methodology">Sampling methodology &amp; limitations</a>
</footer>`;
}

export function flash(message: string | null, kind: 'ok' | 'error' = 'ok'): Raw {
  if (!message) return raw('');
  return html`<div class="flash ${kind}" data-testid="flash-${kind}">${message}</div>`;
}
