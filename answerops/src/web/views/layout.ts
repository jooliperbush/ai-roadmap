import { html, Raw, raw, escapeHtml } from '../html.js';
import { canonical, SITE_NAME } from '../seo.js';

export interface NavContext {
  email: string | null;
  tenantName: string | null;
  brandName: string | null;
  active: string;
  csrf: string;
  brands: Array<{ id: string; name: string }>;
  brandId: string | null;
  role: string | null;
}

const NAV = [
  { href: '/', label: 'Answer desk', key: 'dashboard' },
  { href: '/alerts', label: 'Alerts', key: 'alerts' },
  { href: '/clusters', label: 'Demand', key: 'clusters' },
  { href: '/truth', label: 'Truth registry', key: 'truth' },
  { href: '/observatory', label: 'Observatory', key: 'observatory' },
  { href: '/schedules', label: 'Schedules', key: 'schedules' },
  { href: '/actions', label: 'Actions', key: 'actions' },
  { href: '/experiments', label: 'Experiments', key: 'experiments' },
  { href: '/crawlers', label: 'Crawlers', key: 'crawlers' },
  { href: '/entities', label: 'Entities', key: 'entities' },
  { href: '/portfolio', label: 'Portfolio', key: 'portfolio' },
  { href: '/methodology', label: 'Methodology', key: 'methodology' },
  { href: '/audit', label: 'Audit', key: 'audit' },
];

/**
 * Every state-changing form gets the session's CSRF token, injected here rather than typed
 * into forty templates. A token a developer can forget to add is a token that will be
 * forgotten, and this app spends money from form posts.
 */
export function injectCsrf(html: string, token: string): string {
  if (!token) return html;
  return html.replace(
    /<form\b([^>]*\bmethod=["']?post["']?[^>]*)>/gi,
    (match, attrs) => `<form${attrs}><input type="hidden" name="_csrf" value="${token}">`,
  );
}

export function page(title: string, ctx: NavContext, body: Raw): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Miscited</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
${injectCsrf(ctx.email ? renderShell(ctx, body).value : body.value, ctx.csrf)}
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

function renderShell(ctx: NavContext, body: Raw): Raw {
  return html`
<header class="topbar">
  <a class="brandmark" href="/">
    <span class="mark">◧</span>
    <span class="wordmark">Miscited</span>
  </a>
  <div class="promise">Find the AI answers costing you trust or customers. Correct them. Prove the correction worked.</div>
  <div class="whoami" data-testid="whoami">
    <span class="tenant">${ctx.tenantName}</span>
    ${ctx.brands.length > 1
      ? html`<form method="post" action="/brands/switch" class="brandswitch">
          <select name="brand_id" data-testid="brand-switcher" onchange="this.form.submit()">
            ${ctx.brands.map((b) => html`<option value="${b.id}" ${b.id === ctx.brandId ? raw('selected') : ''}>${b.name}</option>`)}
          </select>
        </form>`
      : html`<span class="sep">·</span><span class="brandname" data-testid="brand-name">${ctx.brandName}</span>`}
    <span class="sep">·</span>
    <span class="email">${ctx.email}</span>
    ${ctx.role ? html`<span class="rolechip" data-testid="role">${ctx.role}</span>` : ''}
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
  <span>Measured, not controlled. Nobody controls what an external model says. We measure it, correct the record, and prove whether it moved.</span>
  <a href="/methodology">Sampling methodology &amp; limitations</a>
</footer>`;
}

export function flash(message: string | null, kind: 'ok' | 'error' = 'ok'): Raw {
  if (!message) return raw('');
  return html`<div class="flash ${kind}" data-testid="flash-${kind}">${message}</div>`;
}

/**
 * The public audit report.
 *
 * A stranger with no session reads this, so it cannot use the console shell, and it should not
 * borrow the landing page's stylesheet either: that page is a sales argument with layout rules
 * built for a sales argument. A report is a document and gets a document's clothes.
 */
export function reportPage(title: string, description: string, body: Raw): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/report.css">
</head>
<body>
<div class="report-wrap">
  <div class="report-mark">Miscited &middot; answer risk audit</div>
  ${body.value}
  <footer class="report-foot">
    Measured, not controlled. Nobody controls what an external model says. We measure it, correct the record,
    and prove whether it moved. &nbsp;·&nbsp; <a href="/">miscited</a>
  </footer>
</div>
</body>
</html>`;
}

/**
 * The public page renders outside the console shell: no app nav, no console stylesheet.
 * The two design systems stay separate on purpose — the marketing page is a document,
 * the console is an instrument, and neither should inherit the other's cascade.
 */
export interface HeadMeta {
  title: string;
  description: string;
  /** Path only. The canonical host lives in seo.ts so it cannot drift between pages. */
  path: string;
  /** Extra <head> content: JSON-LD blocks, article meta. */
  extra?: Raw[];
  /** Stylesheet to load, defaulting to the marketing one. */
  stylesheet?: string;
  /** Deferred script, if the page needs one. */
  script?: string | null;
  bodyClass?: string;
}

/**
 * The public shell.
 *
 * Everything a machine reads about this page before it reads the page. Canonical first, because
 * without it every query string and every trailing slash is a separate URL competing with itself.
 * The description is trimmed rather than truncated by the renderer, since a description cut
 * mid-clause reads as neglect in exactly the place a stranger forms an impression.
 */
export function publicPage(meta: HeadMeta, body: Raw): string {
  const url = canonical(meta.path);
  const desc = escapeHtml(meta.description);
  const title = escapeHtml(meta.title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta name="color-scheme" content="light">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${meta.stylesheet ?? '/static/landing.css'}">
${(meta.extra ?? []).map((e) => e.value).join('\n')}
</head>
<body${meta.bodyClass ? ` class="${meta.bodyClass}"` : ''}>
${body.value}
${meta.script === null ? '' : `<script src="${meta.script ?? '/static/landing.js'}" defer></script>`}
</body>
</html>`;
}

/** Kept for the landing page's existing call sites. */
export function marketingPage(title: string, description: string, body: Raw, extra: Raw[] = []): string {
  return publicPage({ title, description, path: '/', extra }, body);
}
