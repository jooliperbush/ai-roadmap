import type { Runtime } from './context.js';
import { forbidden } from './context.js';
import { ROUTE_ROLES, CSRF_EXEMPT, routeKey, allows } from '../domain/roles.js';
import { LIMIT_ON_FAILURE } from '../domain/ratelimit.js';
import * as repo from '../db/repo/index.js';
import { getSchedule } from '../db/repo/unattended.js';

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
