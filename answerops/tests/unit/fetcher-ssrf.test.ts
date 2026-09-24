/**
 * The fetcher reads URLs that strangers put in front of it, from inside our network. These tests pin down that
 * it only ever connects to the public internet: every name is resolved and every answer checked, every redirect
 * is checked again, and the connection goes to the addresses that were checked.
 */
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { isIP, type AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { HttpFetcher, isPublicAddress, pinnedTransport, USER_AGENT, type Transport } from '../../src/domain/fetcher.js';

function response(body: string, init: { status?: number } = {}): Response {
  return new Response(body, { status: init.status ?? 200, headers: { 'content-type': 'text/html' } });
}

/** example.com's address. Nothing connects to it: every test here injects the transport. */
const PUBLIC = '93.184.215.14';
const publicDns = async () => [{ address: PUBLIC, family: 4 }];

/** A resolver that answers from a table, so no test touches real DNS. */
function dnsTable(table: Record<string, string[]>) {
  const asked: string[] = [];
  const resolve = async (host: string) => {
    asked.push(host);
    const found = table[host];
    if (!found) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return found.map((address) => ({ address, family: isIP(address) }));
  };
  return { asked, resolve };
}

/** A transport serving fixed pages by URL, recording each request and the addresses it was pinned to. */
function site(pages: Record<string, () => Response>) {
  const calls: Array<{ url: string; addresses: string[] }> = [];
  const transport: Transport = async (url, _init, addresses) => {
    calls.push({ url, addresses: addresses.map(({ address }) => address) });
    return pages[url]?.() ?? response('missing', { status: 404 });
  };
  return { calls, transport };
}

const moved = (location: string, status = 302) => () => new Response(null, { status, headers: { location } });

describe('server-side request forgery', () => {
  it('knows which addresses are the public internet, in every form that embeds IPv4', () => {
    const inward = [
      '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '192.0.0.170', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
      '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1', '::127.0.0.1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1',
      '2001::1', '2001:db8::1', '3fff::1', 'not an address',
    ];
    for (const address of inward) expect(isPublicAddress(address), address).toBe(false);
    const outward = [
      '8.8.8.8', '1.1.1.1', PUBLIC, '100.63.255.255', '100.128.0.0', '172.32.0.1', '2606:4700::1111',
      '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1',
    ];
    for (const address of outward) expect(isPublicAddress(address), address).toBe(true);
  });

  it('refuses inward hosts in any spelling, before DNS or a connection', async () => {
    const dns = dnsTable({});
    const { calls, transport } = site({});
    const fetcher = new HttpFetcher({ fetchImpl: transport, resolve: dns.resolve });
    const spellings = [
      'http://2130706433/', 'http://0x7f.1/', 'http://017700000001/', 'http://127.1/', 'http://0/',
      'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[fd00::1]/',
      'http://169.254.169.254/latest/meta-data/', 'http://localhost./', 'http://metadata.google.internal/',
    ];
    for (const url of spellings) expect((await fetcher.fetch(url)).error, url).toBe('blocked');
    expect(dns.asked).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('refuses non-default ports and credentials', async () => {
    const { calls, transport } = site({ 'https://example.com/x': () => response('ok') });
    const fetcher = new HttpFetcher({ fetchImpl: transport, resolve: publicDns, respectRobots: false });
    expect((await fetcher.fetch('https://example.com:8443/x')).error).toBe('blocked');
    expect((await fetcher.fetch('http://example.com:443/x')).error).toBe('blocked');
    expect((await fetcher.fetch('https://user:secret@example.com/x')).error).toBe('invalid_url');
    expect(calls).toEqual([]);
    expect((await fetcher.fetch('https://example.com:443/x')).ok, 'the default port, spelled out').toBe(true);
  });

  it('refuses a name that resolves inward, and a name with any inward address among its answers', async () => {
    const dns = dnsTable({
      'intranet.example.com': ['10.0.0.5'],
      'mixed.example.com': [PUBLIC, '127.0.0.1'],
      'mixed6.example.com': [PUBLIC, '::1'],
      'mapped.example.com': ['::ffff:169.254.169.254'],
      'empty.example.com': [],
    });
    const { calls, transport } = site({});
    const fetcher = new HttpFetcher({ fetchImpl: transport, resolve: dns.resolve });
    const hosts = ['intranet', 'mixed', 'mixed6', 'mapped', 'empty'].map((name) => `${name}.example.com`);
    for (const host of hosts) expect((await fetcher.fetch(`https://${host}/page`)).error, host).toBe('blocked');
    expect(calls, 'not even robots.txt is requested from them').toEqual([]);
  });

  it('checks the answer for every request, so a name cannot turn inward after robots.txt', async () => {
    let lookups = 0;
    const { calls, transport } = site({ 'https://rebind.example.com/robots.txt': () => response('User-agent: *\n') });
    const fetcher = new HttpFetcher({
      fetchImpl: transport,
      resolve: async () => [{ address: lookups++ ? '169.254.169.254' : PUBLIC, family: 4 }],
    });
    expect((await fetcher.fetch('https://rebind.example.com/page')).error).toBe('blocked');
    expect(calls.map(({ url }) => url)).toEqual(['https://rebind.example.com/robots.txt']);
  });

  it('re-checks every redirect, so a public page cannot bounce us inward', async () => {
    const dns = dnsTable({ 'example.com': [PUBLIC], 'intranet.example.com': ['192.168.1.10'] });
    const { calls, transport } = site({
      'https://example.com/to-intranet': moved('https://intranet.example.com/admin'),
      'https://example.com/to-metadata': moved('http://169.254.169.254/latest/meta-data/', 301),
      'https://example.com/to-mapped': moved('http://[::ffff:a9fe:a9fe]/', 307),
      'https://example.com/to-port': moved('https://example.com:8443/', 308),
      'https://example.com/to-file': moved('file:///etc/passwd', 303),
      'https://example.com/to-nowhere': moved('https://exa mple.com/'),
    });
    const fetcher = new HttpFetcher({ fetchImpl: transport, resolve: dns.resolve, respectRobots: false });
    const expected = {
      'to-intranet': 'blocked',
      'to-metadata': 'blocked',
      'to-mapped': 'blocked',
      'to-port': 'blocked',
      'to-file': 'invalid_url',
      'to-nowhere': 'invalid_url',
    };
    for (const [path, error] of Object.entries(expected)) {
      const out = await fetcher.fetch(`https://example.com/${path}`);
      expect(out.error, path).toBe(error);
    }
    expect(calls.map(({ url }) => new URL(url).host)).toEqual(Array(6).fill('example.com'));
  });

  it('follows up to five redirects, pinning each hop to the addresses it was checked against', async () => {
    const dns = dnsTable({ 'example.com': [PUBLIC], 'www.example.org': ['2606:4700::1111'] });
    const { calls, transport } = site({
      'https://example.com/0': moved('/1', 301),
      'https://example.com/1': moved('/2'),
      'https://example.com/2': moved('/3', 303),
      'https://example.com/3': moved('/4', 307),
      'https://example.com/4': moved('https://www.example.org/5', 308),
      'https://www.example.org/5': () => response('<p>arrived</p>'),
      'https://example.com/loop': moved('/loop'),
    });
    const fetcher = new HttpFetcher({ fetchImpl: transport, resolve: dns.resolve, respectRobots: false });
    const out = await fetcher.fetch('https://example.com/0');
    expect(out.ok).toBe(true);
    expect(out.url).toBe('https://example.com/0');
    expect(out.body).toBe('<p>arrived</p>');
    expect(calls.at(-1)).toEqual({ url: 'https://www.example.org/5', addresses: ['2606:4700::1111'] });
    expect(calls.slice(0, -1).every(({ addresses }) => addresses[0] === PUBLIC)).toBe(true);
    calls.length = 0;
    expect((await fetcher.fetch('https://example.com/loop')).error).toBe('invalid_url');
    expect(calls, 'the first request and five redirects').toHaveLength(6);
  });

  it('pins an IP literal to itself without asking DNS', async () => {
    const dns = dnsTable({});
    const { calls, transport } = site({ 'http://[2606:4700::1111]/': () => response('literal') });
    const fetcher = new HttpFetcher({ fetchImpl: transport, resolve: dns.resolve, respectRobots: false });
    expect((await fetcher.fetch('http://[2606:4700::1111]/')).ok).toBe(true);
    expect(calls).toEqual([{ url: 'http://[2606:4700::1111]/', addresses: ['2606:4700::1111'] }]);
    expect(dns.asked).toEqual([]);
  });

  it('names a host that does not resolve as dns', async () => {
    const fetcher = new HttpFetcher({
      fetchImpl: site({}).transport,
      resolve: dnsTable({}).resolve,
      respectRobots: false,
      sleep: async () => undefined,
    });
    expect((await fetcher.fetch('https://nowhere.example/')).error).toBe('dns');
  });

  it('stops reading a body past four times the size limit, and does not retry it', async () => {
    const { calls, transport } = site({
      'https://example.com/fits': () => response('x'.repeat(40)),
      'https://example.com/huge': () => response('x'.repeat(41)),
    });
    const fetcher = new HttpFetcher({ fetchImpl: transport, resolve: publicDns, respectRobots: false, maxBytes: 10 });
    const fits = await fetcher.fetch('https://example.com/fits');
    expect([fits.ok, fits.truncated, fits.bytes, fits.body]).toEqual([true, true, 40, 'x'.repeat(10)]);
    expect((await fetcher.fetch('https://example.com/huge')).error).toBe('too_large');
    expect(calls).toHaveLength(2);
  });

  it('holds DNS, the response and the body to one deadline', async () => {
    const endless = () =>
      new Response(new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode('<p>')) }));
    const settings = { respectRobots: false, timeoutMs: 50, maxAttempts: 1 };
    const slowBody = new HttpFetcher({ ...settings, resolve: publicDns, fetchImpl: site({ 'https://example.com/': endless }).transport });
    const noAnswer = new HttpFetcher({ ...settings, resolve: publicDns, fetchImpl: () => new Promise<Response>(() => undefined) });
    const noDns = new HttpFetcher({ ...settings, resolve: () => new Promise(() => undefined), fetchImpl: site({}).transport });
    for (const fetcher of [slowBody, noAnswer, noDns])
      expect((await fetcher.fetch('https://example.com/')).error).toBe('timeout');
  });
});

describe('pinnedTransport', () => {
  it('connects only to the checked address, decodes the body, and leaves redirects to the caller', async () => {
    const seen: Array<Record<string, string | undefined>> = [];
    const server = createServer((req, res) => {
      seen.push({ path: req.url, host: req.headers.host, ua: req.headers['user-agent'], ae: req.headers['accept-encoding'] });
      if (req.url === '/moved') res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
      else res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gzipSync('<p>pinned</p>'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      // .invalid never resolves (RFC 6761), so reaching the server at all proves the connection was pinned.
      const origin = `http://pinned.invalid:${port}`;
      const init = { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(5000), redirect: 'manual' as const };
      const addresses = [{ address: '127.0.0.1', family: 4 }];
      const page = await pinnedTransport(`${origin}/page`, init, addresses);
      expect([page.status, page.headers.get('content-type'), await page.text()]).toEqual([200, 'text/html', '<p>pinned</p>']);
      const redirect = await pinnedTransport(`${origin}/moved`, init, addresses);
      expect([redirect.status, redirect.headers.get('location')]).toEqual([302, 'http://169.254.169.254/']);
      await redirect.body?.cancel();
      const request = { host: `pinned.invalid:${port}`, ua: USER_AGENT, ae: 'gzip, deflate, br' };
      expect(seen).toEqual([{ path: '/page', ...request }, { path: '/moved', ...request }]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
