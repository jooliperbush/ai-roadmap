import { html, Raw, raw, escapeHtml } from "../html.js";
import { asset } from "../assets.js";
import {
  BRAND_PAPER,
  canonical,
  DEFAULT_SOCIAL_IMAGE,
  FEED_PATH,
  SITE_LANGUAGE,
  SITE_NAME,
  type SocialImage,
} from "../seo.js";

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
  /** The share card; the launch card unless the page has its own. */
  image?: SocialImage;
  /** A post's dates, which make the page an og:type article. */
  article?: { published: string; modified: string };
  /** Kept out of search results, with no canonical URL of its own. */
  noindex?: boolean;
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
/** The PNG says 32x32 so browsers that read SVG icons prefer the SVG after it. */
function icons(): Raw {
  return html`<link rel="icon" href="${asset("/static/icons/favicon-32.png")}" sizes="32x32" type="image/png"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="${asset("/static/icons/apple-touch-icon.png")}"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="${BRAND_PAPER}">`;
}
function document(
  title: string,
  head: Raw,
  body: Raw,
  stylesheet: string,
  script: string | null,
  bodyClass = "",
): string {
  return html`<!DOCTYPE html> <html lang="${SITE_LANGUAGE}"> <head> <meta charset="utf-8"> <meta name="viewport" content="width=device-width, initial-scale=1"> <title>${title}</title> ${head} ${icons()} <link rel="stylesheet" href="${asset(stylesheet)}"> </head> <body class="${bodyClass}"> ${body}${script ? html`<script src="${asset(script)}" defer></script>` : null} </body> </html>`
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
    ? html`<a class="skip-link" href="#main-content">Skip to content</a> <header class="topbar"> <a class="brandmark" href="/" ><img class="brand-logo" src="${asset("/static/miscited-logo-rust.png")}" alt="" width="38" height="26"><span class="wordmark">Miscited</span></a > <div class="promise">${PROMISE}</div> ${identity(ctx)} </header> <nav class="mainnav" aria-label="Workspace"> ${NAV.map(
        ([key, href, label]) =>
          html`<a href="${href}" class="navlink ${key === ctx.active ? "active" : ""}" data-testid="nav-${key}" ${key === ctx.active ? raw('aria-current="page"') : ""} >${label}</a >`,
      )} </nav> <main id="main-content">${body}</main> <footer class="footer"> <span>${POSITION}</span ><a href="/methodology">Sampling methodology &amp; limitations</a> </footer>`
    : html`<main id="main-content">${body}</main> <footer class="footer"> <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span> </footer>`;
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
    html`<main class="report-wrap"> <div class="report-mark">Miscited · answer risk audit</div> ${body} <footer class="report-foot"> ${POSITION} · <a href="/">miscited</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> </footer> </main>`,
    "/static/report.css",
    null,
  );
}
export function publicPage(meta: HeadMeta, body: Raw): string {
  const url = canonical(meta.path);
  const image = meta.image ?? DEFAULT_SOCIAL_IMAGE;
  const head = html`<meta name="description" content="${meta.description}">${
    meta.noindex
      ? html`<meta name="robots" content="noindex">`
      : html`<link rel="canonical" href="${url}">`
  }<meta name="color-scheme" content="light">${
    meta.noindex
      ? null
      : html`<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">`
  }<link rel="alternate" type="application/rss+xml" title="${SITE_NAME} · Writing" href="${canonical(FEED_PATH)}"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:title" content="${meta.title}"><meta property="og:description" content="${meta.description}">${
    meta.noindex ? null : html`<meta property="og:url" content="${url}">`
  }<meta property="og:type" content="${meta.article ? "article" : "website"}"><meta property="og:locale" content="en_GB">${
    meta.article
      ? html`<meta property="article:published_time" content="${meta.article.published}"><meta property="article:modified_time" content="${meta.article.modified}">`
      : null
  }<meta property="og:image" content="${image.url}"><meta property="og:image:width" content="${image.width}"><meta property="og:image:height" content="${image.height}"><meta property="og:image:alt" content="${image.alt}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${meta.title}"><meta name="twitter:description" content="${meta.description}"><meta name="twitter:image" content="${image.url}"><meta name="twitter:image:alt" content="${image.alt}">${meta.extra ?? []}`;
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
/** Any address nothing serves, in the blog's chrome, with the two ways back. */
export function notFoundPage(
  message = "Nothing lives at this address. It may have moved, or the link may be mistyped.",
): string {
  return publicPage(
    {
      title: `Not found · ${SITE_NAME}`,
      description: "No page exists at this address.",
      path: "/",
      stylesheet: "/static/blog.css",
      script: null,
      noindex: true,
    },
    html`<main> <article class="post"> <header class="post-head"> <nav class="crumbs" aria-label="Breadcrumb"> <ol> <li><a href="/">Miscited</a></li> <li><span aria-current="page">Not found</span></li> </ol> </nav> <h1>Not found</h1> <p class="lede">${message}</p> </header> <div class="prose"> <p>Start again from the <a href="/">home page</a>, or read the <a href="/blog">writing</a>.</p> </div> </article> </main><footer class="blog-foot"> <nav aria-label="Footer"> <a href="/">Miscited</a> <a href="/blog">Writing</a> <a href="/privacy">Privacy</a> <a href="/terms">Terms</a> </nav> </footer>`,
  );
}
