/**
 * The snapshot fetcher. The point of these tests is the closed error set and the politeness
 * rules: "unreachable" without a cause is a shrug, and a tool that reads other people's pages
 * has to be able to say exactly what it did.
 */
import { describe, it, expect } from 'vitest';
import {
  HttpFetcher, StubFetcher, parseRobots, robotsAllows, isBlockedHost, statusToError, textOf, sha256Of,
  FETCH_ERROR_KINDS, USER_AGENT, MAX_BYTES,
} from '../../src/domain/fetcher.js';

function response(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, { status: init.status ?? 200, headers: { 'content-type': 'text/html', ...(init.headers ?? {}) } });
}

describe('robots.txt', () => {
  it('applies the wildcard group when there is no group for us', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\n');
    expect(robotsAllows(rules, '/public')).toBe(true);
    expect(robotsAllows(rules, '/private/thing')).toBe(false);
  });

  it('prefers a group that names us over the wildcard', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: miscited\nDisallow: /admin\n');
    expect(robotsAllows(rules, '/pricing')).toBe(true);
    expect(robotsAllows(rules, '/admin')).toBe(false);
  });

  it('lets the longest match win, the way the major crawlers do', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /docs\nAllow: /docs/public\n');
    expect(robotsAllows(rules, '/docs/internal')).toBe(false);
    expect(robotsAllows(rules, '/docs/public/a')).toBe(true);
  });

  it('treats an empty Disallow as no restriction', () => {
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow:\n'), '/anything')).toBe(true);
  });

  it('ignores comments', () => {
    const rules = parseRobots('# hello\nUser-agent: *\nDisallow: /x # why\n');
    expect(robotsAllows(rules, '/x')).toBe(false);
  });
});

describe('blocked hosts', () => {
  it('refuses loopback and private ranges, so a citation cannot point us inward', () => {
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.9.9', '169.254.1.1', 'thing.internal']) {
      expect(isBlockedHost(host), host).toBe(true);
    }
    expect(isBlockedHost('example.com')).toBe(false);
  });
});

describe('error classification', () => {
  it('maps statuses onto the closed set', () => {
    expect(statusToError(404)).toBe('http_404');
    expect(statusToError(403)).toBe('http_4xx');
    expect(statusToError(503)).toBe('http_5xx');
    for (const kind of [statusToError(404), statusToError(403), statusToError(500)]) {
      expect(FETCH_ERROR_KINDS).toContain(kind);
    }
  });
});

describe('HttpFetcher', () => {
  const okRobots = () => response('User-agent: *\nDisallow:\n');

  it('fetches a page, hashes it, and identifies itself', async () => {
    const seen: Array<{ url: string; ua: string }> = [];
    const fetcher = new HttpFetcher({
      fetchImpl: (async (url: any, init: any) => {
        seen.push({ url: String(url), ua: String(init?.headers?.['user-agent'] ?? '') });
        return String(url).endsWith('/robots.txt') ? okRobots() : response('<p>Northwind supports SSO.</p>');
      }) as any,
    });
    const out = await fetcher.fetch('https://example.com/security');
    expect(out.ok).toBe(true);
    expect(out.sha256).toBe(sha256Of('<p>Northwind supports SSO.</p>'));
    expect(out.status).toBe(200);
    expect(seen.every((s) => s.ua === USER_AGENT)).toBe(true);
  });

  it('refuses a path robots.txt disallows, without requesting it', async () => {
    const requested: string[] = [];
    const fetcher = new HttpFetcher({
      fetchImpl: (async (url: any) => {
        requested.push(String(url));
        return String(url).endsWith('/robots.txt')
          ? response('User-agent: *\nDisallow: /secret\n')
          : response('should never be read');
      }) as any,
    });
    const out = await fetcher.fetch('https://example.com/secret/page');
    expect(out.ok).toBe(false);
    expect(out.error).toBe('robots_disallowed');
    expect(requested.filter((u) => u.includes('/secret'))).toHaveLength(0);
  });

  it('names 404 as 404 rather than as a generic failure, and does not retry it', async () => {
    let calls = 0;
    const fetcher = new HttpFetcher({
      fetchImpl: (async (url: any) => {
        if (String(url).endsWith('/robots.txt')) return okRobots();
        calls++;
        return response('gone', { status: 404 });
      }) as any,
    });
    const out = await fetcher.fetch('https://example.com/missing');
    expect(out.error).toBe('http_404');
    expect(out.status).toBe(404);
    expect(calls, '4xx is a fact about the page, not a transient failure').toBe(1);
  });

  it('retries a 500 and gives up with http_5xx', async () => {
    let calls = 0;
    const fetcher = new HttpFetcher({
      sleep: async () => undefined,
      fetchImpl: (async (url: any) => {
        if (String(url).endsWith('/robots.txt')) return okRobots();
        calls++;
        return response('boom', { status: 500 });
      }) as any,
    });
    const out = await fetcher.fetch('https://example.com/flaky');
    expect(out.error).toBe('http_5xx');
    expect(calls).toBe(3);
  });

  it('rejects a non-URL and a non-http scheme before touching the network', async () => {
    let called = false;
    const fetcher = new HttpFetcher({ fetchImpl: (async () => { called = true; return response(''); }) as any });
    expect((await fetcher.fetch('not a url')).error).toBe('invalid_url');
    expect((await fetcher.fetch('file:///etc/passwd')).error).toBe('invalid_url');
    expect((await fetcher.fetch('https://127.0.0.1/x')).error).toBe('blocked');
    expect(called).toBe(false);
  });

  it('truncates an oversized page but hashes the whole thing', async () => {
    const big = 'x'.repeat(MAX_BYTES + 500);
    const fetcher = new HttpFetcher({
      fetchImpl: (async (url: any) => (String(url).endsWith('/robots.txt') ? okRobots() : response(big))) as any,
    });
    const out = await fetcher.fetch('https://example.com/huge');
    expect(out.truncated).toBe(true);
    expect(out.body!.length).toBe(MAX_BYTES);
    expect(out.sha256).toBe(sha256Of(big));
  });

  it('caches robots.txt per host instead of refetching it for every page', async () => {
    let robotsCalls = 0;
    const fetcher = new HttpFetcher({
      fetchImpl: (async (url: any) => {
        if (String(url).endsWith('/robots.txt')) { robotsCalls++; return okRobots(); }
        return response('page');
      }) as any,
    });
    await fetcher.fetch('https://example.com/a');
    await fetcher.fetch('https://example.com/b');
    await fetcher.fetch('https://example.com/c');
    expect(robotsCalls).toBe(1);
  });
});

describe('text extraction', () => {
  it('drops script and style bodies rather than treating them as page text', () => {
    const out = textOf('<style>.a{color:red}</style><p>Real text</p><script>var x = "fake text";</script>');
    expect(out).toBe('Real text');
  });

  it('decodes the entities a claim check would otherwise miss', () => {
    expect(textOf('<p>Fees &amp; charges are &lt;1%</p>')).toBe('Fees & charges are <1%');
  });
});

describe('StubFetcher', () => {
  it('serves a scripted page and 404s anything else', async () => {
    const f = new StubFetcher({ 'https://a.example/': { body: 'hello' } });
    expect((await f.fetch('https://a.example/')).body).toBe('hello');
    expect((await f.fetch('https://a.example/other')).error).toBe('http_404');
  });
});
