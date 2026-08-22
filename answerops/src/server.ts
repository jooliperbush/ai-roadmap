import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DB } from './db/index.js';
import { verifyPassword, jsonParse, id as newId, nowIso } from './db/index.js';
import * as repo from './db/repo/index.js';
import { page, marketingPage, reportPage, NavContext, flash } from './web/views/layout.js';
import { raw, Raw } from './web/html.js';
import { loginView } from './web/views/login.js';
import { landingView } from './web/views/landing.js';
import { dashboardView, defectDetailView } from './web/views/dashboard.js';
import {
  clustersView, clusterDetailView, truthView, truthHistoryView, observatoryView, runDetailView,
  actionsView, actionDetailView, experimentsView, experimentDetailView, crawlersView, entitiesView,
  methodologyView, auditView,
} from './web/views/pages.js';
import { buildDashboard, latestWindow } from './services/dashboard.js';
import { importDemand, parseDemandCsv, familyCounts } from './services/demand.js';
import { runSamplingRound } from './services/observatory.js';
import { createAction, transitionAction, analyzeExperimentForAction, UnknownActionTypeError, METRIC_LABEL } from './services/actionEngine.js';
import { ActionState, ALLOWED_TRANSITIONS, IllegalTransitionError } from './domain/actions.js';
import { MissingEvidenceError } from './domain/actions.js';
import { measure, formatP, MIN_SAMPLES, MAX_SAMPLES, ALPHA, MIN_EFFECT, BH_Q } from './domain/stats.js';
import { ROUTE_ROLES, CSRF_EXEMPT, routeKey, allows, type Role } from './domain/roles.js';
import { RateLimiter, LIMIT_ON_FAILURE } from './domain/ratelimit.js';
import { systemClock, type Clock } from './domain/clock.js';
import * as sched from './db/repo/unattended.js';
import * as agency from './db/repo/agency.js';
import * as snapsRepo from './db/repo/snapshots.js';
import { tick, runDigests } from './services/scheduler.js';
import { generateAlerts } from './services/alerts.js';
import { dispatchAlerts, buildDigest, RecordingTransport, type Transport } from './services/delivery.js';
import { recheckCitation } from './services/recheck.js';
import { computeNextRun, windowLabelFor, monthKey, CADENCES, type Cadence } from './domain/scheduler.js';
import { MARKETS, marketLabel } from './domain/geo.js';
import { setMarkets, marketBreakdown } from './services/demand.js';
import { buildIndexReport, quarterOf, setConsent, EXPORT_FIELDS, K_ANON } from './services/index-report.js';
import { createAuditReport, runAudit, getAuditReportByToken, startMonitoring, listAuditReports } from './services/audit.js';
import { PRICE_TABLE, PRICE_TABLE_REVIEWED } from './domain/pricing.js';
import { SNAPSHOT_RETENTION_DAYS, StubFetcher, type Fetcher } from './domain/fetcher.js';
import {
  schedulesView, alertsView, channelsView, snapshotView, portfolioView, marketsView,
  indexView, auditReportView, auditAdminView,
} from './web/views/ops.js';
import { readFileSync, existsSync } from 'node:fs';
import { FIXABILITY } from './domain/priority.js';
import { summariseBlocks, classifyBot, relevantBotClassFor, BOT_CLASS_LABEL } from './domain/crawlers.js';
import { resolveRelation, WeakBasisError, Relation, RelationBasis } from './domain/entities.js';
import { analyzeExperiment } from './domain/experiments.js';
import { truthHistory } from './domain/truth.js';
import { predicateLabel } from './domain/verifier.js';
import { toCanonical } from './services/observatory.js';
import type { BeliefProfile } from './providers/types.js';
import { liveProviderCount } from './providers/registry.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Inbound audit request from the public page. Validated server-side; the client-side
 *  checks are a courtesy, not the boundary. */
const AuditRequest = z.object({
  email: z.string().trim().email('Enter a work email we can send the audit to.'),
  domain: z
    .string()
    .trim()
    .min(4, 'Enter the domain to audit.')
    .regex(/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i, 'That does not look like a domain.'),
});

export interface ServerOptions {
  db: DB;
  /** injected so tests can drive the scheduler and rate limiter without waiting */
  clock?: Clock;
  /** injected so nothing in a test or a demo reaches the network */
  transports?: Record<string, Transport>;
  fetcher?: Fetcher | null;
  /**
   * Belief profile the deterministic stand-in upstream draws from, selected per window.
   * Real deployments leave this undefined and sample live providers instead.
   */
  beliefsFor?: (windowLabel: string) => BeliefProfile | null;
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

export const SAMPLE_CSV = `gsc,best l1 blockchain for payments,880
gsc,vanar chain vs base,320
support_chat,how do I migrate my VANRY tokens,210
sales_call,is Vanar legitimate,140
gsc,where can I buy VANRY,260
community,vanar chain transaction fees,180`;

export function buildServer(opts: ServerOptions): FastifyInstance {
  const { db } = opts;
  const app = Fastify({ logger: opts.logger ?? false });
  // Exposed for the test harness, which needs the session's CSRF token to post a form.
  (app as unknown as { db: DB }).db = db;

  // Every route as Fastify actually registered it. printRoutes renders a tree, which is for
  // reading, not for checking; this is the list the role assertion and its test both use.
  const registered: Array<{ method: string; url: string }> = [];
  (app as unknown as { registeredRoutes: typeof registered }).registeredRoutes = registered;
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) registered.push({ method: String(method).toUpperCase(), url: route.url });
  });

  app.register(cookie);
  app.register(formbody);
  app.register(fastifyStatic, { root: join(here, 'web', 'public'), prefix: '/static/' });

  const clock = opts.clock ?? systemClock;
  const limiter = new RateLimiter(clock);
  const transports = opts.transports ?? {};
  const fetcher = opts.fetcher ?? null;

  // ------------------------------------------------------------------- auth
  function auth(req: FastifyRequest): Auth | null {
    const sid = req.cookies?.aops;
    if (!sid) return null;
    const s = repo.getSession(db, sid);
    if (!s) return null;
    return { tenantId: s.tenant_id, userId: s.user_id, email: s.email, role: s.role, csrf: s.csrf ?? '' };
  }

  /**
   * Effective role for a brand: the per-brand row if there is one, otherwise the user's own
   * role. An agency analyst can hold editor on one client and viewer on another.
   */
  function roleFor(a: Auth, brandId: string | null): string {
    if (!brandId) return a.role;
    return agency.brandRole(db, a.tenantId, a.userId, brandId) ?? a.role;
  }

  function ctx(a: Auth | null, active: string): NavContext {
    if (!a) return { email: null, tenantName: null, brandName: null, active, csrf: '', brands: [], brandId: null, role: null };
    const tenant = repo.getTenant(db, a.tenantId);
    const brands = repo.listBrands(db, a.tenantId);
    const brand = currentBrand(a, null);
    return {
      email: a.email,
      tenantName: tenant?.name ?? '',
      brandName: brand?.name ?? '',
      active,
      csrf: a.csrf,
      brands: brands.map((b) => ({ id: b.id, name: b.name })),
      brandId: brand?.id ?? null,
      role: roleFor(a, brand?.id ?? null),
    };
  }

  /** The brand in focus: an explicit cookie if it still resolves, else the first one. */
  function currentBrand(a: Auth, req: FastifyRequest | null): repo.Row | undefined {
    const wanted = req?.cookies?.brand ?? lastBrand.get(a.userId) ?? null;
    if (wanted) {
      const b = repo.getBrand(db, a.tenantId, wanted);
      if (b) return b;
    }
    return repo.primaryBrand(db, a.tenantId);
  }

  // Remembering the switcher choice per user keeps ctx() honest without threading the request
  // through every render. It is a UI convenience; nothing about access depends on it.
  const lastBrand = new Map<string, string>();

  function requireAuth(req: FastifyRequest, reply: FastifyReply): Auth | null {
    const a = auth(req);
    if (!a) {
      reply.redirect('/login');
      return null;
    }
    return a;
  }

  function brandOf(a: Auth, req?: FastifyRequest): repo.Row {
    const brand = currentBrand(a, req ?? null);
    if (!brand) throw new Error('no brand configured for this tenant');
    return brand;
  }

  function send(reply: FastifyReply, title: string, a: Auth | null, active: string, body: any): FastifyReply {
    return reply.type('text/html; charset=utf-8').send(page(title, ctx(a, active), body));
  }

  function msgOf(req: FastifyRequest): { text: string | null; kind: 'ok' | 'error' } {
    const q = req.query as Record<string, string | undefined>;
    return { text: q.msg ?? null, kind: q.kind === 'error' ? 'error' : 'ok' };
  }

  function redirectWith(reply: FastifyReply, path: string, text: string, kind: 'ok' | 'error' = 'ok'): FastifyReply {
    const sep = path.includes('?') ? '&' : '?';
    return reply.redirect(`${path}${sep}msg=${encodeURIComponent(text)}&kind=${kind}`);
  }

  /**
   * One gate for every mutating request: rate limit, CSRF token, minimum role.
   *
   * It lives in a hook rather than in each handler because the failure mode of per-handler
   * checks is a new route that quietly has none. A boot assertion below refuses to start if a
   * non-GET route is registered without a declared minimum role.
   */
  app.addHook('preHandler', async (req, reply) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    const pattern = (req as any).routeOptions?.url ?? req.url;
    const key = routeKey(method, pattern);

    // Routes that count failures are limited inside their handler, once the outcome is known.
    if (LIMIT_ON_FAILURE.has(key)) return;
    const limit = limiter.check(key, req.ip ?? 'unknown');
    if (!limit.ok) {
      return reply.code(429).header('retry-after', String(limit.retryAfterSec)).send({
        error: 'too many requests',
        retryAfterSeconds: limit.retryAfterSec,
      });
    }

    if (CSRF_EXEMPT.has(key)) return;
    const a = auth(req);

    // CSRF. A JSON body is exempt because a cross-site HTML form cannot send
    // application/json, which is the only way a browser could forge one of these without a
    // CORS preflight the browser will refuse. Form posts carry the token.
    const isJson = (req.headers['content-type'] ?? '').includes('application/json');
    if (a && !isJson) {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const supplied = String(body._csrf ?? req.headers['x-csrf-token'] ?? '');
      if (!supplied || supplied !== a.csrf) {
        repo.audit(db, a.tenantId, a.email, 'csrf_rejected', 'route', key, '');
        return reply.code(403).type('text/html').send(forbidden('That form was missing its security token. Reload the page and try again.'));
      }
    }

    const minimum = ROUTE_ROLES[key];
    if (minimum && a) {
      const brandId = currentBrand(a, req)?.id ?? null;
      const effective = roleFor(a, brandId);
      if (!allows(effective, minimum)) {
        repo.audit(db, a.tenantId, a.email, 'role_denied', 'route', key, `needs ${minimum}, has ${effective}`);
        return reply.code(403).type('text/html').send(forbidden(`This action needs the ${minimum} role. Yours is ${effective}.`));
      }
    }
  });

  // ------------------------------------------------------------------ login
  app.get('/login', async (req, reply) => {
    if (auth(req)) return reply.redirect('/');
    const { text } = msgOf(req);
    return send(reply, 'Sign in', null, 'login', loginView(text, opts.demoHint ?? null));
  });

  app.post('/login', async (req, reply) => {
    const body = req.body as Record<string, string>;
    const user = repo.findUserByEmail(db, body.email ?? '');
    if (!user || !verifyPassword(body.password ?? '', user.password_hash, user.password_salt)) {
      // Only failures count toward the limit, so a busy office does not lock itself out.
      const limit = limiter.check('POST /login', req.ip ?? 'unknown');
      if (!limit.ok) {
        return reply.code(429).header('retry-after', String(limit.retryAfterSec)).type('text/html')
          .send(forbidden(`Too many failed sign-in attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minutes.`));
      }
      return redirectWith(reply, '/login', 'Those credentials do not match an account.', 'error');
    }
    const sid = randomBytes(32).toString('hex');
    repo.createSession(db, user.tenant_id, user.id, sid, 24, randomBytes(24).toString('hex'));
    repo.audit(db, user.tenant_id, user.email, 'login', 'user', user.id, '');
    reply.setCookie('aops', sid, { path: '/', httpOnly: true, sameSite: 'lax' });
    return reply.redirect('/');
  });

  app.post('/logout', async (req, reply) => {
    const sid = req.cookies?.aops;
    if (sid) repo.deleteSession(db, sid);
    reply.clearCookie('aops', { path: '/' });
    return reply.redirect('/login');
  });

  // --------------------------------------------------------- the public page
  // The root is the only unauthenticated page that renders content. Every route that
  // touches workspace data still goes through requireAuth, so anonymous access buys a
  // marketing document and nothing else.
  const PUBLIC_DESCRIPTION =
    'Miscited finds the wrong answers AI gives about your company, helps you correct the record they '
    + 'came from, and proves the correction worked. ' +
    'Every rate ships with its 95% interval and its sample size, or it is not shown.';

  app.post('/audit-request', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = AuditRequest.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid request' });
    }
    const domain = parsed.data.domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    const requestId = newId('req');
    db.prepare(
      'INSERT INTO audit_requests (id, email, domain, source, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(requestId, parsed.data.email.trim().toLowerCase(), domain, 'public_site', nowIso());

    // The audit itself. It used to be a person; now the request creates a report and the
    // pipeline runs against the domain unattended. The response returns the report URL
    // immediately, because a page that says "we will email you" and then does not is worse
    // than one that says nothing.
    const report = createAuditReport(db, requestId, domain);
    if (fetcher) {
      void runAudit(db, report.id, {
        fetcher,
        clock,
        beliefs: opts.beliefsFor?.('audit') ?? null,
        budgetRuns: Number(process.env.MISCITED_AUDIT_RUNS ?? 40),
      }).catch(() => undefined);
    }
    return reply.code(201).send({ ok: true, domain, reportUrl: `/audit/${report.token}` });
  });

  // -------------------------------------------------------------- dashboard
  app.get('/', async (req, reply) => {
    const a = auth(req);
    if (!a) {
      return reply
        .type('text/html; charset=utf-8')
        .send(marketingPage('Miscited · quality control for what AI says about your company', PUBLIC_DESCRIPTION, landingView({ liveProviders: liveProviderCount() })));
    }
    const brand = brandOf(a);
    const requestedWindow = (req.query as Record<string, string | undefined>).window ?? null;
    const data = buildDashboard(db, a.tenantId, brand.id, requestedWindow);
    const { text, kind } = msgOf(req);
    return send(reply, 'Answer desk', a, 'dashboard', concat(flash(text, kind), dashboardView(data)));
  });

  app.get('/defect/:key', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const key = decodeURIComponent((req.params as any).key);
    const data = buildDashboard(db, a.tenantId, brand.id);
    const item = data.defects.find((d) => d.misconceptionKey === key);
    if (!item) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'dashboard'), notFound()));

    const runs = repo.runsWithMisconception(db, a.tenantId, brand.id, key, data.window).slice(0, 6);
    const runBundles = runs.map((run) => ({
      run,
      statements: repo.observedForRun(db, a.tenantId, run.id).filter((o) => o.misconception_key === key),
      citations: repo.citationsForRun(db, a.tenantId, run.id),
    }));
    const evidenceIds = runBundles.flatMap((r) => r.statements.map((s: any) => s.id)).slice(0, 12);
    const canonical = item.canonicalClaimId ? repo.getCanonicalClaim(db, a.tenantId, item.canonicalClaimId) : null;
    const actions = repo.listActions(db, a.tenantId, brand.id).filter((ac) => {
      const f = jsonParse<any>(ac.priority_factors, {});
      return f.misconceptionKey === key;
    });
    const grounding = runs[0]?.grounding ?? 'grounded_search';
    const botClass = relevantBotClassFor(grounding);

    const { text, kind } = msgOf(req);
    return send(
      reply,
      'Defect',
      a,
      'dashboard',
      concat(
        flash(text, kind),
        defectDetailView({
          headline: item.headline,
          verdict: item.verdict,
          severity: item.severity,
          measurement: item.measurement,
          priorityExplanation: item.priorityExplanation,
          canonical,
          runs: runBundles,
          suggestedActionType: item.suggestedActionType,
          misconceptionKey: key,
          defectSubject: predicateLabel(key.split('.')[1] ?? ''),
          clusterId: item.clusterIds[0] ?? null,
          clusterLabel: item.clusterLabels[0] ?? null,
          treatmentClusterIds: item.clusterIds,
          evidenceIds,
          actions,
          expected: null,
          crawlerNote: `These answers were produced with grounding "${grounding}", so the crawler class that can affect them is ${BOT_CLASS_LABEL[botClass]} — not training ingestion.`,
        }),
      ),
    );
  });

  // ----------------------------------------------------------------- demand
  app.get('/clusters', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const { text, kind } = msgOf(req);
    return send(
      reply,
      'Demand',
      a,
      'clusters',
      concat(
        flash(text, kind),
        clustersView({
          clusters: repo.listClusters(db, a.tenantId, brand.id),
          signals: repo.listDemandSignals(db, a.tenantId, brand.id),
          byFamily: familyCounts(db, a.tenantId, brand.id),
          sampleCsv: SAMPLE_CSV,
        }),
      ),
    );
  });

  app.post('/demand/import', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const body = req.body as Record<string, string>;
    const { rows, rejected } = parseDemandCsv(body.csv ?? '');
    if (rows.length === 0) {
      return redirectWith(reply, '/clusters', 'No usable rows. Every question must name the source it came from.', 'error');
    }
    const result = importDemand(db, a.tenantId, brand.id, rows, a.email, rejected);
    return redirectWith(
      reply,
      '/clusters',
      `Imported ${result.signalsImported} signals into ${result.clustersCreated} clusters (${result.variantsCreated} prompt variants)${result.rejected.length ? `; ${result.rejected.length} rejected` : ''}.`,
    );
  });

  app.get('/demand/:id', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const cluster = repo.getCluster(db, a.tenantId, (req.params as any).id);
    if (!cluster) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'clusters'), notFound()));
    const { current } = latestWindow(db, a.tenantId, brand.id);
    const runs = repo.runsForCluster(db, a.tenantId, cluster.id, current);
    let absent = 0;
    for (const r of runs) {
      const obs = repo.observedForRun(db, a.tenantId, r.id);
      if ((obs[0]?.brand_role ?? 'absent') === 'absent') absent++;
    }
    const signals = repo.listDemandSignals(db, a.tenantId, brand.id).filter((s) => s.cluster_id === cluster.id);
    return send(
      reply,
      cluster.label,
      a,
      'clusters',
      clusterDetailView({ cluster, variants: repo.listVariants(db, a.tenantId, cluster.id), runs, absence: measure(absent, runs.length), signals }),
    );
  });

  // ------------------------------------------------------------------ truth
  app.get('/truth', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const { text, kind } = msgOf(req);
    const claims = repo.listCanonicalClaims(db, a.tenantId, brand.id);
    return send(reply, 'Truth registry', a, 'truth', concat(flash(text, kind), truthView({
      claims,
      sources: repo.listTruthSources(db, a.tenantId, brand.id),
      brandName: brand.name,
      grouped: [],
    })));
  });

  app.post('/truth', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const b = req.body as Record<string, string>;
    if (!b.predicate?.trim() || !b.object?.trim() || !b.claim_text?.trim()) {
      return redirectWith(reply, '/truth', 'A canonical fact needs a predicate, an object and a human-readable statement.', 'error');
    }
    const created = repo.createCanonicalClaim(db, a.tenantId, brand.id, {
      subject: b.subject?.trim() || brand.name,
      predicate: b.predicate.trim(),
      object: b.object.trim(),
      claim_text: b.claim_text.trim(),
      effective_from: (b.effective_from || new Date().toISOString().slice(0, 10)) + 'T00:00:00.000Z',
      sensitivity: b.sensitivity || 'routine',
    });
    if (b.supersedes) {
      repo.supersedeClaim(db, a.tenantId, b.supersedes, created.id, created.effective_from);
      repo.audit(db, a.tenantId, a.email, 'claim_superseded', 'canonical_claim', b.supersedes, `superseded by ${created.id}`);
    }
    repo.audit(db, a.tenantId, a.email, 'claim_created', 'canonical_claim', created.id, created.claim_text);
    return redirectWith(reply, '/truth', 'Fact recorded. It must be approved before it can produce defects.');
  });

  app.post('/truth/:id/approve', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const claimId = (req.params as any).id;
    const claim = repo.getCanonicalClaim(db, a.tenantId, claimId);
    if (!claim) return reply.code(404).send('not found');
    repo.approveClaim(db, a.tenantId, claimId, a.email);
    repo.audit(db, a.tenantId, a.email, 'claim_approved', 'canonical_claim', claimId, claim.claim_text);
    return redirectWith(reply, '/truth', 'Fact approved.');
  });

  app.get('/truth/:id', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const claim = repo.getCanonicalClaim(db, a.tenantId, (req.params as any).id);
    if (!claim) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'truth'), notFound()));
    const all = repo.listCanonicalClaims(db, a.tenantId, brand.id).map(toCanonical);
    const rows = truthHistory(all, claim.subject, claim.predicate);
    const byId = new Map(repo.listCanonicalClaims(db, a.tenantId, brand.id).map((r) => [r.id, r]));
    return send(reply, 'Fact history', a, 'truth', truthHistoryView({
      subject: claim.subject,
      predicate: claim.predicate,
      rows: rows.map((r) => byId.get(r.id)),
    }));
  });

  // ------------------------------------------------------------- observatory
  app.get('/observatory', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const { text, kind } = msgOf(req);
    const runs = repo.listRuns(db, a.tenantId, brand.id, 200);
    return send(reply, 'Observatory', a, 'observatory', concat(flash(text, kind), observatoryView({
      runs,
      surfaces: [...new Set(runs.map((r) => `${r.provider}/${r.model_id}`))],
      windows: [...new Set(runs.map((r) => r.window_label))],
      lastResult: null,
    })));
  });

  app.post('/sampling/run', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const b = req.body as Record<string, string>;
    const windowLabel = (b.window_label || 'post').trim();
    const budget = Math.max(5, Math.min(600, Number(b.budget) || 60));
    const result = await runSamplingRound(db, {
      tenantId: a.tenantId,
      brandId: brand.id,
      windowLabel,
      budget,
      actor: a.email,
      beliefs: opts.beliefsFor?.(windowLabel) ?? null,
      samplingReason: 'manual',
      seedOffset: windowLabel === 'baseline' ? 0 : 100000,
    });
    return redirectWith(
      reply,
      '/observatory',
      `Sampled ${result.runsCreated} answers across ${result.clustersSampled} clusters in window "${windowLabel}": ${result.defects} defective claims, ${result.citations} citations checked, $${result.costUsd.toFixed(3)} spent.`,
    );
  });

  app.get('/runs/:id', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const run = repo.getRun(db, a.tenantId, (req.params as any).id);
    if (!run) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'observatory'), notFound()));
    const { text, kind } = msgOf(req);
    return send(reply, 'Run', a, 'observatory', concat(flash(text, kind), runDetailView({
      run,
      observed: repo.observedForRun(db, a.tenantId, run.id),
      citations: repo.citationsForRun(db, a.tenantId, run.id),
      searchQueries: jsonParse<string[]>(run.search_queries, []),
    })));
  });

  // ---------------------------------------------------------------- actions
  app.get('/actions', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const { text, kind } = msgOf(req);
    return send(reply, 'Actions', a, 'actions', concat(flash(text, kind), actionsView({ actions: repo.listActions(db, a.tenantId, brand.id) })));
  });

  app.post('/actions', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const b = req.body as Record<string, string>;
    const evidence = b.drop_evidence === '1' ? [] : (b.evidence ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const back = b.misconception_key ? `/defect/${encodeURIComponent(b.misconception_key)}` : '/actions';
    try {
      const action = createAction(db, {
        tenantId: a.tenantId,
        brandId: brand.id,
        clusterId: b.cluster_id || null,
        treatmentClusterIds: (b.treatment_clusters ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        actionType: b.action_type,
        title: b.title?.trim() || 'Untitled action',
        rationale: b.rationale?.trim() || '',
        evidence,
        assumptions: [],
        misconceptionKey: b.misconception_key || null,
        grounding: 'grounded_search',
        actor: a.email,
      });
      return redirectWith(reply, `/actions/${action.id}`, 'Action created with evidence attached.');
    } catch (err) {
      if (err instanceof MissingEvidenceError || err instanceof UnknownActionTypeError) {
        return redirectWith(reply, back, err.message, 'error');
      }
      throw err;
    }
  });

  app.get('/actions/:id', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const action = repo.getAction(db, a.tenantId, (req.params as any).id);
    if (!action) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'actions'), notFound()));
    const { text, kind } = msgOf(req);
    return send(reply, action.title, a, 'actions', concat(flash(text, kind), actionDetailView({
      action,
      transitions: repo.listTransitions(db, a.tenantId, action.id),
      evidence: jsonParse<string[]>(action.evidence, []),
      assumptions: jsonParse<string[]>(action.assumptions, []),
      factors: jsonParse<any>(action.priority_factors, {}),
      experiment: action.experiment_id ? repo.getExperiment(db, a.tenantId, action.experiment_id) : null,
      next: ALLOWED_TRANSITIONS[action.state as ActionState] ?? [],
    })));
  });

  app.post('/actions/:id/transition', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const actionId = (req.params as any).id;
    const b = req.body as Record<string, string>;
    try {
      transitionAction(db, { tenantId: a.tenantId, actionId, to: b.to as ActionState, actor: a.email, note: b.note ?? '' });
      return redirectWith(reply, `/actions/${actionId}`, `Advanced to ${b.to}.`);
    } catch (err) {
      if (err instanceof IllegalTransitionError) return redirectWith(reply, `/actions/${actionId}`, err.message, 'error');
      throw err;
    }
  });

  // ------------------------------------------------------------ experiments
  app.get('/experiments', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const experiments = repo.listExperiments(db, a.tenantId, brand.id);
    const actionsById: Record<string, any> = {};
    for (const e of experiments) {
      const ac = repo.getAction(db, a.tenantId, e.action_id);
      if (ac) actionsById[e.action_id] = ac;
    }
    const { text, kind } = msgOf(req);
    return send(reply, 'Experiments', a, 'experiments', concat(flash(text, kind), experimentsView({ experiments, actionsById })));
  });

  app.get('/experiments/:id', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const exp = repo.getExperiment(db, a.tenantId, (req.params as any).id);
    if (!exp) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'experiments'), notFound()));
    const analysis = analyzeExperiment(
      {
        baselineK: exp.baseline_k ?? 0, baselineN: exp.baseline_n ?? 0,
        postK: exp.post_k ?? 0, postN: exp.post_n ?? 0,
        controlBaselineK: exp.control_baseline_k, controlBaselineN: exp.control_baseline_n,
        controlPostK: exp.control_post_k, controlPostN: exp.control_post_n,
      },
      Boolean(exp.control_baseline_n),
    );
    const labelOf = (cid: string) => repo.getCluster(db, a.tenantId, cid)?.label ?? cid;
    const { text, kind } = msgOf(req);
    return send(reply, 'Experiment', a, 'experiments', concat(flash(text, kind), experimentDetailView({
      experiment: exp,
      action: repo.getAction(db, a.tenantId, exp.action_id) ?? null,
      analysis: {
        narrative: exp.verdict === 'pending' ? 'Not analyzed yet — press “Analyze from stored runs”.' : analysis.narrative,
        alternatives: jsonParse<string[]>(exp.alternative_explanations, analysis.alternativeExplanations),
      },
      outcomes: repo.outcomesForExperiment(db, a.tenantId, exp.id),
      treatmentLabels: jsonParse<string[]>(exp.treatment_clusters, []).map(labelOf),
      controlLabels: jsonParse<string[]>(exp.control_clusters, []).map(labelOf),
    })));
  });

  app.post('/experiments/:id/analyze', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const expId = (req.params as any).id;
    const exp = repo.getExperiment(db, a.tenantId, expId);
    if (!exp) return reply.code(404).send('not found');
    const updated = analyzeExperimentForAction(db, a.tenantId, expId, a.email);
    return redirectWith(reply, `/experiments/${expId}`, `Analyzed: ${updated.verdict} (p=${formatP(Number(updated.p_value))}).`);
  });

  // --------------------------------------------------------------- crawlers
  app.get('/crawlers', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const events = repo.listCrawlerEvents(db, a.tenantId, brand.id);
    const findings = summariseBlocks(
      events.map((e) => ({ botClass: e.bot_class, botName: e.bot_name, statusCode: e.status_code, blockedBy: e.blocked_by })),
    );
    const byClass: Record<string, any[]> = {};
    for (const e of events) byClass[e.bot_class] = [...(byClass[e.bot_class] ?? []), e];
    return send(reply, 'Crawlers', a, 'crawlers', crawlersView({ byClass, findings, total: events.length }));
  });

  // --------------------------------------------------------------- entities
  app.get('/entities', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const { text, kind } = msgOf(req);
    return send(reply, 'Entities', a, 'entities', concat(flash(text, kind), entitiesView({ relationships: repo.listRelationships(db, a.tenantId, brand.id) })));
  });

  app.post('/entities/:id/classify', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a);
    const entityId = (req.params as any).id;
    const b = req.body as Record<string, string>;
    try {
      const relation = resolveRelation(b.relation as Relation, b.basis as RelationBasis);
      repo.upsertRelationship(db, a.tenantId, brand.id, entityId, relation, b.basis, 0.9, `Classified by ${a.email}`);
      repo.audit(db, a.tenantId, a.email, 'entity_classified', 'entity', entityId, `${relation} via ${b.basis}`);
      return redirectWith(reply, '/entities', `Relationship set to ${relation}.`);
    } catch (err) {
      if (err instanceof WeakBasisError) return redirectWith(reply, '/entities', err.message, 'error');
      throw err;
    }
  });

  // ------------------------------------------------------------ methodology
  app.get('/methodology', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    return send(reply, 'Methodology', a, 'methodology', methodologyView({
      stats: { minSamples: MIN_SAMPLES, maxSamples: MAX_SAMPLES, alpha: ALPHA, minEffect: MIN_EFFECT, bhQ: BH_Q, fixability: FIXABILITY },
      extractor: extractorEval(),
      prices: { table: PRICE_TABLE, reviewed: PRICE_TABLE_REVIEWED },
      retentionDays: SNAPSHOT_RETENTION_DAYS,
      snapshotCount: snapsRepo.countSnapshots(db),
    }));
  });

  app.get('/audit', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    return send(reply, 'Audit', a, 'audit', auditView({ rows: repo.listAudit(db, a.tenantId) }));
  });

  // -------------------------------------------------------------------- API
  app.get('/api/dashboard', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    const brand = brandOf(a);
    return reply.send(buildDashboard(db, a.tenantId, brand.id));
  });

  app.get('/api/methodology', async (_req, reply) =>
    reply.send({
      minSamples: MIN_SAMPLES,
      maxSamples: MAX_SAMPLES,
      interval: 'wilson_95',
      alerting: { test: 'two_proportion_z', alpha: ALPHA, minEffect: MIN_EFFECT, multipleComparisons: 'benjamini_hochberg', q: BH_Q },
      suppressBelowFloor: true,
      blendedScore: false,
      revenueAttribution: 'correlational_only',
      simulatedRunsExcludedFromClaims: true,
    }),
  );

  app.get('/api/clusters', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    const brand = brandOf(a);
    return reply.send(repo.listClusters(db, a.tenantId, brand.id));
  });

  app.get('/api/runs/:id', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    const run = repo.getRun(db, a.tenantId, (req.params as any).id);
    // 404 rather than 403 across tenants: a 403 confirms the row exists.
    if (!run) return reply.code(404).send({ error: 'not_found' });
    return reply.send({
      run,
      observed: repo.observedForRun(db, a.tenantId, run.id),
      citations: repo.citationsForRun(db, a.tenantId, run.id),
    });
  });

  app.get('/api/actions/:id', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    const action = repo.getAction(db, a.tenantId, (req.params as any).id);
    if (!action) return reply.code(404).send({ error: 'not_found' });
    return reply.send(action);
  });

  app.post('/api/actions', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    const brand = brandOf(a);
    const b = (req.body ?? {}) as any;
    try {
      const action = createAction(db, {
        tenantId: a.tenantId,
        brandId: brand.id,
        clusterId: b.clusterId ?? null,
        treatmentClusterIds: b.treatmentClusterIds ?? [],
        actionType: b.actionType,
        title: b.title ?? 'Untitled',
        rationale: b.rationale ?? '',
        evidence: b.evidence ?? [],
        assumptions: b.assumptions ?? [],
        misconceptionKey: b.misconceptionKey ?? null,
        actor: a.email,
      });
      return reply.code(201).send(action);
    } catch (err: any) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
  });

  app.post('/api/actions/:id/transition', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    const b = (req.body ?? {}) as any;
    try {
      const updated = transitionAction(db, { tenantId: a.tenantId, actionId: (req.params as any).id, to: b.to, actor: a.email, note: b.note });
      return reply.send(updated);
    } catch (err: any) {
      if (err.name === 'IllegalTransitionError') return reply.code(409).send({ error: err.name, message: err.message });
      return reply.code(404).send({ error: 'not_found' });
    }
  });

  app.get('/api/experiments/:id', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    const exp = repo.getExperiment(db, a.tenantId, (req.params as any).id);
    if (!exp) return reply.code(404).send({ error: 'not_found' });
    return reply.send(exp);
  });

  app.post('/api/runs/sample', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    const brand = brandOf(a);
    const b = (req.body ?? {}) as any;
    const result = await runSamplingRound(db, {
      tenantId: a.tenantId,
      brandId: brand.id,
      windowLabel: b.window ?? 'post',
      budget: b.budget ?? 60,
      actor: a.email,
      beliefs: opts.beliefsFor?.(b.window ?? 'post') ?? null,
      seedOffset: b.seedOffset ?? 0,
    });
    return reply.send(result);
  });

  app.get('/api/audit', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    return reply.send(repo.listAudit(db, a.tenantId));
  });


  // ------------------------------------------------------------- schedules (P1)
  app.get('/schedules', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a, req);
    const { text, kind } = msgOf(req);
    const month = monthKey(clock.now());
    return send(reply, 'Schedules', a, 'schedules', concat(flash(text, kind), schedulesView({
      schedules: sched.listSchedules(db, a.tenantId),
      brands: repo.listBrands(db, a.tenantId),
      spend: sched.monthToDateSpend(db, a.tenantId, month),
      month,
      byProvider: sched.spendByProvider(db, a.tenantId, month),
      windows: sched.listWindows(db, a.tenantId, brand.id),
      lastTick: null,
    })));
  });

  app.post('/schedules', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const b = req.body as Record<string, string>;
    const cadence = (CADENCES as string[]).includes(b.cadence) ? (b.cadence as Cadence) : 'daily';
    const brandId = b.brand_id && repo.getBrand(db, a.tenantId, b.brand_id) ? b.brand_id : brandOf(a, req).id;
    sched.createSchedule(db, a.tenantId, {
      brand_id: brandId,
      cadence,
      hour_utc: 6,
      monthly_budget_usd: Math.max(10, Math.min(100000, Number(b.monthly_budget_usd) || 500)),
      budget_runs: Math.max(MIN_SAMPLES, Math.min(600, Number(b.budget_runs) || 60)),
      next_run_at: computeNextRun(cadence, clock.now(), 6).toISOString(),
    });
    repo.audit(db, a.tenantId, a.email, 'schedule_created', 'brand', brandId, `cadence=${cadence}`);
    return redirectWith(reply, '/schedules', `A ${cadence} schedule is set. The next round runs without anyone asking.`);
  });

  app.post('/schedules/:id/toggle', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const s = sched.getSchedule(db, a.tenantId, (req.params as any).id);
    if (!s) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'schedules'), notFound()));
    sched.setScheduleEnabled(db, a.tenantId, s.id, s.enabled === 1 ? 0 : 1);
    repo.audit(db, a.tenantId, a.email, s.enabled === 1 ? 'schedule_paused' : 'schedule_resumed', 'schedule', s.id, '');
    return redirectWith(reply, '/schedules', s.enabled === 1 ? 'Schedule paused. Nothing will sample on its own until you resume it.' : 'Schedule resumed.');
  });

  /** Force one schedule due now and run a tick, so "does this actually work" is one click. */
  app.post('/schedules/:id/run', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const s = sched.getSchedule(db, a.tenantId, (req.params as any).id);
    if (!s) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'schedules'), notFound()));
    sched.updateScheduleNextRun(db, a.tenantId, s.id, new Date(clock.now().getTime() - 1000).toISOString());
    const result = await tick(db, {
      clock,
      owner: `manual-${a.userId.slice(0, 8)}`,
      beliefsFor: opts.beliefsFor,
      fetcher,
      transports,
    });
    return redirectWith(
      reply,
      '/schedules',
      result.ran > 0
        ? `Ran ${result.ran} scheduled round(s) covering ${result.windows.join(', ')}; ${result.alertsCreated} alerts raised, ${result.delivered} delivered.`
        : `Nothing ran. ${result.errors.join('; ') || 'The schedule was not due or is already leased.'}`,
      result.ran > 0 ? 'ok' : 'error',
    );
  });

  // ---------------------------------------------------------------- alerts (P1)
  app.get('/alerts', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a, req);
    const { text, kind } = msgOf(req);
    return send(reply, 'Alerts', a, 'alerts', concat(flash(text, kind), alertsView({
      alerts: sched.listAlertsFor(db, a.tenantId, brand.id),
      channels: sched.listChannels(db, a.tenantId),
      attempts: sched.listAttempts(db, a.tenantId),
    })));
  });

  app.post('/channels', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const b = req.body as Record<string, string>;
    const kind = ['email', 'slack', 'webhook'].includes(b.kind) ? b.kind : 'email';
    const target = (b.target ?? '').trim();
    if (!target) return redirectWith(reply, '/alerts', 'A channel needs an address or URL.', 'error');
    sched.createChannel(db, a.tenantId, {
      kind,
      target,
      secret: randomBytes(16).toString('hex'),
      min_severity: ['low', 'medium', 'high', 'critical'].includes(b.min_severity) ? b.min_severity : 'high',
    });
    repo.audit(db, a.tenantId, a.email, 'channel_created', 'channel', target, kind);
    return redirectWith(reply, '/alerts', `Alerts will now go to ${target}.`);
  });

  app.post('/channels/:id/delete', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    sched.deleteChannel(db, a.tenantId, (req.params as any).id);
    repo.audit(db, a.tenantId, a.email, 'channel_deleted', 'channel', (req.params as any).id, '');
    return redirectWith(reply, '/alerts', 'Channel removed.');
  });

  app.post('/channels/:id/test', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const channel = sched.getChannel(db, a.tenantId, (req.params as any).id);
    if (!channel) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'alerts'), notFound()));
    const transport = transports[channel.kind];
    if (!transport) return redirectWith(reply, '/alerts', `No transport is configured for ${channel.kind} in this deployment.`, 'error');
    const body = JSON.stringify({ kind: 'test', at: clock.now().toISOString() });
    const res = await transport.send({
      kind: 'alert',
      subject: 'Miscited: delivery test',
      text: 'This is a delivery test. If you can read it, this channel works.',
      target: channel.target,
      secret: channel.secret ?? '',
      body,
    });
    sched.recordAttempt(db, a.tenantId, { channel_id: channel.id, kind: 'alert', attempt: 1, status: res.ok ? 'sent' : 'failed', error: res.error ?? '' });
    return redirectWith(reply, '/alerts', res.ok ? 'Test delivered.' : `Test failed: ${res.error}`, res.ok ? 'ok' : 'error');
  });

  app.post('/alerts/:id/read', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    sched.markAlertDelivered(db, a.tenantId, (req.params as any).id, clock.now().toISOString());
    return redirectWith(reply, '/alerts', 'Marked as seen.');
  });

  // -------------------------------------------------------------- evidence (P2)
  app.get('/snapshot/:sha', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const snapshot = snapsRepo.getSnapshot(db, (req.params as any).sha);
    if (!snapshot) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'observatory'), notFound()));
    return send(reply, 'Snapshot', a, 'observatory', snapshotView({ snapshot, citation: null }));
  });

  app.post('/citations/:id/recheck', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const citation = repo.getCitation(db, a.tenantId, (req.params as any).id);
    if (!citation) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'observatory'), notFound()));
    if (!fetcher) return redirectWith(reply, `/runs/${citation.run_id}`, 'Citation fetching is disabled in this deployment.', 'error');
    const result = await recheckCitation(db, a.tenantId, citation.id, fetcher, clock);
    const message = result.error
      ? `Re-check could not read the page (${result.error}).`
      : result.changed
        ? `Support changed from ${result.before} to ${result.after}.${result.regressed ? ' That is a regression, and an alert was raised.' : ''}`
        : `No change: still ${result.after}.`;
    return redirectWith(reply, `/runs/${citation.run_id}`, message, result.error ? 'error' : 'ok');
  });

  // ------------------------------------------------------------- agency (P6)
  app.post('/brands/switch', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const b = req.body as Record<string, string>;
    const brand = repo.getBrand(db, a.tenantId, b.brand_id ?? '');
    if (!brand) return redirectWith(reply, '/portfolio', 'That brand is not in this workspace.', 'error');
    lastBrand.set(a.userId, brand.id);
    reply.setCookie('brand', brand.id, { path: '/', httpOnly: true, sameSite: 'lax' });
    return redirectWith(reply, '/', `Now showing ${brand.name}.`);
  });

  app.get('/portfolio', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const { text, kind } = msgOf(req);
    const rows = repo.listBrands(db, a.tenantId).map((brand) => {
      const windows = sched.listWindows(db, a.tenantId, brand.id);
      const last = windows[0] ?? null;
      const label = last?.window_label ?? latestWindow(db, a.tenantId, brand.id).current;
      let critical = 0;
      let defects = 0;
      let runs = 0;
      try {
        const data = buildDashboard(db, a.tenantId, brand.id, label);
        critical = data.defects.filter((d) => d.severity === 'critical').length;
        defects = data.defects.length;
        runs = data.totalRuns;
      } catch {
        // A brand with no runs has no dashboard yet, which is a zero row rather than an error.
      }
      return { brand, critical, defects, runs, lastWindow: label, partial: last?.status === 'partial' };
    });
    rows.sort((x, y) => y.critical - x.critical || y.defects - x.defects);
    return send(reply, 'Portfolio', a, 'portfolio', concat(flash(text, kind), portfolioView({ rows })));
  });

  app.get('/clusters/:id/markets', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const brand = brandOf(a, req);
    const cluster = repo.getCluster(db, a.tenantId, (req.params as any).id);
    if (!cluster) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'clusters'), notFound()));
    const { text, kind } = msgOf(req);
    return send(reply, 'Markets', a, 'clusters', concat(flash(text, kind), marketsView({
      cluster,
      variants: repo.listVariants(db, a.tenantId, cluster.id),
      breakdown: marketBreakdown(db, a.tenantId, brand.id, latestWindow(db, a.tenantId, brand.id).current),
      geos: jsonParse<string[]>(cluster.geos, ['US']),
      languages: jsonParse<string[]>(cluster.languages, ['en']),
    })));
  });

  app.post('/clusters/:id/markets', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const cluster = repo.getCluster(db, a.tenantId, (req.params as any).id);
    if (!cluster) return reply.code(404).type('text/html').send(page('Not found', ctx(a, 'clusters'), notFound()));
    const b = req.body as Record<string, string | string[]>;
    const chosen = Array.isArray(b.market) ? b.market : b.market ? [b.market] : [];
    const geos = [...new Set(chosen.map((m) => String(m).split(':')[0]))];
    const languages = [...new Set(chosen.map((m) => String(m).split(':')[1] ?? 'en'))];
    const result = setMarkets(db, a.tenantId, cluster.id, geos, languages);
    repo.audit(db, a.tenantId, a.email, 'markets_set', 'cluster', cluster.id, geos.join(','));
    return redirectWith(
      reply,
      `/clusters/${cluster.id}/markets`,
      `${result.created} new market variants created, ${result.kept} already existed. Existing runs are untouched.`,
    );
  });

  // --------------------------------------------------------------- index (P8)
  app.get('/index', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const tenant = repo.getTenant(db, a.tenantId);
    const { text, kind } = msgOf(req);
    return send(reply, 'Accuracy index', a, 'methodology', concat(flash(text, kind), indexView({
      report: buildIndexReport(db, quarterOf(clock.now())),
      consent: tenant?.index_consent === 1,
      tenantName: tenant?.name ?? '',
    })));
  });

  app.post('/index-consent', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    const wants = String((req.body as any)?.consent ?? '0') === '1';
    setConsent(db, a.tenantId, wants, clock.now().toISOString());
    return redirectWith(
      reply,
      '/index',
      wants
        ? `Contributing. Exactly these fields leave this workspace: ${EXPORT_FIELDS.join(', ')}.`
        : 'No longer contributing. The next report excludes this workspace.',
    );
  });

  // ------------------------------------------------- self-serve audit (P4)
  app.get('/audit/:token', async (req, reply) => {
    const report = getAuditReportByToken(db, (req.params as any).token);
    if (!report) {
      return reply.code(404).type('text/html').send(
        reportPage('Not found', 'No such audit.', raw('<h1>Not found</h1><p class="lede">No audit exists at this address.</p>')),
      );
    }
    if (report.status !== 'complete') {
      return reply.type('text/html; charset=utf-8').send(reportPage(
        `Audit of ${report.domain}`,
        'Your answer risk audit is running.',
        raw(`<h1>Auditing ${escapeText(report.domain)}</h1>` +
          `<p class="lede" data-testid="audit-status">Status: ${escapeText(report.status)}.` +
          (report.error ? ` ${escapeText(report.error)}` : ' Reload in a minute; this page fills in when the sample completes.') +
          '</p>'),
      ));
    }
    return reply.type('text/html; charset=utf-8').send(reportPage(
      `Answer risk audit: ${report.brand_name || report.domain}`,
      `A dated, evidence-linked audit of what AI answers say about ${report.domain}.`,
      auditReportView({
        report,
        findings: jsonParse<any>(report.findings, {}),
        candidates: jsonParse<any[]>(report.candidates, []),
        surfaces: jsonParse<string[]>(report.surfaces, []),
        notTested: jsonParse<string[]>(report.not_tested, []),
      }),
    ));
  });

  app.post('/audit/:token/start', async (req, reply) => {
    const b = req.body as Record<string, string>;
    try {
      const out = startMonitoring(db, {
        token: (req.params as any).token,
        email: (b.email ?? '').trim().toLowerCase(),
        password: b.password ?? '',
        clock,
      });
      const sid = randomBytes(32).toString('hex');
      repo.createSession(db, out.tenantId, out.userId, sid, 24, randomBytes(24).toString('hex'));
      reply.setCookie('aops', sid, { path: '/', httpOnly: true, sameSite: 'lax' });
      return reply.redirect('/?msg=' + encodeURIComponent('Monitoring started. The first scheduled round runs tomorrow morning.'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'could not start monitoring';
      return reply.redirect(`/audit/${(req.params as any).token}?msg=${encodeURIComponent(message)}&kind=error`);
    }
  });

  app.get('/audits', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
    return send(reply, 'Audit requests', a, 'audit', auditAdminView({ reports: listAuditReports(db) }));
  });

  app.get('/healthz', async (_req, reply) => reply.send({ ok: true }));

  /**
   * A non-GET route with no declared minimum role is a route nobody decided about. Failing at
   * boot is the only version of this check that cannot be ignored.
   */
  // Synchronous, not inside app.ready(): a ready callback that throws is a warning nobody
  // reads, and the whole point of this check is that it cannot be ignored.
  const undeclared = undeclaredMutatingRoutes(registered);
  if (undeclared.length > 0) {
    throw new Error(
      `These mutating routes have no minimum role in ROUTE_ROLES: ${undeclared.join(', ')}. ` +
        'Add them to src/domain/roles.ts, or to PUBLIC_ROUTES if they are reachable before a session exists.',
    );
  }

  return app;
}

/**
 * Mutating routes with no minimum role. Exported so the boot assertion and its test are the
 * same code: a check the test can pass while the server fails is not a check.
 */
export function undeclaredMutatingRoutes(routes: Array<{ method: string; url: string }>): string[] {
  const out: string[] = [];
  for (const { method, url } of routes) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) continue;
    const key = routeKey(method, url);
    if (!ROUTE_ROLES[key] && !CSRF_EXEMPT.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

function forbidden(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Not permitted</title>` +
    `<link rel="stylesheet" href="/static/app.css"></head><body><main><h1>Not permitted</h1>` +
    `<p class="lede" data-testid="forbidden">${message}</p><p><a href="/">Back to the answer desk</a></p></main></body></html>`;
}

function concat(...parts: Array<Raw | null | undefined>): Raw {
  return raw(parts.map((p) => p?.value ?? '').join(''));
}

/**
 * The published extractor numbers, read from the file the eval writes rather than typed into
 * the template. If nobody has run it, the page says the precision is unmeasured, which is the
 * honest thing for a page whose whole job is to say how the numbers are produced.
 */
export function extractorEval(path = 'docs/extractor-eval.json'): any | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function escapeText(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function notFound(): Raw {
  return raw('<main><h1>Not found</h1><p class="lede">That record does not exist in this workspace.</p></main>');
}
