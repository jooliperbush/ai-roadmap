import { html, Raw, raw, escapeHtml } from "../html.js";
import { canonical, SITE_NAME } from "../seo.js";

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
export interface HeadMeta {
  title: string;
  description: string;
  path: string;
  extra?: Raw[];
  stylesheet?: string;
  script?: string | null;
  bodyClass?: string;
}
const NAV: Array<[string, string, string]> = [
  ["dashboard", "/", "Answer desk"],
  ["weekly", "/weekly", "Weekly briefing"],
  ["alerts", "/alerts", "Alerts"],
  ["clusters", "/clusters", "Demand"],
  ["truth", "/truth", "Truth registry"],
  ["observatory", "/observatory", "Observatory"],
  ["schedules", "/schedules", "Schedules"],
  ["actions", "/actions", "Actions"],
  ["experiments", "/experiments", "Experiments"],
  ["crawlers", "/crawlers", "Crawlers"],
  ["entities", "/entities", "Entities"],
  ["portfolio", "/portfolio", "Portfolio"],
  ["methodology", "/methodology", "Methodology"],
  ["audit", "/audit", "Audit"],
];
const POSITION =
  "Measured, not controlled. Nobody controls what an external model says. We measure it, correct the record, and prove whether it moved.";
const PROMISE =
  "Find the AI answers costing you trust or customers. Correct them. Prove the correction worked.";

/** CSRF insertion stays at the document boundary so individual forms cannot omit it. */
export function injectCsrf(markup: string, token: string): string {
  if (!token) return markup;
  return markup.replace(/<form\b[^>]*>/gi, (opening) => {
    if (!/\bmethod\s*=\s*(?:"post"|'post'|post(?=\s|>))/i.test(opening))
      return opening;
    return `${opening}<input type="hidden" name="_csrf" value="${escapeHtml(token)}">`;
  });
}
function document(
  title: string,
  head: Raw,
  body: Raw,
  stylesheet: string,
  script: string | null,
  bodyClass = "",
): string {
  return html`<!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8"> <meta name="viewport" content="width=device-width, initial-scale=1"> <title>${title}</title> ${head} <link rel="stylesheet" href="${stylesheet}"> </head> <body class="${bodyClass}"> ${body}${script ? html`<script src="${script}" defer></script>` : null} </body> </html>`
    .value;
}
function identity(ctx: NavContext): Raw {
  return html`<div class="whoami" data-testid="whoami"> <span class="tenant">${ctx.tenantName}</span> ${
    ctx.brands.length > 1
      ? html`<form method="post" action="/brands/switch" class="brandswitch"> <label class="sr-only" for="active-brand">Active brand</label ><select id="active-brand" name="brand_id" data-testid="brand-switcher" onchange="this.form.submit()" > ${ctx.brands.map(
          (b) =>
            html`<option value="${b.id}" ${b.id === ctx.brandId ? raw("selected") : ""} > ${b.name} </option>`,
        )}</select ><noscript><button type="submit">Switch brand</button></noscript> </form>`
      : html`<span class="brandname" data-testid="brand-name" >${ctx.brandName}</span >`
  } <span class="email">${ctx.email}</span>${
    ctx.role
      ? html`<span class="rolechip" data-testid="role">${ctx.role}</span>`
      : null
  } <form method="post" action="/logout"> <button class="linkbtn" data-testid="logout">Sign out</button> </form> </div>`;
}
export function page(title: string, ctx: NavContext, body: Raw): string {
  const shell = ctx.email
    ? html`<a class="skip-link" href="#main-content">Skip to content</a> <header class="topbar"> <a class="brandmark" href="/" ><img class="brand-logo" src="/static/miscited-logo-rust.png" alt="" width="38" height="26"><span class="wordmark">Miscited</span></a > <div class="promise">${PROMISE}</div> ${identity(ctx)} </header> <nav class="mainnav" aria-label="Workspace"> ${NAV.map(
        ([key, href, label]) =>
          html`<a href="${href}" class="navlink ${key === ctx.active ? "active" : ""}" data-testid="nav-${key}" ${key === ctx.active ? raw('aria-current="page"') : ""} >${label}</a >`,
      )} </nav> <main id="main-content">${body}</main> <footer class="footer"> <span>${POSITION}</span ><a href="/methodology">Sampling methodology &amp; limitations</a> </footer>`
    : html`<main id="main-content">${body}</main>`;
  return document(
    `${title} · Miscited`,
    raw(""),
    raw(injectCsrf(shell.value, ctx.csrf)),
    "/static/app.css",
    "/static/app.js",
  );
}
export function flash(
  message: string | null,
  kind: "ok" | "error" = "ok",
): Raw {
  return message
    ? html`<div class="flash ${kind}" role="${kind === "error" ? "alert" : "status"}" data-testid="flash-${kind}" > ${message} </div>`
    : raw("");
}
export function reportPage(
  title: string,
  description: string,
  body: Raw,
): string {
  return document(
    title,
    html`<meta name="description" content="${description}"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light">`,
    html`<main class="report-wrap"> <div class="report-mark">Miscited · answer risk audit</div> ${body} <footer class="report-foot"> ${POSITION} · <a href="/">miscited</a> </footer> </main>`,
    "/static/report.css",
    null,
  );
}
export function publicPage(meta: HeadMeta, body: Raw): string {
  const url = canonical(meta.path);
  const head = html`<meta name="description" content="${meta.description}"><link rel="canonical" href="${url}"><meta name="color-scheme" content="light"><meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1"><link rel="icon" href="/static/miscited-logo-rust.png" type="image/png"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:title" content="${meta.title}"><meta property="og:description" content="${meta.description}"><meta property="og:url" content="${url}"><meta property="og:type" content="website"><meta property="og:locale" content="en_GB"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${meta.title}"><meta name="twitter:description" content="${meta.description}">${meta.path === "/" ? html`<meta property="og:image" content="${canonical('/static/launch-card.png')}"><meta property="og:image:width" content="1270"><meta property="og:image:height" content="760"><meta property="og:image:alt" content="Miscited: your product changed, the answer did not. AI answer accuracy for B2B SaaS."><meta name="twitter:image" content="${canonical('/static/launch-card.png')}">` : null}${meta.extra ?? []}`;
  return document(
    meta.title,
    head,
    body,
    meta.stylesheet ?? "/static/landing.css",
    meta.script === undefined ? "/static/landing.js" : meta.script,
    meta.bodyClass,
  );
}
export function marketingPage(
  title: string,
  description: string,
  body: Raw,
  extra: Raw[] = [],
): string {
  return publicPage({ title, description, path: "/", extra }, body);
}
