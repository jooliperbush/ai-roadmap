import { BackgroundTasks } from '../runtime/tasks.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import * as agency from '../db/repo/agency.js';
import { systemClock, type Clock } from '../domain/clock.js';
import { RateLimiter } from '../domain/ratelimit.js';
import type { Transport } from '../services/delivery.js';
import type { Fetcher } from '../domain/fetcher.js';
import type { BeliefProfile } from '../providers/types.js';
import { flash, page } from '../web/views/layout.js';
import { html, raw, type Raw } from '../web/html.js';

export interface ServerOptions {
  db: DB;
  clock?: Clock;
  transports?: Record<string, Transport>;
  fetcher?: Fetcher | null;
  beliefsFor?: (window: string) => BeliefProfile | null;
  demoHint?: string | null;
  logger?: boolean;
}
export interface Auth {
  tenantId: string;
  userId: string;
  email: string;
  role: string;
  csrf: string;
}
export interface RequestContext {
  req: FastifyRequest;
  reply: FastifyReply;
  a: Auth;
  brand: repo.Row;
  body: Record<string, any>;
  params: Record<string, string>;
  query: Record<string, string>;
  show(title: string, section: string, body: Raw): FastifyReply;
  redirect(path: string, message: string, kind?: 'ok' | 'error'): FastifyReply;
  missing(section?: string): FastifyReply;
}
export const redirectWith = (
  reply: FastifyReply,
  path: string,
  message: string,
  kind: 'ok' | 'error' = 'ok',
) =>
  reply.redirect(`${path}${path.includes('?') ? '&' : '?'}msg=${encodeURIComponent(message)}&kind=${kind}`);
export const forbidden = (message: string) =>
  html`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Not permitted</title>
        <link rel="stylesheet" href="/static/app.css" />
      </head>
      <body>
        <main>
          <h1>Not permitted</h1>
          <p class="lede" data-testid="forbidden">${message}</p>
          <p><a href="/">Back to the answer desk</a></p>
        </main>
      </body>
    </html>`.value;

export function createRuntime(app: FastifyInstance, options: ServerOptions) {
  const { db } = options;
  const tasks = new BackgroundTasks();
  app.addHook('onClose', async () => tasks.drain());
  const clock = options.clock ?? systemClock;
  const limiter = new RateLimiter(clock);
  const sessions = new WeakMap<FastifyRequest, Auth | null>();
  const auth = (req: FastifyRequest): Auth | null => {
    if (sessions.has(req)) return sessions.get(req)!;
    const row = req.cookies?.aops ? repo.getSession(db, req.cookies.aops) : undefined;
    const result = row
      ? {
          tenantId: row.tenant_id,
          userId: row.user_id,
          email: row.email,
          role: row.role,
          csrf: row.csrf ?? '',
        }
      : null;
    sessions.set(req, result);
    return result;
  };
  const currentBrand = (a: Auth, req: FastifyRequest) => {
    const stored = req.cookies?.aops ? repo.getSession(db, req.cookies.aops) : undefined;
    const selected = req.cookies?.brand ?? stored?.active_brand_id;
    return (
      (selected ? repo.getBrand(db, a.tenantId, selected) : undefined) ?? repo.primaryBrand(db, a.tenantId)
    );
  };
  const roleFor = (a: Auth, brandId?: string) =>
    brandId ? (agency.brandRole(db, a.tenantId, a.userId, brandId) ?? a.role) : a.role;
  const context = (req: FastifyRequest, reply: FastifyReply, a: Auth): RequestContext => {
    const brand = currentBrand(a, req);
    if (!brand) throw new Error('no brand configured for this tenant');
    const query = (req.query ?? {}) as Record<string, string>;
    const show = (title: string, active: string, body: Raw) => {
      const brands = repo.listBrands(db, a.tenantId);
      const notice = flash(query.msg ?? null, query.kind === 'error' ? 'error' : 'ok');
      return reply.type('text/html; charset=utf-8').send(
        page(
          title,
          {
            email: a.email,
            tenantName: repo.getTenant(db, a.tenantId)?.name ?? '',
            brandName: brand.name,
            active,
            csrf: a.csrf,
            brands: brands.map((b) => ({ id: b.id, name: b.name })),
            brandId: brand.id,
            role: roleFor(a, brand.id),
          },
          raw((notice?.value ?? '') + body.value),
        ),
      );
    };
    return {
      req,
      reply,
      a,
      brand,
      query,
      body: (req.body ?? {}) as Record<string, any>,
      params: (req.params ?? {}) as Record<string, string>,
      show,
      redirect: (path, message, kind) => redirectWith(reply, path, message, kind),
      missing: (section = 'dashboard') => {
        reply.code(404);
        return show(
          'Not found',
          section,
          html`<main>
            <h1>Not found</h1>
            <p class="lede">That record does not exist in this workspace.</p>
          </main>`,
        );
      },
    };
  };
  type Handler = (ctx: RequestContext) => unknown | Promise<unknown>;
  const route = (method: 'GET' | 'POST', url: string, handler: Handler) =>
    app.route({
      method,
      url,
      handler: async (req, reply) => {
        const a = auth(req);
        if (!a)
          return url.startsWith('/api/')
            ? reply.code(401).send({ error: 'unauthenticated' })
            : reply.redirect('/login');
        return handler(context(req, reply, a));
      },
    });
  return {
    app,
    db,
    options,
    clock,
    limiter,
    auth,
    tasks,
    currentBrand,
    roleFor,
    context,
    transports: options.transports ?? {},
    fetcher: options.fetcher ?? null,
    get: (url: string, handler: Handler) => route('GET', url, handler),
    post: (url: string, handler: Handler) => route('POST', url, handler),
  };
}
export type Runtime = ReturnType<typeof createRuntime>;
