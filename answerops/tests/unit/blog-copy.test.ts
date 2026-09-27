import { describe, expect, it } from 'vitest';
import { POSTS, postsNewestFirst } from '../../src/content/posts.js';
import { blogIndexView, postView } from '../../src/web/views/blog.js';

/**
 * The blog renders without knowing how many assistants are configured, so it must not promise a
 * count. The landing page makes that promise only when all four are live (product-copy.test.ts).
 */
describe('blog copy represents the available product', () => {
  const pages: [string, string][] = [
    ['/blog', blogIndexView(postsNewestFirst()).value],
    ...POSTS.map((post): [string, string] => [`/blog/${post.slug}`, postView(post, POSTS).value]),
  ];

  it.each(pages)('%s promises no assistant count', (_path, html) => {
    expect(html).not.toMatch(/\b(?:four|all four|4) assistants\b/i);
  });

  it.each(pages)('%s uses the landing wording for the audit invitation', (_path, html) => {
    expect(html).not.toContain('Request a free answer audit');
  });
});
