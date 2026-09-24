/** HTTP composition root. Feature registrars own behavior; runtime owns request boundaries. */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import assets from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { createRuntime, type ServerOptions } from './http/context.js';
import { installSecurity, undeclaredMutatingRoutes } from './http/security.js';
import { publicRoutes } from './http/routes/public.js';
import { workspaceRoutes } from './http/routes/workspace.js';
import { actionRoutes } from './http/routes/actions.js';
import { apiRoutes } from './http/routes/api.js';
import { operationRoutes } from './http/routes/operations.js';
import { legalRoutes } from './http/routes/legal.js';
import { CANONICAL_HOST } from './web/seo.js';
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

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: TRUSTED_PROXIES });
  const registeredRoutes: Array<{ method: string; url: string }> = [];
  Object.assign(app, { db: options.db, registeredRoutes });
  app.addHook('onRoute', (route) => {
    for (const method of Array.isArray(route.method) ? route.method : [route.method])
      registeredRoutes.push({ method: String(method).toUpperCase(), url: route.url });
  });
  app.addHook('onRequest', async (req, reply) => {
    const host = String(req.headers.host ?? '')
      .toLowerCase()
      .split(':')[0];
    if (host === `www.${CANONICAL_HOST}`)
      return reply.code(301).redirect(`https://${CANONICAL_HOST}${req.url}`);
  });
  app.register(cookie);
  app.register(formbody);
  app.register(assets, { root: fileURLToPath(new URL('./web/public', import.meta.url)), prefix: '/static/' });
  const runtime = createRuntime(app, options);
  installSecurity(runtime);
  for (const register of [publicRoutes, legalRoutes, workspaceRoutes, actionRoutes, apiRoutes, operationRoutes])
    register(runtime);
  const missing = undeclaredMutatingRoutes(registeredRoutes);
  if (missing.length)
    throw new Error(
      `These mutating routes have no minimum role in ROUTE_ROLES: ${missing.join(', ')}. Add them to src/domain/roles.ts, or to PUBLIC_ROUTES if they are reachable before a session exists.`,
    );
  return app;
}
