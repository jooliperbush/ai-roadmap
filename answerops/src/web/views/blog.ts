import { html, raw, type Raw } from "../html.js";
import type { Post } from "../../content/posts.js";
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const date = (iso: string): string =>
  dateFormatter.format(new Date(`${iso}T00:00:00Z`));
function invitation(title: string, description: string): Raw {
  return html`<aside class="post-cta"> <h3>${title}</h3> <p>${description}</p> <a class="btn" href="/#audit">Request an answer audit</a> </aside>`;
}
function footer(): Raw {
  return html`<footer class="blog-foot"> <nav aria-label="Footer"> <a href="/">Miscited</a> <a href="/blog">Writing</a> <a href="/privacy">Privacy</a> <a href="/terms">Terms</a> </nav> </footer>`;
}
function card(post: Post): Raw {
  return html`<li> <a class="post-card" href="/blog/${post.slug}" ><span class="dateline" >${date(post.published)} · ${post.readingMinutes} min read</span > <h2>${post.title}</h2> <p>${post.summary}</p> <span class="more">Read this <span aria-hidden="true">↗</span></span></a > </li>`;
}
export function blogIndexView(posts: Post[]): Raw {
  return html`<main> <article class="post-index"> <header class="post-head"> <p class="kicker"><a href="/">Miscited</a> · Writing</p> <h1>Writing</h1> <p class="lede"> How to measure what AI assistants say about a company without fooling yourself. Arithmetic where the arithmetic matters, and the sample size on every number. </p> </header> <ul class="post-list"> ${posts.map(card)} </ul> ${invitation(
    "See what the assistants are telling your buyers",
    "The free Answer Risk Audit runs the whole pipeline against your domain and hands back every wrong answer it can evidence, with transcripts, setups and citations.",
  )} </article> </main>${footer()}`;
}
export function postView(post: Post, others: Post[]): Raw {
  return html`<main> <article class="post"> <header class="post-head"> <p class="kicker"> <a href="/">Miscited</a> · <a href="/blog">Writing</a> </p> <h1>${post.title}</h1> <p class="dateline"> Published ${date(post.published)}${
    post.updated !== post.published
      ? html` · Updated ${date(post.updated)}`
      : null
  } · ${post.readingMinutes} min read </p> </header> <div class="prose">${raw(post.body)}</div> ${
    post.faq.length
      ? html`<section class="faq"> <h2>Questions people ask about this</h2> ${post.faq.map(
          (item) =>
            html`<div class="qa"> <h3>${item.q}</h3> <p>${item.a}</p> </div>`,
        )} </section>`
      : null
  }${invitation(
    "Find out what they are saying about you",
    "The free Answer Risk Audit samples your highest-intent buyer questions across four assistants and returns every wrong answer it can evidence. If it finds nothing worth fixing, it says so.",
  )}${
    others.length
      ? html`<nav class="post-more" aria-label="More writing"> <h3>More writing</h3> <ul> ${others.map(
          (item) =>
            html`<li><a href="/blog/${item.slug}">${item.title}</a></li>`,
        )} </ul> </nav>`
      : null
  } </article> </main>${footer()}`;
}
