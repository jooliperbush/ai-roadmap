/**
 * The blog: an index and a post.
 *
 * Both are documents rather than instruments, so they borrow the report's typographic decisions
 * rather than the console's. The structural choices here are made for extraction as much as for
 * reading: a direct answer under every heading, headings phrased the way the question is asked,
 * tables instead of prose for anything comparative, and a visible updated date, because undated
 * writing loses to dated writing in every system that ranks or cites it.
 */

import { html, raw, type Raw } from '../html.js';
import type { Post } from '../../content/posts.js';

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

export function blogIndexView(posts: Post[]): Raw {
  return html`
<article class="post-index">
  <header class="post-head">
    <p class="kicker"><a href="/">Miscited</a> · Writing</p>
    <h1>Writing</h1>
    <p class="lede">
      How to measure what AI assistants say about a company without fooling yourself. Arithmetic where
      the arithmetic matters, and the sample size on every number.
    </p>
  </header>

  <ul class="post-list">
    ${posts.map(
      (p) => html`<li>
        <a class="post-card" href="/blog/${p.slug}">
          <span class="dateline">${prettyDate(p.published)} · ${p.readingMinutes} min read</span>
          <h2>${p.title}</h2>
          <p>${p.summary}</p>
          <span class="more">Read this</span>
        </a>
      </li>`,
    )}
  </ul>

  <aside class="post-cta">
    <h3>See what the assistants are telling your buyers</h3>
    <p>
      The free Answer Risk Audit runs the whole pipeline against your domain and hands back every wrong
      answer it can evidence, with transcripts, setups and citations.
    </p>
    <a class="btn" href="/#audit">Request an answer audit</a>
  </aside>
</article>`;
}

export function postView(p: Post, others: Post[]): Raw {
  return html`
<article class="post">
  <header class="post-head">
    <p class="kicker"><a href="/">Miscited</a> · <a href="/blog">Writing</a></p>
    <h1>${p.title}</h1>
    <p class="dateline">
      Published ${prettyDate(p.published)}${p.updated !== p.published ? ` · Updated ${prettyDate(p.updated)}` : ''}
      · ${p.readingMinutes} min read
    </p>
  </header>

  <div class="prose">${raw(p.body)}</div>

  ${p.faq.length > 0
    ? html`<section class="faq">
        <h2>Questions people ask about this</h2>
        ${p.faq.map(
          (f) => html`<div class="qa">
            <h3>${f.q}</h3>
            <p>${f.a}</p>
          </div>`,
        )}
      </section>`
    : null}

  <aside class="post-cta">
    <h3>Find out what they are saying about you</h3>
    <p>
      The free Answer Risk Audit samples your highest-intent buyer questions across four assistants and
      returns every wrong answer it can evidence. If it finds nothing worth fixing, it says so.
    </p>
    <a class="btn" href="/#audit">Request an answer audit</a>
  </aside>

  ${others.length > 0
    ? html`<nav class="post-more">
        <h3>More writing</h3>
        <ul>
          ${others.map((o) => html`<li><a href="/blog/${o.slug}">${o.title}</a></li>`)}
        </ul>
      </nav>`
    : null}
</article>`;
}
