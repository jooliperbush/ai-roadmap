import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Runtime } from './context.js';
import { forbidden } from './context.js';
import { ROUTE_ROLES, CSRF_EXEMPT, routeKey, allows } from '../domain/roles.js';
import { LIMIT_ON_FAILURE } from '../domain/ratelimit.js';
import * as repo from '../db/repo/index.js';
import { getSchedule } from '../db/repo/unattended.js';

/** The inline event handlers the views still use. Each is allowed by its hash, so no other inline script runs. */
export const INLINE_HANDLERS = ['this.form.submit()'];
const sha256 = (source: string) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
/**
 * Scripts are files under /static/ plus the handlers above; JSON-LD blocks are data, which script-src does not
 * govern. style-src keeps 'unsafe-inline' so a style attribute in new markup is not silently dropped: no view has
 * one today, and CSS injection is the smaller risk. data: images are the SVG backgrounds in the stylesheets.
 * No page is framed, even by the site itself: frame-ancestors says so, and X-Frame-Options DENY says it to browsers
 * too old to read frame-ancestors.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-hashes' ${INLINE_HANDLERS.map(sha256).join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
/** Subdomains are left out until each of them is known to serve HTTPS. */
export const HSTS = 'max-age=31536000';

/** On every response, redirects, 404s and errors included. A route that sets one of these itself keeps its own. */
export function installHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!reply.hasHeader(name)) reply.header(name, value);
    // Only production is known to be served over HTTPS alone.
    if (process.env.NODE_ENV === 'production' && !reply.hasHeader('strict-transport-security'))
      reply.header('strict-transport-security', HSTS);
  });
}

export function undeclaredMutatingRoutes(routes: Array<{ method: string; url: string }>): string[] {
  return [
    ...new Set(
      routes
        .filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method.toUpperCase()))
        .map((r) => routeKey(r.method, r.url))
        .filter((key) => !ROUTE_ROLES[key] && !CSRF_EXEMPT.has(key)),
    ),
  ];
}
export function installSecurity(r: Runtime): void {
  r.app.addHook('preHandler', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const key = routeKey(req.method, req.routeOptions.url ?? req.url);
    if (LIMIT_ON_FAILURE.has(key)) return;
    const limit = r.limiter.check(key, req.ip ?? 'unknown');
    if (!limit.ok)
      return reply
        .code(429)
        .header('retry-after', String(limit.retryAfterSec))
        .send({ error: 'too many requests', retryAfterSeconds: limit.retryAfterSec });
    if (CSRF_EXEMPT.has(key)) return;
    const a = r.auth(req);
    if (!a) return;
    if (!(req.headers['content-type'] ?? '').includes('application/json')) {
      const token = String(
        (req.body as Record<string, unknown> | null)?._csrf ?? req.headers['x-csrf-token'] ?? '',
      );
      if (!token || token !== a.csrf) {
        repo.audit(r.db, a.tenantId, a.email, 'csrf_rejected', 'route', key, '');
        return reply
          .code(403)
          .type('text/html')
          .send(forbidden('That form was missing its security token. Reload the page and try again.'));
      }
    }
    const minimum = ROUTE_ROLES[key];
    // Authorize the resource being changed, never an unrelated brand in the switcher.
    const pattern = req.routeOptions.url ?? req.url;
    const id = (req.params as Record<string, string>)?.id;
    let target: repo.Row | undefined;
    if (id) {
      if (/^\/(api\/)?actions\//.test(pattern)) target = repo.getAction(r.db, a.tenantId, id);
      else if (/^\/experiments\//.test(pattern)) target = repo.getExperiment(r.db, a.tenantId, id);
      else if (/^\/truth\//.test(pattern)) target = repo.getCanonicalClaim(r.db, a.tenantId, id);
      else if (/^\/clusters\//.test(pattern)) target = repo.getCluster(r.db, a.tenantId, id);
      else if (/^\/schedules\//.test(pattern)) target = getSchedule(r.db, a.tenantId, id);
      else if (/^\/citations\//.test(pattern)) {
        const citation = repo.getCitation(r.db, a.tenantId, id);
        if (citation) target = repo.getRun(r.db, a.tenantId, citation.run_id);
      }
    }
    const workspacePolicy =
      /^\/(channels|alerts|index-consent|logout|brands)(\/|$)/.test(pattern) || pattern === '/schedules';
    const brandId = workspacePolicy ? undefined : (target?.brand_id ?? r.currentBrand(a, req)?.id);
    const role = r.roleFor(a, brandId);
    if (minimum && !allows(role, minimum)) {
      repo.audit(r.db, a.tenantId, a.email, 'role_denied', 'route', key, `needs ${minimum}, has ${role}`);
      return reply
        .code(403)
        .type('text/html')
        .send(forbidden(`This action needs the ${minimum} role. Yours is ${role}.`));
    }
  });
}
