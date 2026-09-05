import { jsonParse } from '../../db/index.js';
import * as repo from '../../db/repo/index.js';
import * as snapsRepo from '../../db/repo/snapshots.js';
import { summariseBlocks } from '../../domain/crawlers.js';
import { Relation, RelationBasis, resolveRelation, WeakBasisError } from '../../domain/entities.js';
import { SNAPSHOT_RETENTION_DAYS } from '../../domain/fetcher.js';
import { PRICE_TABLE, PRICE_TABLE_REVIEWED } from '../../domain/pricing.js';
import { FIXABILITY } from '../../domain/priority.js';
import { ALPHA, BH_Q, MAX_SAMPLES, measure, MIN_EFFECT, MIN_SAMPLES } from '../../domain/stats.js';
import { truthHistory } from '../../domain/truth.js';
import { latestWindow } from '../../services/dashboard.js';
import { familyCounts, importDemand, parseDemandCsv } from '../../services/demand.js';
import { runSamplingRound, toCanonical } from '../../services/observatory.js';
import {
  auditView,
  clusterDetailView,
  clustersView,
  crawlersView,
  entitiesView,
  methodologyView,
  observatoryView,
  runDetailView,
  truthHistoryView,
  truthView,
} from '../../web/views/pages.js';

import type { Runtime } from '../context.js';
import { extractorEval, SAMPLE_CSV } from '../metadata.js';

export function workspaceRoutes(r: Runtime): void {
  const { db } = r;
  r.get('/clusters', (c) =>
    c.show(
      'Demand',
      'clusters',
      clustersView({
        clusters: repo.listClusters(db, c.a.tenantId, c.brand.id),
        signals: repo.listDemandSignals(db, c.a.tenantId, c.brand.id),
        byFamily: familyCounts(db, c.a.tenantId, c.brand.id),
        sampleCsv: SAMPLE_CSV,
      }),
    ),
  );
  r.post('/demand/import', (c) => {
    const parsed = parseDemandCsv(c.body.csv ?? '');
    if (!parsed.rows.length)
      return c.redirect(
        '/clusters',
        'No usable rows. Every question must name the source it came from.',
        'error',
      );
    const result = importDemand(db, c.a.tenantId, c.brand.id, parsed.rows, c.a.email, parsed.rejected);
    return c.redirect(
      '/clusters',
      `Imported ${result.signalsImported} signals into ${result.clustersCreated} clusters (${result.variantsCreated} prompt variants)${result.rejected.length ? `; ${result.rejected.length} rejected` : ''}.`,
    );
  });
  r.get('/demand/:id', (c) => {
    const cluster = repo.getCluster(db, c.a.tenantId, c.params.id);
    if (!cluster) return c.missing('clusters');
    const runs = repo.runsForCluster(
      db,
      c.a.tenantId,
      cluster.id,
      latestWindow(db, c.a.tenantId, cluster.brand_id).current,
    );
    const absent = runs.filter(
      (run) => (repo.observedForRun(db, c.a.tenantId, run.id)[0]?.brand_role ?? 'absent') === 'absent',
    ).length;
    return c.show(
      cluster.label,
      'clusters',
      clusterDetailView({
        cluster,
        runs,
        absence: measure(absent, runs.length),
        variants: repo.listVariants(db, c.a.tenantId, cluster.id),
        signals: repo
          .listDemandSignals(db, c.a.tenantId, cluster.brand_id)
          .filter((s) => s.cluster_id === cluster.id),
      }),
    );
  });
  r.get('/truth', (c) =>
    c.show(
      'Truth registry',
      'truth',
      truthView({
        claims: repo.listCanonicalClaims(db, c.a.tenantId, c.brand.id),
        sources: repo.listTruthSources(db, c.a.tenantId, c.brand.id),
        brandName: c.brand.name,
        grouped: [],
      }),
    ),
  );
  r.post('/truth', (c) => {
    const b = c.body;
    if (b.supersedes) {
      const predecessor = repo.getCanonicalClaim(db, c.a.tenantId, String(b.supersedes));
      if (!predecessor) return c.reply.code(404).send('not found');
      if (predecessor.brand_id !== c.brand.id)
        return c.reply.code(403).send('A fact may only supersede a fact from the same brand.');
    }
    if (![b.predicate, b.object, b.claim_text].every((v) => typeof v === 'string' && v.trim()))
      return c.redirect(
        '/truth',
        'A canonical fact needs a predicate, an object and a human-readable statement.',
        'error',
      );
    db.transaction(() => {
      const created = repo.createCanonicalClaim(db, c.a.tenantId, c.brand.id, {
        subject: b.subject?.trim() || c.brand.name,
        predicate: b.predicate.trim(),
        object: b.object.trim(),
        claim_text: b.claim_text.trim(),
        effective_from: (b.effective_from || r.clock.now().toISOString().slice(0, 10)) + 'T00:00:00.000Z',
        sensitivity: b.sensitivity || 'routine',
      });
      if (b.supersedes) {
        repo.supersedeClaim(db, c.a.tenantId, b.supersedes, created.id, created.effective_from);
        repo.audit(
          db,
          c.a.tenantId,
          c.a.email,
          'claim_superseded',
          'canonical_claim',
          b.supersedes,
          `superseded by ${created.id}`,
        );
      }
      repo.audit(
        db,
        c.a.tenantId,
        c.a.email,
        'claim_created',
        'canonical_claim',
        created.id,
        created.claim_text,
      );
    })();
    return c.redirect('/truth', 'Fact recorded. It must be approved before it can produce defects.');
  });
  r.post('/truth/:id/approve', (c) => {
    const claim = repo.getCanonicalClaim(db, c.a.tenantId, c.params.id);
    if (!claim) return c.reply.code(404).send('not found');
    db.transaction(() => {
      repo.approveClaim(db, c.a.tenantId, claim.id, c.a.email);
      repo.audit(
        db,
        c.a.tenantId,
        c.a.email,
        'claim_approved',
        'canonical_claim',
        claim.id,
        claim.claim_text,
      );
    })();
    return c.redirect('/truth', 'Fact approved.');
  });
  r.get('/truth/:id', (c) => {
    const claim = repo.getCanonicalClaim(db, c.a.tenantId, c.params.id);
    if (!claim) return c.missing('truth');
    const all = repo.listCanonicalClaims(db, c.a.tenantId, claim.brand_id);
    const rows = new Map(all.map((row) => [row.id, row]));
    return c.show(
      'Fact history',
      'truth',
      truthHistoryView({
        subject: claim.subject,
        predicate: claim.predicate,
        rows: truthHistory(all.map(toCanonical), claim.subject, claim.predicate).map((row) =>
          rows.get(row.id),
        ),
      }),
    );
  });
  r.get('/observatory', (c) => {
    const runs = repo.listRuns(db, c.a.tenantId, c.brand.id, 200);
    return c.show(
      'Observatory',
      'observatory',
      observatoryView({
        runs,
        surfaces: [...new Set(runs.map((run) => `${run.provider}/${run.model_id}`))],
        windows: [...new Set(runs.map((run) => run.window_label))],
        lastResult: null,
      }),
    );
  });
  r.post('/sampling/run', async (c) => {
    const windowLabel = String(c.body.window_label || 'post').trim();
    const result = await runSamplingRound(db, {
      tenantId: c.a.tenantId,
      brandId: c.brand.id,
      windowLabel,
      budget: Math.max(5, Math.min(600, Number(c.body.budget) || 60)),
      actor: c.a.email,
      beliefs: r.options.beliefsFor?.(windowLabel) ?? null,
      samplingReason: 'manual',
      seedOffset: windowLabel === 'baseline' ? 0 : 100000,
      fetcher: r.fetcher,
      clock: r.clock,
    });
    return c.redirect(
      '/observatory',
      `Sampled ${result.runsCreated} answers across ${result.clustersSampled} clusters in window "${windowLabel}": ${result.defects} defective claims, ${result.citations} citations checked, $${result.costUsd.toFixed(3)} spent.`,
    );
  });
  r.get('/runs/:id', (c) => {
    const run = repo.getRun(db, c.a.tenantId, c.params.id);
    if (!run) return c.missing('observatory');
    return c.show(
      'Run',
      'observatory',
      runDetailView({
        run,
        observed: repo.observedForRun(db, c.a.tenantId, run.id),
        citations: repo.citationsForRun(db, c.a.tenantId, run.id),
        searchQueries: jsonParse<string[]>(run.search_queries, []),
      }),
    );
  });
  r.get('/crawlers', (c) => {
    const events = repo.listCrawlerEvents(db, c.a.tenantId, c.brand.id);
    const byClass: Record<string, any[]> = {};
    for (const event of events) (byClass[event.bot_class] ??= []).push(event);
    return c.show(
      'Crawlers',
      'crawlers',
      crawlersView({
        byClass,
        total: events.length,
        findings: summariseBlocks(
          events.map((e) => ({
            botClass: e.bot_class,
            botName: e.bot_name,
            statusCode: e.status_code,
            blockedBy: e.blocked_by,
          })),
        ),
      }),
    );
  });
  r.get('/entities', (c) =>
    c.show(
      'Entities',
      'entities',
      entitiesView({
        relationships: repo.listRelationships(db, c.a.tenantId, c.brand.id),
      }),
    ),
  );
  r.post('/entities/:id/classify', (c) => {
    try {
      const relation = resolveRelation(c.body.relation as Relation, c.body.basis as RelationBasis);
      repo.upsertRelationship(
        db,
        c.a.tenantId,
        c.brand.id,
        c.params.id,
        relation,
        c.body.basis,
        0.9,
        `Classified by ${c.a.email}`,
      );
      repo.audit(
        db,
        c.a.tenantId,
        c.a.email,
        'entity_classified',
        'entity',
        c.params.id,
        `${relation} via ${c.body.basis}`,
      );
      return c.redirect('/entities', `Relationship set to ${relation}.`);
    } catch (e) {
      if (e instanceof WeakBasisError) return c.redirect('/entities', e.message, 'error');
      throw e;
    }
  });
  r.get('/methodology', (c) =>
    c.show(
      'Methodology',
      'methodology',
      methodologyView({
        stats: {
          minSamples: MIN_SAMPLES,
          maxSamples: MAX_SAMPLES,
          alpha: ALPHA,
          minEffect: MIN_EFFECT,
          bhQ: BH_Q,
          fixability: FIXABILITY,
        },
        extractor: extractorEval(),
        prices: { table: PRICE_TABLE, reviewed: PRICE_TABLE_REVIEWED },
        retentionDays: SNAPSHOT_RETENTION_DAYS,
        snapshotCount: snapsRepo.countSnapshots(db),
      }),
    ),
  );
  r.get('/audit', (c) => c.show('Audit', 'audit', auditView({ rows: repo.listAudit(db, c.a.tenantId) })));
}
