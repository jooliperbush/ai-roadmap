import { afterEach, expect, it } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import { buildServer } from '../../src/server.js';
import { landingView } from '../../src/web/views/landing.js';
import { trafficScorecard } from '../../src/services/traffic.js';
const databases: DB[] = [];
function fixture() {
  const db = openDb(':memory:');
  databases.push(db);
  return db;
}
afterEach(() => databases.splice(0).forEach((db) => db.close()));

it('lets visitors try a worked example before asking for an email when providers are unavailable', () => {
  const demo = landingView().value;
  expect(demo).toMatch(/href="#example" data-testid="cta-hero"/);
  expect(demo).toContain('Try the worked example');
  expect(demo).toContain('Live audits are not connected yet');
  expect(landingView({ liveProviders: 1 }).value).toMatch(/href="#audit" data-testid="cta-hero"/);
});
it('accepts only aggregate event fields and counts events without user records', async () => {
  const db = fixture();
  const app = buildServer({ db });
  try {
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/launch-event',
            payload: { source: 'linkedin', event: 'landing_view' },
          })
        ).statusCode,
      ).toBe(202);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/launch-event',
          payload: { source: 'linkedin', event: 'landing_view', email: 'private@example.com' },
        })
      ).statusCode,
    ).toBe(400);
    expect(db.prepare('SELECT source,event,count FROM launch_counts').all()).toEqual([
      { source: 'linkedin', event: 'landing_view', count: 2 },
    ]);
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  } finally {
    await app.close();
  }
});
it('normalizes audit attribution and falls back without collecting arbitrary strings', async () => {
  const db = fixture();
  const app = buildServer({ db });
  try {
    for (const source of ['LinkedIn', 'https://private.example/a?email=x', 'x'.repeat(500)]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/audit-request',
            payload: { email: 'ops@example.com', domain: 'example.com', source },
          })
        ).statusCode,
      ).toBe(201);
    }
    expect(db.prepare('SELECT source FROM audit_requests ORDER BY rowid').all()).toEqual([
      { source: 'linkedin' },
      { source: 'public_site' },
      { source: 'public_site' },
    ]);
  } finally {
    await app.close();
  }
});
it('separates real reports from simulation and does not count account creation as a payment', async () => {
  const db = fixture();
  const app = buildServer({ db });
  try {
    for (let i = 0; i < 4; i++)
      await app.inject({
        method: 'POST',
        url: '/audit-request',
        payload: { email: 'ops@example.com', domain: 'example.com', source: 'linkedin' },
      });
    const reports = db.prepare('SELECT id FROM audit_reports ORDER BY rowid').all() as { id: string }[];
    db.prepare(
      "UPDATE audit_reports SET status='complete',sample_size=10,simulated_runs=0,facts_read=2 WHERE id=?",
    ).run(reports[0].id);
    db.prepare(
      "UPDATE audit_reports SET status='complete',sample_size=10,simulated_runs=10,facts_read=2 WHERE id=?",
    ).run(reports[1].id);
    db.prepare(
      "UPDATE audit_reports SET status='complete',sample_size=10,simulated_runs=1,facts_read=2 WHERE id=?",
    ).run(reports[2].id);
    db.prepare(
      "UPDATE audit_reports SET status='complete',sample_size=10,simulated_runs=0,facts_read=0 WHERE id=?",
    ).run(reports[3].id);
    expect(trafficScorecard(db, '2000-01-01').outcomes).toEqual([
      expect.objectContaining({
        source: 'linkedin',
        requests: 4,
        live_with_facts: 1,
        simulated_or_mixed: 2,
        live_without_facts: 1,
        monitoring_activated: 0,
      }),
    ]);
  } finally {
    await app.close();
  }
});
