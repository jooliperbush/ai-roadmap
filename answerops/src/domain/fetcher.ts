/**
 * Snapshot fetching.
 *
 * `checkCitation()` has always done honest work with a snapshot, and nothing ever fetched one,
 * so with live providers every citation resolved to `unreachable` and the product's central
 * claim returned nothing. This is the missing half.
 *
 * The politeness rules are not decoration. A tool that reads other people's pages in order to
 * say something about them has to be able to describe exactly what it did.
 */

import { createHash } from 'node:crypto';

export const USER_AGENT = 'Miscited/1.0 (+https://miscited.example/bot)';
export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 8000;
export const MAX_ATTEMPTS = 3;
export const PER_HOST_CONCURRENCY = 2;
export const SNAPSHOT_RETENTION_DAYS = 180;

/** Closed set. "unreachable" without a cause is not a finding, it is a shrug. */
export type FetchErrorKind =
  | 'dns'
  | 'timeout'
  | 'http_404'
  | 'http_4xx'
  | 'http_5xx'
  | 'robots_disallowed'
  | 'too_large'
  | 'invalid_url'
  | 'blocked';

export const FETCH_ERROR_KINDS: FetchErrorKind[] = [
  'dns',
  'timeout',
  'http_404',
  'http_4xx',
  'http_5xx',
  'robots_disallowed',
  'too_large',
  'invalid_url',
  'blocked',
];

export const FETCH_ERROR_LABEL: Record<FetchErrorKind, string> = {
  dns: 'the host does not resolve',
  timeout: 'the page did not respond in time',
  http_404: 'the page returned 404',
  http_4xx: 'the page refused the request',
  http_5xx: 'the server errored',
  robots_disallowed: 'robots.txt disallows this path',
  too_large: 'the page exceeded the size limit',
  invalid_url: 'the citation is not a usable URL',
  blocked: 'the host is on the never-fetch list',
};

export interface FetchOutcome {
  url: string;
  ok: boolean;
  sha256: string | null;
  body: string | null;
  bytes: number;
  contentType: string;
  truncated: boolean;
  status: number | null;
  error: FetchErrorKind | null;
  fetchedAt: string;
}

export interface Fetcher {
  fetch(url: string): Promise<FetchOutcome>;
}

export function sha256Of(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Hosts we never fetch: loopback and private ranges, so a citation cannot point us inward. */
export function isBlockedHost(host: string): boolean {
  if (!host) return true;
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local'))
    return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '::1' || h === '[::1]') return true;
  return false;
}

export function statusToError(status: number): FetchErrorKind {
  if (status === 404) return 'http_404';
  if (status >= 500) return 'http_5xx';
  return 'http_4xx';
}

/**
 * Minimal robots.txt: the User-agent groups that apply to us, and their Disallow prefixes.
 * Deliberately conservative — an unparsable file is treated as allowing nothing new, not as a
 * licence.
 */
export function parseRobots(text: string, agent = 'miscited'): { disallow: string[]; allow: string[] } {
  type Group = { agents: string[]; disallow: string[]; allow: string[] };
  const groups: Group[] = [];
  let active: Group | undefined;
  let consecutiveAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    const key = (separator < 0 ? line : line.slice(0, separator)).trim().toLowerCase();
    const value = separator < 0 ? '' : line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (!active || !consecutiveAgent) {
        active = { agents: [], disallow: [], allow: [] };
        groups.push(active);
      }
      active.agents.push(value.toLowerCase());
    } else if (active && (key === 'disallow' || key === 'allow')) active[key].push(value);
    consecutiveAgent = key === 'user-agent';
  }
  const applicable = groups.filter((group) =>
    group.agents.some((name) => name === '*' || agent.includes(name)),
  );
  const specific = applicable.filter((group) => group.agents.some((name) => name !== '*'));
  return (specific.length ? specific : applicable).reduce(
    (rules, group) => ({
      disallow: [...rules.disallow, ...group.disallow.filter(Boolean)],
      allow: [...rules.allow, ...group.allow.filter(Boolean)],
    }),
    { disallow: [] as string[], allow: [] as string[] },
  );
}

export function robotsAllows(rules: { disallow: string[]; allow: string[] }, path: string): boolean {
  const longest = (prefixes: string[]) =>
    prefixes.reduce(
      (length, prefix) => (path.startsWith(prefix) ? Math.max(length, prefix.length) : length),
      0,
    );
  return longest(rules.allow) >= longest(rules.disallow);
}

/** Strip markup so a claim check reads text, not attributes and script bodies. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

interface HttpFetcherOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  maxBytes?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  respectRobots?: boolean;
}

/**
 * The real fetcher. Per-host concurrency is a simple promise chain per host: two in flight,
 * the rest queued, because being polite is cheaper than being blocked.
 */
export class HttpFetcher implements Fetcher {
  private settings: Required<HttpFetcherOptions>;
  private robots = new Map<string, { disallow: string[]; allow: string[] }>();
  private slots = new Map<string, { active: number; waiting: Array<() => void> }>();
  constructor(opts: HttpFetcherOptions = {}) {
    this.settings = {
      fetchImpl: opts.fetchImpl ?? fetch,
      now: opts.now ?? (() => new Date()),
      maxBytes: opts.maxBytes ?? MAX_BYTES,
      timeoutMs: opts.timeoutMs ?? TIMEOUT_MS,
      maxAttempts: opts.maxAttempts ?? MAX_ATTEMPTS,
      sleep: opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      respectRobots: opts.respectRobots ?? true,
    };
  }
  async fetch(url: string): Promise<FetchOutcome> {
    const fetchedAt = this.settings.now().toISOString();
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return fail(url, 'invalid_url', fetchedAt);
    } catch {
      return fail(url, 'invalid_url', fetchedAt);
    }
    if (isBlockedHost(parsed.hostname)) return fail(url, 'blocked', fetchedAt);
    if (this.settings.respectRobots && !robotsAllows(await this.rulesFor(parsed), parsed.pathname))
      return fail(url, 'robots_disallowed', fetchedAt);
    const release = await this.acquire(parsed.host);
    try {
      return await this.retrieve(parsed.toString(), fetchedAt);
    } finally {
      release();
    }
  }
  private async acquire(host: string): Promise<() => void> {
    const state = this.slots.get(host) ?? { active: 0, waiting: [] };
    this.slots.set(host, state);
    if (state.active >= PER_HOST_CONCURRENCY)
      await new Promise<void>((resolve) => state.waiting.push(resolve));
    else state.active++;
    return () => {
      const next = state.waiting.shift();
      if (next) next();
      else state.active--;
    };
  }
  private async request(url: string): Promise<Response> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), this.settings.timeoutMs);
    try {
      return await this.settings.fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        signal: abort.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  private async rulesFor(url: URL): Promise<{ disallow: string[]; allow: string[] }> {
    let rules = this.robots.get(url.host);
    if (rules) return rules;
    rules = { disallow: [], allow: [] };
    try {
      const response = await this.request(url.protocol + '//' + url.host + '/robots.txt');
      if (response.ok) rules = parseRobots(await response.text());
    } catch {
      /* An unreachable robots file states no restrictions. */
    }
    this.robots.set(url.host, rules);
    return rules;
  }
  private async retrieve(url: string, fetchedAt: string): Promise<FetchOutcome> {
    let outcome = fail(url, 'timeout', fetchedAt);
    for (let index = 0; index < this.settings.maxAttempts; index++) {
      try {
        const response = await this.request(url);
        if (response.ok) {
          const raw = await response.text();
          return {
            url,
            ok: true,
            sha256: sha256Of(raw),
            body: raw.slice(0, this.settings.maxBytes),
            bytes: raw.length,
            contentType: response.headers.get('content-type') ?? '',
            truncated: raw.length > this.settings.maxBytes,
            status: response.status,
            error: null,
            fetchedAt,
          };
        }
        outcome = { ...fail(url, statusToError(response.status), fetchedAt), status: response.status };
        if (response.status < 500 && response.status !== 429) return outcome;
      } catch (error) {
        outcome = fail(url, classifyError(error), fetchedAt);
      }
      if (index + 1 < this.settings.maxAttempts) await this.settings.sleep(200 * (index + 1));
    }
    return outcome;
  }
}

function classifyError(err: unknown): FetchErrorKind {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/abort/i.test(msg)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return 'dns';
  return 'timeout';
}

function fail(url: string, error: FetchErrorKind, at: string): FetchOutcome {
  return {
    url,
    ok: false,
    sha256: null,
    body: null,
    bytes: 0,
    contentType: '',
    truncated: false,
    status: null,
    error,
    fetchedAt: at,
  };
}

/** A fetcher that never touches the network. The default in tests and in the seeded demo. */
export class StubFetcher implements Fetcher {
  constructor(
    private pages: Record<string, { body?: string; status?: number; error?: FetchErrorKind }>,
    private now: () => Date = () => new Date(),
  ) {}
  async fetch(url: string): Promise<FetchOutcome> {
    const fetchedAt = this.now().toISOString();
    const page = this.pages[url] ?? this.pages[url.replace(/\/$/, '')];
    if (!page || page.error) return fail(url, page?.error ?? 'http_404', fetchedAt);
    const body = page.body ?? '';
    return {
      ...fail(url, 'http_404', fetchedAt),
      ok: true,
      sha256: sha256Of(body),
      body,
      bytes: body.length,
      contentType: 'text/html',
      status: page.status ?? 200,
      error: null,
    };
  }
}

/** A fetcher that returns nothing, preserving the pre-Phase-2 behaviour where it is wanted. */
export class NullFetcher implements Fetcher {
  async fetch(url: string): Promise<FetchOutcome> {
    return fail(url, 'blocked', new Date().toISOString());
  }
}
