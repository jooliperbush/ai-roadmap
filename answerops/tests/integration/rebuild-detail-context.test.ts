import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { makeHarness, get, type Harness } from './helpers.js';
import { escapeHtml } from '../../src/web/html.js';

let h: Harness;
let firstBrand: string;
let switchedCookie: string;
beforeEach(async () => {
  h = await makeHarness();
  const brands = h.db
    .prepare('SELECT id FROM brands WHERE tenant_id = ? ORDER BY created_at, rowid')
    .all(h.info.tenantId) as Array<{ id: string }>;
  expect(brands.length).toBeGreaterThanOrEqual(2);
  firstBrand = brands[0]!.id;
  switchedCookie = `${h.cookie}; brand=${brands[1]!.id}`;
});
afterEach(async () => {
  await h.app.close();
  h.db.close();
});

describe('detail URLs retain their resource context after a brand switch', () => {
  it('loads the requested canonical fact history from its own brand', async () => {
    const fact = h.db
      .prepare('SELECT id, claim_text FROM canonical_claims WHERE brand_id = ? LIMIT 1')
      .get(firstBrand) as { id: string; claim_text: string };
    const response = await get(h.app, `/truth/${fact.id}`, switchedCookie);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('data-testid="history-row"');
    expect(response.body).toContain(escapeHtml(fact.claim_text));
  });

  it('uses the requested demand cluster brand to choose its sampling window and signals', async () => {
    const cluster = h.db
      .prepare(
        'SELECT c.id FROM intent_clusters c JOIN demand_signals s ON s.cluster_id = c.id WHERE c.brand_id = ? LIMIT 1',
      )
      .get(firstBrand) as { id: string };
    h.db
      .prepare("UPDATE model_runs SET window_label = 'brand_context_round' WHERE brand_id = ?")
      .run(firstBrand);
    const signal = h.db
      .prepare('SELECT id, question FROM demand_signals WHERE cluster_id = ? LIMIT 1')
      .get(cluster.id) as { id: string; question: string };
    h.db
      .prepare('UPDATE demand_signals SET question = ? WHERE id = ?')
      .run('RESOURCE CONTEXT SIGNAL', signal.id);
    const response = await get(h.app, `/demand/${cluster.id}`, switchedCookie);
    expect(response.statusCode).toBe(200);
    const measurement = response.body.match(/data-testid="absence-measure"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
    expect(measurement).toMatch(/n=[1-9]\d*/);
    expect(response.body).toContain('RESOURCE CONTEXT SIGNAL');
  });

  it('resolves an experiment treatment and control labels in the experiment brand', async () => {
    const experiment = h.db
      .prepare('SELECT id, treatment_clusters FROM experiments WHERE brand_id = ? LIMIT 1')
      .get(firstBrand) as { id: string; treatment_clusters: string };
    const treatmentId = JSON.parse(experiment.treatment_clusters)[0];
    h.db
      .prepare('UPDATE intent_clusters SET label = ? WHERE id = ?')
      .run('RESOURCE CONTEXT TREATMENT', treatmentId);
    const control = h.db
      .prepare('SELECT id FROM intent_clusters WHERE brand_id = ? AND id != ? LIMIT 1')
      .get(firstBrand, treatmentId) as { id: string };
    h.db
      .prepare('UPDATE intent_clusters SET label = ? WHERE id = ?')
      .run('RESOURCE CONTEXT CONTROL', control.id);
    h.db
      .prepare('UPDATE experiments SET control_clusters = ? WHERE id = ?')
      .run(JSON.stringify([control.id]), experiment.id);
    const response = await get(h.app, `/experiments/${experiment.id}`, switchedCookie);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('RESOURCE CONTEXT TREATMENT');
    expect(response.body).toContain('RESOURCE CONTEXT CONTROL');
  });

  it('does not decode an already-decoded defect parameter again', async () => {
    const response = await get(h.app, '/defect/%25', h.cookie);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('URI malformed');
  });
});
