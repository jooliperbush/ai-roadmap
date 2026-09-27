/** HTTP composition root. Feature registrars own behavior; runtime owns request boundaries. */
import Fastify, { type FastifyInstance } from 'fastify';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import assets from '@fastify/static';
import { createRuntime, type ServerOptions } from './http/context.js';
import { installHeaders, installSecurity, undeclaredMutatingRoutes } from './http/security.js';
import { publicRoutes } from './http/routes/public.js';
import { workspaceRoutes } from './http/routes/workspace.js';
import { actionRoutes } from './http/routes/actions.js';
import { apiRoutes } from './http/routes/api.js';
import { operationRoutes } from './http/routes/operations.js';
import { legalRoutes } from './http/routes/legal.js';
import { CANONICAL_HOST } from './web/seo.js';
import { PUBLIC_ROOT, STATIC_PREFIX, staticCacheControl } from './web/assets.js';
import { notFoundPage } from './web/views/layout.js';
export type { ServerOptions, Auth } from './http/context.js';
export { undeclaredMutatingRoutes } from './http/security.js';
export { extractorEval, SAMPLE_CSV } from './http/metadata.js';

/**
 * Railway's edge reaches the container from a private or carrier-grade NAT address and appends the visitor to
 * X-Forwarded-For. Trusting only those peers makes req.ip the visitor, so per-IP limits bind per visitor, while
 * a client that connects directly cannot spoof the header. A hop count would not help: Fastify 5.12 treats a
 * numeric trustProxy as trusting nobody.
 */
const TRUSTED_PROXIES = ['loopback', 'linklocal', 'uniquelocal', '100.64.0.0/10'];

/**
 * Text, which compresses several-fold. Images and video arrive compressed already, and a video must keep its byte
 * ranges. @fastify/compress also compresses whatever mime-db marks compressible, which adds SVG and nothing binary.
 */
const COMPRESSIBLE = /^text\/|[/+](?:json|xml|javascript)(?:;|$)/;

/**
 * /blog/ and /blog/?ref=x become /blog and /blog?ref=x, so every page has one address. Only GET and HEAD, never the
 * root, and never a path that starts with // or /\, which a browser would read as another host.
 */
function withoutTrailingSlash(method: string, url: string): string {
  if (method !== 'GET' && method !== 'HEAD') return url;
  const query = url.indexOf('?');
  const path = query === -1 ? url : url.slice(0, query);
  if (path.length < 2 || !path.endsWith('/') || !/^\/(?![/\\])/.test(path)) return url;
  return path.replace(/\/+$/, '') + (query === -1 ? '' : url.slice(query));
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: TRUSTED_PROXIES });
  const registeredRoutes: Array<{ method: string; url: string }> = [];
  Object.assign(app, { db: options.db, registeredRoutes });
  app.addHook('onRoute', (route) => {
    for (const method of Array.isArray(route.method) ? route.method : [route.method])
      registeredRoutes.push({ method: String(method).toUpperCase(), url: route.url });
  });
  installHeaders(app);
  app.addHook('onRequest', async (req, reply) => {
    const host = String(req.headers.host ?? '')
      .toLowerCase()
      .split(':')[0];
    const url = withoutTrailingSlash(req.method, req.url);
    if (host === `www.${CANONICAL_HOST}`) return reply.code(301).redirect(`https://${CANONICAL_HOST}${url}`);
    if (url !== req.url) return reply.code(301).redirect(url);
  });
  app.addHook('onSend', async (req, reply) => {
    if (req.routeOptions.url === `${STATIC_PREFIX}*` && [200, 206, 304].includes(reply.statusCode))
      reply.header('cache-control', staticCacheControl(req.url));
  });
  app.register(compress, { encodings: ['br', 'gzip'], customTypes: COMPRESSIBLE });
  app.register(cookie);
  app.register(formbody);
  app.register(assets, { root: PUBLIC_ROOT, prefix: STATIC_PREFIX, cacheControl: false });
  // Routes are declared once the plugins above have loaded, so compression's onRoute hook reaches every one of them.
  // A throw here rejects ready() and listen(), so the server still refuses to boot.
  app.after((err) => {
    if (err) throw err;
    const runtime = createRuntime(app, options);
    installSecurity(runtime);
    for (const register of [publicRoutes, legalRoutes, workspaceRoutes, actionRoutes, apiRoutes, operationRoutes])
      register(runtime);
    app.setNotFoundHandler((req, reply) =>
      /^\/api(\/|\?|$)/.test(req.url)
        ? reply
            .code(404)
            .send({ message: `Route ${req.method}:${req.url} not found`, error: 'Not Found', statusCode: 404 })
        : reply.code(404).type('text/html; charset=utf-8').send(notFoundPage()),
    );
    const missing = undeclaredMutatingRoutes(registeredRoutes);
    if (missing.length)
      throw new Error(
        `These mutating routes have no minimum role in ROUTE_ROLES: ${missing.join(', ')}. Add them to src/domain/roles.ts, or to PUBLIC_ROUTES if they are reachable before a session exists.`,
      );
  });
  return app;
}
