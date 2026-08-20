import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DB } from './db/index.js';
import { verifyPassword, jsonParse } from './db/index.js';
import * as repo from './db/repo/index.js';
import { page, NavContext, flash } from './web/views/layout.js';
import { raw, Raw } from './web/html.js';
import { loginView } from './web/views/login.js';
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
import { FIXABILITY } from './domain/priority.js';
import { summariseBlocks, classifyBot, relevantBotClassFor, BOT_CLASS_LABEL } from './domain/crawlers.js';
import { resolveRelation, WeakBasisError, Relation, RelationBasis } from './domain/entities.js';
import { analyzeExperiment } from './domain/experiments.js';
import { truthHistory } from './domain/truth.js';
import { predicateLabel } from './domain/verifier.js';
import { toCanonical } from './services/observatory.js';
import type { BeliefProfile } from './providers/types.js';

const here = dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  db: DB;
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

  app.register(cookie);
  app.register(formbody);
  app.register(fastifyStatic, { root: join(here, 'web', 'public'), prefix: '/static/' });

  // ------------------------------------------------------------------- auth
  function auth(req: FastifyRequest): Auth | null {
    const sid = req.cookies?.aops;
    if (!sid) return null;
    const s = repo.getSession(db, sid);
    if (!s) return null;
    return { tenantId: s.tenant_id, userId: s.user_id, email: s.email, role: s.role };
  }

  function ctx(a: Auth | null, active: string): NavContext {
    if (!a) return { email: null, tenantName: null, brandName: null, active };
    const tenant = repo.getTenant(db, a.tenantId);
    const brand = repo.primaryBrand(db, a.tenantId);
    return { email: a.email, tenantName: tenant?.name ?? '', brandName: brand?.name ?? '', active };
  }

  function requireAuth(req: FastifyRequest, reply: FastifyReply): Auth | null {
    const a = auth(req);
    if (!a) {
      reply.redirect('/login');
      return null;
    }
    return a;
  }

  function brandOf(a: Auth): repo.Row {
    const brand = repo.primaryBrand(db, a.tenantId);
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
      return redirectWith(reply, '/login', 'Those credentials do not match an account.', 'error');
    }
    const sid = randomBytes(32).toString('hex');
    repo.createSession(db, user.tenant_id, user.id, sid);
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

  // -------------------------------------------------------------- dashboard
  app.get('/', async (req, reply) => {
    const a = requireAuth(req, reply);
    if (!a) return reply;
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
    return send(reply, 'Run', a, 'observatory', runDetailView({
      run,
      observed: repo.observedForRun(db, a.tenantId, run.id),
      citations: repo.citationsForRun(db, a.tenantId, run.id),
      searchQueries: jsonParse<string[]>(run.search_queries, []),
    }));
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

  app.get('/healthz', async (_req, reply) => reply.send({ ok: true }));

  return app;
}

function concat(...parts: Array<Raw | null | undefined>): Raw {
  return raw(parts.map((p) => p?.value ?? '').join(''));
}

function notFound(): Raw {
  return raw('<main><h1>Not found</h1><p class="lede">That record does not exist in this workspace.</p></main>');
}
