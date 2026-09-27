import { asset } from "../assets.js";
import { html, raw, type Raw } from "../html.js";
import { compareNewestFirst, TAGS, type Post } from "../../content/posts.js";
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const date = (iso: string): string =>
  dateFormatter.format(new Date(`${iso}T00:00:00Z`));
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/&[a-z#0-9]+;|['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
/** The topic filter needs no script: each topic is a fragment, and blog.css hides the other posts on :target. */
const topicHref = (tag: string): string => `/blog#topic-${slugify(tag)}`;
/** The visible trail and the BreadcrumbList JSON-LD both come from here, so the two cannot disagree. */
export function breadcrumbTrail(
  post?: Pick<Post, "slug" | "title">,
): Array<{ name: string; path: string }> {
  return [
    { name: "Miscited", path: "/" },
    { name: "Writing", path: "/blog" },
    ...(post ? [{ name: post.title, path: `/blog/${post.slug}` }] : []),
  ];
}
function crumbs(post?: Post): Raw {
  const trail = breadcrumbTrail(post);
  return html`<nav class="crumbs" aria-label="Breadcrumb"> <ol> ${trail.map(
    (crumb, index) =>
      index === trail.length - 1
        ? html`<li><a href="${crumb.path}" aria-current="page">${crumb.name}</a></li>`
        : html`<li><a href="${crumb.path}">${crumb.name}</a></li>`,
  )} </ol> </nav>`;
}
function tagList(tags: readonly string[] | undefined): Raw | null {
  return tags?.length
    ? html`<ul class="tags" aria-label="Topics"> ${tags.map(
        (tag) =>
          html`<li><a class="tag" href="${topicHref(tag)}"><span>${tag}</span></a></li>`,
      )} </ul>`
    : null;
}
function invitation(title: string, description: string): Raw {
  return html`<aside class="post-cta"> <h3>${title}</h3> <p>${description}</p> <a class="btn" href="/#audit">Get a free answer audit</a> </aside>`;
}
function footer(): Raw {
  return html`<footer class="blog-foot"> <nav aria-label="Footer"> <a href="/">Miscited</a> <a href="/blog">Writing</a> <a href="/privacy">Privacy</a> <a href="/terms">Terms</a> </nav> </footer>`;
}
function card(post: Post, index: number): Raw {
  const featured = index === 0;
  return html`<li class="${featured ? "featured" : "item"}" data-tags="${(post.tags ?? []).map(slugify).join(" ")}"> <div class="card-meta"> <span class="dateline">${featured ? "Latest · " : null}${date(post.published)} · ${post.readingMinutes} min read</span> ${tagList(post.tags)} </div> <a class="post-card" href="/blog/${post.slug}"> <h2>${post.title}</h2> <p>${post.summary}</p> <span class="more">Read this <span aria-hidden="true">↗</span></span> </a> </li>`;
}
/** The empty targets sit before the filter and the list, because the CSS that filters is a sibling selector. */
function topicFilter(posts: Post[]): Raw | null {
  const used = TAGS.filter((tag) => posts.some((post) => post.tags?.includes(tag)));
  return used.length
    ? html`${used.map(
        (tag) => html`<span class="topic-target" id="topic-${slugify(tag)}"></span>`,
      )}<nav class="topics" id="topics" aria-label="Filter by topic"> <ul> <li><a class="tag all" href="/blog#topics"><span>All</span></a></li> ${used.map(
        (tag) =>
          html`<li><a class="tag" href="${topicHref(tag)}"><span>${tag}</span></a></li>`,
      )} </ul> </nav>`
    : null;
}
export function blogIndexView(posts: Post[]): Raw {
  const ordered = [...posts].sort(compareNewestFirst);
  return html`<main> <div class="post-index"> <header class="post-head"> ${crumbs()} <h1>Writing</h1> <p class="lede"> How to measure what AI assistants say about a company without fooling yourself. Arithmetic where the arithmetic matters, and the sample size on every number. </p> </header> ${topicFilter(ordered)} <ul class="post-list"> ${ordered.map(card)} </ul> ${invitation(
    "See what the assistants are telling your buyers",
    "The free Answer Risk Audit runs the whole pipeline against your domain and hands back every wrong answer it can evidence, with transcripts, setups and citations.",
  )} </div> </main>${footer()}`;
}
interface Heading {
  id: string;
  /** The heading's own markup with its tags stripped, so entities are still escaped. */
  label: string;
}
/** A body names its files plainly; the page serves them with their content hash, like every other asset. */
const versionAssets = (body: string): string =>
  body.replace(
    /\b(src|poster|href)="(\/static\/[^"?#]+)"/g,
    (_match, attribute: string, path: string) => `${attribute}="${asset(path)}"`,
  );
const H2 = /<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g;
/** Not .post-cta: the end invitation stays the one button on the page. */
const INLINE_INVITATION = `<aside class="inline-cta"><p><b>Want to know what the assistants say about your company?</b> The free answer audit samples the questions your buyers ask and returns every wrong answer it can evidence, with transcripts and citations. <a href="/#audit">Get a free answer audit</a></p></aside>`;
/**
 * Gives every h2 in a trusted body an id for the contents list, and puts the mid-article invitation before
 * the heading nearest the middle of the text. Never before the first heading, which would crowd the lede,
 * and never before the sources.
 */
function prepareBody(body: string): { body: string; headings: Heading[] } {
  const found = [...body.matchAll(H2)];
  const used = new Set(["faq"]);
  const headings = found.map((match) => {
    const label = (match[2] ?? "").replace(/<[^>]+>/g, "").trim();
    const own = /\sid="([^"]+)"/.exec(match[1] ?? "")?.[1];
    const base = own ?? (slugify(label) || "section");
    let id = base;
    for (let n = 2; !own && used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return { id, label };
  });
  const middle = body.length / 2;
  const distance = (index: number): number =>
    Math.abs((found[index]?.index ?? 0) - middle);
  let invitationAt = -1;
  headings.forEach((heading, index) => {
    if (index === 0 || heading.label === "Sources") return;
    if (invitationAt === -1 || distance(index) < distance(invitationAt))
      invitationAt = index;
  });
  let index = 0;
  const prepared = body.replace(H2, (_match, attrs = "", inner = "") => {
    const heading = headings[index]!;
    const before = index === invitationAt ? INLINE_INVITATION : "";
    index += 1;
    const open = /\sid="/.test(attrs)
      ? `<h2${attrs}>`
      : `<h2 id="${heading.id}"${attrs}>`;
    return `${before}${open}${inner}</h2>`;
  });
  return { body: prepared, headings };
}
/** Only a post long enough to need one: four sections or more. */
function contents(headings: Heading[], hasFaq: boolean): Raw | null {
  return headings.length >= 4
    ? html`<nav class="toc" aria-label="Contents"> <p class="toc-title">Contents</p> <ol> ${headings.map(
        (heading) =>
          html`<li><a href="#${heading.id}">${raw(heading.label)}</a></li>`,
      )}${hasFaq ? html`<li><a href="#faq">Questions people ask about this</a></li>` : null} </ol> </nav>`
    : null;
}
/** In date order: the previous post is the one published before this one. */
function pager(post: Post, others: Post[]): Raw | null {
  const sequence = [post, ...others].sort(compareNewestFirst);
  const at = sequence.indexOf(post);
  const previous = sequence[at + 1];
  const next = at > 0 ? sequence[at - 1] : undefined;
  return previous || next
    ? html`<nav class="post-pager" aria-label="Previous and next posts"> ${
        previous
          ? html`<a class="prev" href="/blog/${previous.slug}"><span class="dir"><span aria-hidden="true">←</span> Previous</span> <span class="t">${previous.title}</span></a>`
          : null
      } ${
        next
          ? html`<a class="next" href="/blog/${next.slug}"><span class="dir">Next <span aria-hidden="true">→</span></span> <span class="t">${next.title}</span></a>`
          : null
      } </nav>`
    : null;
}
/** Up to three, most shared topics first. Ties, and posts that share nothing, go newest first. */
function related(post: Post, others: Post[]): Raw | null {
  const topics = new Set(post.tags ?? []);
  const picks = [...others]
    .sort(compareNewestFirst)
    .map((other) => ({
      other,
      shared: (other.tags ?? []).filter((tag) => topics.has(tag)).length,
    }))
    .sort((a, b) => b.shared - a.shared)
    .slice(0, 3);
  return picks.length
    ? html`<nav class="post-related" aria-label="Related posts"> <h2>Related</h2> <ul> ${picks.map(
        ({ other }) =>
          html`<li><a href="/blog/${other.slug}"><span class="meta">${date(other.published)} · ${other.readingMinutes} min read</span> <span class="t">${other.title}</span></a></li>`,
      )} </ul> </nav>`
    : null;
}
export function postView(post: Post, others: Post[]): Raw {
  const rest = others.filter((other) => other.slug !== post.slug);
  const { body, headings } = prepareBody(versionAssets(post.body));
  return html`<main> <article class="post"> <header class="post-head"> ${crumbs(post)} <h1>${post.title}</h1> <p class="dateline"> By Miscited · Published ${date(post.published)}${
    post.updated !== post.published
      ? html` · Updated ${date(post.updated)}`
      : null
  } · ${post.readingMinutes} min read </p> ${tagList(post.tags)} </header> ${contents(
    headings,
    post.faq.length > 0,
  )} <div class="prose">${raw(body)}</div> ${
    post.faq.length
      ? html`<section class="faq" id="faq"> <h2>Questions people ask about this</h2> ${post.faq.map(
          (item) =>
            html`<div class="qa"> <h3>${item.q}</h3> <p>${item.a}</p> </div>`,
        )} </section>`
      : null
  }${invitation(
    "Find out what they are saying about you",
    "The free Answer Risk Audit asks AI your highest-intent buyer questions and returns every wrong answer it can evidence. If it finds nothing worth fixing, it says so.",
  )}${pager(post, rest)}${related(post, rest)} </article> </main>${footer()}`;
}
