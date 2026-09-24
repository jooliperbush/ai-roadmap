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
import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { pipeline, Readable, type Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

export const USER_AGENT = 'Miscited/1.0 (+https://miscited.com)';
export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 8000;
export const MAX_ATTEMPTS = 3;
export const PER_HOST_CONCURRENCY = 2;
export const MAX_REDIRECTS = 5;
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

/** Hosts we never fetch by name or by literal address, so a citation cannot point us inward. */
export function isBlockedHost(host: string): boolean {
  const h = host
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local'))
    return true;
  return isIP(h) !== 0 && !isPublicAddress(h);
}

/** IPv4 ranges that are not the public internet: [first address, prefix length]. */
const NON_PUBLIC_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including the 169.254.169.254 metadata service
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast
];

function ipv4Value(address: string): number {
  return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
}

function isPublicV4(value: number): boolean {
  return NON_PUBLIC_V4.every(([first, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(value / size) !== Math.floor(ipv4Value(first) / size);
  });
}

/** The eight 16-bit groups of a valid IPv6 address, including one written with a dotted IPv4 tail. */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase();
  const tail: number[] = [];
  const dotted = /:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const value = ipv4Value(dotted[1]);
    tail.push(Math.floor(value / 65536), value % 65536);
    text = text.slice(0, dotted.index + 1);
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }
  const [head, rest] = text
    .split('::')
    .map((part) => (part ? part.split(':').map((group) => parseInt(group, 16)) : []));
  const zeros = rest ? 8 - tail.length - head.length - rest.length : 0;
  return [...head, ...Array<number>(zeros).fill(0), ...(rest ?? []), ...tail];
}

/**
 * Whether an address is on the public internet. IPv6 must be global unicast, and the forms that carry an IPv4
 * address (mapped, NAT64, 6to4) are judged by that address, so ::ffff:127.0.0.1 is loopback like 127.0.0.1.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicV4(ipv4Value(address));
  if (family !== 6) return false;
  const g = ipv6Groups(address);
  const embedded = (high: number, low: number) => isPublicV4(high * 65536 + low);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]); // IPv4-mapped
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if ((g[0] & 0xe000) !== 0x2000) return false; // loopback, unspecified, unique-local, link-local, multicast, ...
  if (g[0] === 0x2001 && (g[1] < 0x200 || g[1] === 0xdb8)) return false; // Teredo and other protocol use; documentation
  return !(g[0] === 0x3fff && g[1] < 0x1000); // 3fff::/20 documentation
}

/** One GET that leaves redirects to the caller and connects only to `addresses`, which the caller has checked. */
export type Transport = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' },
  addresses: LookupAddress[],
) => Promise<Response>;

/** Content codings we ask for, as fetch() did, and so must undo ourselves. */
const DECODERS: Record<string, (() => Transform) | undefined> = {
  gzip: createGunzip,
  'x-gzip': createGunzip,
  deflate: createInflate,
  br: createBrotliDecompress,
};

/**
 * The production transport. The socket is pinned to the checked addresses through `lookup`, so the name cannot
 * resolve somewhere else between the check and the connection; TLS still verifies the certificate for the name.
 */
export const pinnedTransport: Transport = (url, init, addresses) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const pinned: LookupFunction = (_host, options, callback) =>
      options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
    const request = (target.protocol === 'https:' ? httpsGet : httpGet)(
      target,
      {
        headers: { ...init.headers, 'accept-encoding': 'gzip, deflate, br' },
        signal: init.signal,
        agent: false,
        lookup: pinned,
      },
      (res) => {
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers))
            for (const item of [value ?? []].flat())
              try {
                headers.append(name, item);
              } catch {
                /* A value the Fetch API cannot represent is one we never read. */
              }
          const status = res.statusCode ?? 0;
          const decoder = DECODERS[String(res.headers['content-encoding'] ?? '').trim().toLowerCase()];
          let body: ReadableStream | null = null;
          if ([204, 205, 304].includes(status)) res.resume();
          else body = Readable.toWeb(decoder ? pipeline(res, decoder(), () => undefined) : res) as ReadableStream;
          resolve(new Response(body, { status, headers }));
        } catch (error) {
          res.destroy();
          reject(error);
        }
      },
    );
    request.on('error', reject);
  });

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/** A request we will not make. Asking again cannot change that, so it is never retried. */
class Refused extends Error {
  constructor(readonly kind: FetchErrorKind) {
    super(`refused: ${kind}`);
  }
}

/** Settles with `promise`, or rejects as soon as `signal` aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** The body as text, refusing it once it passes `limit` bytes rather than holding all of it. */
async function readCapped(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return new TextDecoder().decode(Buffer.concat(chunks));
      size += value.byteLength;
      if (size > limit) {
        cancel();
        throw new Refused('too_large');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
  }
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
  fetchImpl?: Transport;
  /** Every address a host name resolves to. Each must be public before we connect. */
  resolve?: (host: string) => Promise<LookupAddress[]>;
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
      fetchImpl: opts.fetchImpl ?? pinnedTransport,
      resolve: opts.resolve ?? ((host) => lookup(host, { all: true })),
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
    if (parsed.port || isBlockedHost(parsed.hostname)) return fail(url, 'blocked', fetchedAt);
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
  /** The addresses `target` may be fetched from: every one its host resolves to, and all of them public. */
  private async admit(target: URL, signal: AbortSignal): Promise<LookupAddress[]> {
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
      throw new Refused('invalid_url');
    if (target.port || isBlockedHost(target.hostname)) throw new Refused('blocked');
    const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
    const family = isIP(host);
    const addresses = family ? [{ address: host, family }] : await abortable(this.settings.resolve(host), signal);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
      throw new Refused('blocked');
    return addresses;
  }
  /**
   * One GET under one deadline covering DNS, redirects and the body. Redirects are followed by hand so each hop
   * is admitted like the first URL, and a body is read, up to a hard cap, only when it is the answer.
   */
  private async request(url: string): Promise<{ status: number; ok: boolean; contentType: string; text: string }> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), this.settings.timeoutMs);
    try {
      let target = new URL(url);
      for (let redirects = 0; ; redirects++) {
        const addresses = await this.admit(target, abort.signal);
        const response = await abortable(
          this.settings.fetchImpl(
            target.toString(),
            {
              headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
              signal: abort.signal,
              redirect: 'manual',
            },
            addresses,
          ),
          abort.signal,
        );
        const location = REDIRECT_STATUSES.includes(response.status) ? response.headers.get('location') : null;
        if (location === null) {
          const text = response.ok ? await readCapped(response, this.settings.maxBytes * 4, abort.signal) : '';
          if (!response.ok) void response.body?.cancel().catch(() => undefined);
          const contentType = response.headers.get('content-type') ?? '';
          return { status: response.status, ok: response.ok, contentType, text };
        }
        void response.body?.cancel().catch(() => undefined);
        if (redirects === MAX_REDIRECTS) throw new Refused('invalid_url');
        try {
          target = new URL(location, target);
        } catch {
          throw new Refused('invalid_url');
        }
      }
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
      if (response.ok) rules = parseRobots(response.text);
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
          const raw = response.text;
          return {
            url,
            ok: true,
            sha256: sha256Of(raw),
            body: raw.slice(0, this.settings.maxBytes),
            bytes: raw.length,
            contentType: response.contentType,
            truncated: raw.length > this.settings.maxBytes,
            status: response.status,
            error: null,
            fetchedAt,
          };
        }
        outcome = { ...fail(url, statusToError(response.status), fetchedAt), status: response.status };
        if (response.status < 500 && response.status !== 429) return outcome;
      } catch (error) {
        if (error instanceof Refused) return fail(url, error.kind, fetchedAt);
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
