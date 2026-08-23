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
  'dns', 'timeout', 'http_404', 'http_4xx', 'http_5xx', 'robots_disallowed', 'too_large', 'invalid_url', 'blocked',
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
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
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
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[] }> = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow') current.disallow.push(value);
    else if (key === 'allow') current.allow.push(value);
  }
  const applicable = groups.filter((g) => g.agents.some((a) => a === '*' || agent.includes(a)));
  const specific = applicable.filter((g) => g.agents.some((a) => a !== '*'));
  const chosen = specific.length ? specific : applicable;
  return {
    disallow: chosen.flatMap((g) => g.disallow).filter((d) => d.length > 0),
    allow: chosen.flatMap((g) => g.allow).filter((a) => a.length > 0),
  };
}

export function robotsAllows(rules: { disallow: string[]; allow: string[] }, path: string): boolean {
  const longest = (list: string[]) =>
    list.filter((p) => path.startsWith(p)).sort((a, b) => b.length - a.length)[0] ?? null;
  const d = longest(rules.disallow);
  if (!d) return true;
  const a = longest(rules.allow);
  // Longest match wins, which is what the major crawlers do.
  return a !== null && a.length >= d.length;
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
  private robotsCache = new Map<string, { disallow: string[]; allow: string[] }>();
  private hostQueues = new Map<string, Promise<unknown>[]>();
  private fetchImpl: typeof fetch;
  private now: () => Date;
  private maxBytes: number;
  private timeoutMs: number;
  private maxAttempts: number;
  private sleep: (ms: number) => Promise<void>;
  private respectRobots: boolean;

  constructor(opts: HttpFetcherOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.maxBytes = opts.maxBytes ?? MAX_BYTES;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.respectRobots = opts.respectRobots ?? true;
  }

  async fetch(url: string): Promise<FetchOutcome> {
    const at = this.now().toISOString();
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('scheme');
    } catch {
      return fail(url, 'invalid_url', at);
    }
    if (isBlockedHost(parsed.hostname)) return fail(url, 'blocked', at);

    if (this.respectRobots) {
      const rules = await this.robotsFor(parsed);
      if (!robotsAllows(rules, parsed.pathname)) return fail(url, 'robots_disallowed', at);
    }

    return this.withHostSlot(parsed.host, () => this.attempt(parsed, at));
  }

  private async attempt(parsed: URL, at: string): Promise<FetchOutcome> {
    let lastError: FetchErrorKind = 'timeout';
    for (let i = 1; i <= this.maxAttempts; i++) {
      try {
        const res = await this.withTimeout(parsed.toString());
        if (!res.ok) {
          lastError = statusToError(res.status);
          // 4xx other than 429 is a fact about the page, not a transient failure.
          if (res.status < 500 && res.status !== 429) {
            return { ...fail(parsed.toString(), lastError, at), status: res.status };
          }
          if (i === this.maxAttempts) return { ...fail(parsed.toString(), lastError, at), status: res.status };
          await this.sleep(200 * i);
          continue;
        }
        const contentType = res.headers.get('content-type') ?? '';
        const raw = await res.text();
        const truncated = raw.length > this.maxBytes;
        const body = truncated ? raw.slice(0, this.maxBytes) : raw;
        return {
          url: parsed.toString(),
          ok: true,
          sha256: sha256Of(raw),
          body,
          bytes: raw.length,
          contentType,
          truncated,
          status: res.status,
          error: null,
          fetchedAt: at,
        };
      } catch (err) {
        lastError = classifyError(err);
        if (i === this.maxAttempts) return fail(parsed.toString(), lastError, at);
        await this.sleep(200 * i);
      }
    }
    return fail(parsed.toString(), lastError, at);
  }

  private async withTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async robotsFor(parsed: URL): Promise<{ disallow: string[]; allow: string[] }> {
    const cached = this.robotsCache.get(parsed.host);
    if (cached) return cached;
    let rules = { disallow: [] as string[], allow: [] as string[] };
    try {
      const res = await this.withTimeout(`${parsed.protocol}//${parsed.host}/robots.txt`);
      if (res.ok) rules = parseRobots(await res.text());
    } catch {
      // No robots.txt reachable means no stated restriction. We do not invent one, and we do
      // not treat the absence as permission to ignore a future one: the cache is per process.
    }
    this.robotsCache.set(parsed.host, rules);
    return rules;
  }

  private async withHostSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const queue = this.hostQueues.get(host) ?? [];
    this.hostQueues.set(host, queue);
    while (queue.length >= PER_HOST_CONCURRENCY) {
      await Promise.race(queue).catch(() => undefined);
    }
    const p = fn();
    queue.push(p);
    try {
      return await p;
    } finally {
      const i = queue.indexOf(p);
      if (i >= 0) queue.splice(i, 1);
    }
  }
}

function classifyError(err: unknown): FetchErrorKind {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/abort/i.test(msg)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return 'dns';
  return 'timeout';
}

function fail(url: string, error: FetchErrorKind, at: string): FetchOutcome {
  return { url, ok: false, sha256: null, body: null, bytes: 0, contentType: '', truncated: false, status: null, error, fetchedAt: at };
}

/** A fetcher that never touches the network. The default in tests and in the seeded demo. */
export class StubFetcher implements Fetcher {
  constructor(private pages: Record<string, { body?: string; status?: number; error?: FetchErrorKind }>, private now: () => Date = () => new Date()) {}
  async fetch(url: string): Promise<FetchOutcome> {
    const at = this.now().toISOString();
    const hit = this.pages[url] ?? this.pages[url.replace(/\/$/, '')];
    if (!hit) return fail(url, 'http_404', at);
    if (hit.error) return fail(url, hit.error, at);
    const body = hit.body ?? '';
    return {
      url, ok: true, sha256: sha256Of(body), body, bytes: body.length,
      contentType: 'text/html', truncated: false, status: hit.status ?? 200, error: null, fetchedAt: at,
    };
  }
}

/** A fetcher that returns nothing, preserving the pre-Phase-2 behaviour where it is wanted. */
export class NullFetcher implements Fetcher {
  async fetch(url: string): Promise<FetchOutcome> {
    return fail(url, 'blocked', new Date().toISOString());
  }
}
