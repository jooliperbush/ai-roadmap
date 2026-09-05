import * as repo from '../../db/repo/index.js';
import { ALPHA, BH_Q, MAX_SAMPLES, MIN_EFFECT, MIN_SAMPLES } from '../../domain/stats.js';
import { createAction, transitionAction } from '../../services/actionEngine.js';
import { buildDashboard } from '../../services/dashboard.js';
import { runSamplingRound } from '../../services/observatory.js';

import type { Runtime } from '../context.js';
export function apiRoutes(r: Runtime): void {
  const { db } = r;
  r.app.get('/api/methodology', async () => ({
    minSamples: MIN_SAMPLES,
    maxSamples: MAX_SAMPLES,
    interval: 'wilson_95',
    alerting: {
      test: 'two_proportion_z',
      alpha: ALPHA,
      minEffect: MIN_EFFECT,
      multipleComparisons: 'benjamini_hochberg',
      q: BH_Q,
    },
    suppressBelowFloor: true,
    blendedScore: false,
    revenueAttribution: 'correlational_only',
    simulatedRunsExcludedFromClaims: true,
  }));
  r.get('/api/dashboard', (c) => buildDashboard(db, c.a.tenantId, c.brand.id));
  r.get('/api/clusters', (c) => repo.listClusters(db, c.a.tenantId, c.brand.id));
  r.get('/api/audit', (c) => repo.listAudit(db, c.a.tenantId));
  r.get('/api/runs/:id', (c) => {
    const run = repo.getRun(db, c.a.tenantId, c.params.id);
    return run
      ? {
          run,
          observed: repo.observedForRun(db, c.a.tenantId, run.id),
          citations: repo.citationsForRun(db, c.a.tenantId, run.id),
        }
      : c.reply.code(404).send({ error: 'not_found' });
  });
  r.get(
    '/api/actions/:id',
    (c) => repo.getAction(db, c.a.tenantId, c.params.id) ?? c.reply.code(404).send({ error: 'not_found' }),
  );
  r.get(
    '/api/experiments/:id',
    (c) =>
      repo.getExperiment(db, c.a.tenantId, c.params.id) ?? c.reply.code(404).send({ error: 'not_found' }),
  );
  r.post('/api/actions', (c) => {
    const b = c.body;
    try {
      return c.reply.code(201).send(
        createAction(db, {
          tenantId: c.a.tenantId,
          brandId: c.brand.id,
          clusterId: b.clusterId ?? null,
          treatmentClusterIds: b.treatmentClusterIds ?? [],
          actionType: b.actionType,
          title: b.title ?? 'Untitled',
          rationale: b.rationale ?? '',
          evidence: b.evidence ?? [],
          assumptions: b.assumptions ?? [],
          misconceptionKey: b.misconceptionKey ?? null,
          actor: c.a.email,
        }),
      );
    } catch (e) {
      const error = e as Error;
      return c.reply.code(422).send({ error: error.name, message: error.message });
    }
  });
  r.post('/api/actions/:id/transition', (c) => {
    try {
      return transitionAction(db, {
        tenantId: c.a.tenantId,
        actionId: c.params.id,
        to: c.body.to,
        actor: c.a.email,
        note: c.body.note,
      });
    } catch (e) {
      const error = e as Error;
      return error.name === 'IllegalTransitionError'
        ? c.reply.code(409).send({ error: error.name, message: error.message })
        : c.reply.code(404).send({ error: 'not_found' });
    }
  });
  r.post('/api/runs/sample', (c) =>
    runSamplingRound(db, {
      tenantId: c.a.tenantId,
      brandId: c.brand.id,
      windowLabel: c.body.window ?? 'post',
      budget: c.body.budget ?? 60,
      actor: c.a.email,
      beliefs: r.options.beliefsFor?.(c.body.window ?? 'post') ?? null,
      seedOffset: c.body.seedOffset ?? 0,
      fetcher: r.fetcher,
      clock: r.clock,
    }),
  );
}
