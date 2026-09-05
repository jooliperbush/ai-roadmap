import { randomBytes } from 'node:crypto';

import { jsonParse } from '../../db/index.js';
import * as repo from '../../db/repo/index.js';
import * as snapsRepo from '../../db/repo/snapshots.js';
import * as sched from '../../db/repo/unattended.js';
import { CADENCES, computeNextRun, monthKey, type Cadence } from '../../domain/scheduler.js';
import { MIN_SAMPLES } from '../../domain/stats.js';
import { listAuditReports } from '../../services/audit.js';
import { buildDashboard, latestWindow } from '../../services/dashboard.js';
import { marketBreakdown, setMarkets } from '../../services/demand.js';
import { buildIndexReport, EXPORT_FIELDS, quarterOf, setConsent } from '../../services/index-report.js';
import { recheckCitation } from '../../services/recheck.js';
import { tick } from '../../services/scheduler.js';
import {
  alertsView,
  auditAdminView,
  indexView,
  marketsView,
  portfolioView,
  schedulesView,
  snapshotView,
} from '../../web/views/ops.js';

import type { Runtime } from '../context.js';
export function operationRoutes(r: Runtime): void {
  const { db, clock } = r;
  r.get('/schedules', (c) => {
    const month = monthKey(clock.now());
    return c.show(
      'Schedules',
      'schedules',
      schedulesView({
        schedules: sched.listSchedules(db, c.a.tenantId),
        brands: repo.listBrands(db, c.a.tenantId),
        spend: sched.monthToDateSpend(db, c.a.tenantId, month),
        month,
        byProvider: sched.spendByProvider(db, c.a.tenantId, month),
        windows: sched.listWindows(db, c.a.tenantId, c.brand.id),
        lastTick: null,
      }),
    );
  });
  r.post('/schedules', (c) => {
    const cadence: Cadence = CADENCES.includes(c.body.cadence) ? c.body.cadence : 'daily';
    const brandId = repo.getBrand(db, c.a.tenantId, c.body.brand_id ?? '')?.id ?? c.brand.id;
    sched.createSchedule(db, c.a.tenantId, {
      brand_id: brandId,
      cadence,
      hour_utc: 6,
      monthly_budget_usd: Math.max(10, Math.min(100000, Number(c.body.monthly_budget_usd) || 500)),
      budget_runs: Math.max(MIN_SAMPLES, Math.min(600, Number(c.body.budget_runs) || 60)),
      next_run_at: computeNextRun(cadence, clock.now(), 6).toISOString(),
    });
    repo.audit(db, c.a.tenantId, c.a.email, 'schedule_created', 'brand', brandId, `cadence=${cadence}`);
    return c.redirect(
      '/schedules',
      `A ${cadence} schedule is set. The next round runs without anyone asking.`,
    );
  });
  r.post('/schedules/:id/toggle', (c) => {
    const schedule = sched.getSchedule(db, c.a.tenantId, c.params.id);
    if (!schedule) return c.missing('schedules');
    const paused = schedule.enabled === 1;
    sched.setScheduleEnabled(db, c.a.tenantId, schedule.id, paused ? 0 : 1);
    repo.audit(
      db,
      c.a.tenantId,
      c.a.email,
      paused ? 'schedule_paused' : 'schedule_resumed',
      'schedule',
      schedule.id,
      '',
    );
    return c.redirect(
      '/schedules',
      paused ? 'Schedule paused. Nothing will sample on its own until you resume it.' : 'Schedule resumed.',
    );
  });
  r.post('/schedules/:id/run', async (c) => {
    const schedule = sched.getSchedule(db, c.a.tenantId, c.params.id);
    if (!schedule) return c.missing('schedules');
    sched.updateScheduleNextRun(
      db,
      c.a.tenantId,
      schedule.id,
      new Date(clock.now().getTime() - 1000).toISOString(),
    );
    const result = await tick(db, {
      clock,
      owner: `manual-${c.a.userId.slice(0, 8)}`,
      tenantId: c.a.tenantId,
      scheduleId: schedule.id,
      beliefsFor: r.options.beliefsFor,
      fetcher: r.fetcher,
      transports: r.transports,
    });
    return c.redirect(
      '/schedules',
      result.ran
        ? `Ran ${result.ran} scheduled round(s) covering ${result.windows.join(', ')}; ${result.alertsCreated} alerts raised, ${result.delivered} delivered.`
        : `Nothing ran. ${result.errors.join('; ') || 'The schedule was not due or is already leased.'}`,
      result.ran ? 'ok' : 'error',
    );
  });
  r.get('/alerts', (c) =>
    c.show(
      'Alerts',
      'alerts',
      alertsView({
        alerts: sched.listAlertsFor(db, c.a.tenantId, c.brand.id),
        channels: sched.listChannels(db, c.a.tenantId),
        attempts: sched.listAttempts(db, c.a.tenantId),
      }),
    ),
  );
  r.post('/channels', (c) => {
    const b = c.body,
      kind = ['email', 'slack', 'webhook'].includes(b.kind) ? b.kind : 'email',
      target = String(b.target ?? '').trim();
    if (!target) return c.redirect('/alerts', 'A channel needs an address or URL.', 'error');
    sched.createChannel(db, c.a.tenantId, {
      kind,
      target,
      secret: randomBytes(16).toString('hex'),
      min_severity: ['low', 'medium', 'high', 'critical'].includes(b.min_severity) ? b.min_severity : 'high',
    });
    repo.audit(db, c.a.tenantId, c.a.email, 'channel_created', 'channel', target, kind);
    return c.redirect('/alerts', `Alerts will now go to ${target}.`);
  });
  r.post('/channels/:id/delete', (c) => {
    sched.deleteChannel(db, c.a.tenantId, c.params.id);
    repo.audit(db, c.a.tenantId, c.a.email, 'channel_deleted', 'channel', c.params.id, '');
    return c.redirect('/alerts', 'Channel removed.');
  });
  r.post('/channels/:id/test', async (c) => {
    const channel = sched.getChannel(db, c.a.tenantId, c.params.id);
    if (!channel) return c.missing('alerts');
    const transport = r.transports[channel.kind];
    if (!transport)
      return c.redirect(
        '/alerts',
        `No transport is configured for ${channel.kind} in this deployment.`,
        'error',
      );
    const result = await transport.send({
      kind: 'alert',
      subject: 'Miscited: delivery test',
      text: 'This is a delivery test. If you can read it, this channel works.',
      target: channel.target,
      secret: channel.secret ?? '',
      body: JSON.stringify({ kind: 'test', at: clock.now().toISOString() }),
    });
    sched.recordAttempt(db, c.a.tenantId, {
      channel_id: channel.id,
      kind: 'alert',
      attempt: 1,
      status: result.ok ? 'sent' : 'failed',
      error: result.error ?? '',
    });
    return c.redirect(
      '/alerts',
      result.ok ? 'Test delivered.' : `Test failed: ${result.error}`,
      result.ok ? 'ok' : 'error',
    );
  });
  r.post('/alerts/:id/read', (c) => {
    sched.markAlertDelivered(db, c.a.tenantId, c.params.id, clock.now().toISOString());
    return c.redirect('/alerts', 'Marked as seen.');
  });
  r.get('/snapshot/:sha', (c) => {
    const reference = db
      .prepare('SELECT 1 FROM citations WHERE tenant_id = ? AND snapshot_sha256 = ? LIMIT 1')
      .get(c.a.tenantId, c.params.sha);
    if (!reference) return c.missing('observatory');
    const snapshot = snapsRepo.getSnapshot(db, c.params.sha);
    return snapshot
      ? c.show('Snapshot', 'observatory', snapshotView({ snapshot, citation: null }))
      : c.missing('observatory');
  });
  r.post('/citations/:id/recheck', async (c) => {
    const citation = repo.getCitation(db, c.a.tenantId, c.params.id);
    if (!citation) return c.missing('observatory');
    if (!r.fetcher)
      return c.redirect(
        `/runs/${citation.run_id}`,
        'Citation fetching is disabled in this deployment.',
        'error',
      );
    const result = await recheckCitation(db, c.a.tenantId, citation.id, r.fetcher, clock);
    const message = result.error
      ? `Re-check could not read the page (${result.error}).`
      : result.changed
        ? `Support changed from ${result.before} to ${result.after}.${result.regressed ? ' That is a regression, and an alert was raised.' : ''}`
        : `No change: still ${result.after}.`;
    return c.redirect(`/runs/${citation.run_id}`, message, result.error ? 'error' : 'ok');
  });
  r.post('/brands/switch', (c) => {
    const brand = repo.getBrand(db, c.a.tenantId, c.body.brand_id ?? '');
    if (!brand) return c.redirect('/portfolio', 'That brand is not in this workspace.', 'error');
    db.prepare('UPDATE sessions SET active_brand_id = ? WHERE id = ? AND tenant_id = ?').run(
      brand.id,
      c.req.cookies.aops,
      c.a.tenantId,
    );
    c.reply.setCookie('brand', brand.id, { path: '/', httpOnly: true, sameSite: 'lax' });
    return c.redirect('/', `Now showing ${brand.name}.`);
  });
  r.get('/portfolio', (c) => {
    const rows = repo
      .listBrands(db, c.a.tenantId)
      .map((brand) => {
        const last = sched.listWindows(db, c.a.tenantId, brand.id)[0];
        const label = last?.window_label ?? latestWindow(db, c.a.tenantId, brand.id).current;
        const data = buildDashboard(db, c.a.tenantId, brand.id, label);
        return {
          brand,
          critical: data.defects.filter((d) => d.severity === 'critical').length,
          defects: data.defects.length,
          runs: data.totalRuns,
          lastWindow: label,
          partial: last?.status === 'partial',
        };
      })
      .sort((a, b) => b.critical - a.critical || b.defects - a.defects);
    return c.show('Portfolio', 'portfolio', portfolioView({ rows }));
  });
  r.get('/clusters/:id/markets', (c) => {
    const cluster = repo.getCluster(db, c.a.tenantId, c.params.id);
    if (!cluster) return c.missing('clusters');
    return c.show(
      'Markets',
      'clusters',
      marketsView({
        cluster,
        variants: repo.listVariants(db, c.a.tenantId, cluster.id),
        breakdown: marketBreakdown(
          db,
          c.a.tenantId,
          cluster.brand_id,
          latestWindow(db, c.a.tenantId, cluster.brand_id).current,
        ),
        geos: jsonParse<string[]>(cluster.geos, ['US']),
        languages: jsonParse<string[]>(cluster.languages, ['en']),
      }),
    );
  });
  r.post('/clusters/:id/markets', (c) => {
    const cluster = repo.getCluster(db, c.a.tenantId, c.params.id);
    if (!cluster) return c.missing('clusters');
    const markets: string[] = Array.isArray(c.body.market)
      ? c.body.market
      : c.body.market
        ? [c.body.market]
        : [];
    const geos = [...new Set(markets.map((m) => String(m).split(':')[0]))],
      languages = [...new Set(markets.map((m) => String(m).split(':')[1] ?? 'en'))];
    const result = setMarkets(db, c.a.tenantId, cluster.id, geos, languages);
    repo.audit(db, c.a.tenantId, c.a.email, 'markets_set', 'cluster', cluster.id, geos.join(','));
    return c.redirect(
      `/clusters/${cluster.id}/markets`,
      `${result.created} new market variants created, ${result.kept} already existed. Existing runs are untouched.`,
    );
  });
  r.get('/index', (c) => {
    const tenant = repo.getTenant(db, c.a.tenantId);
    return c.show(
      'Accuracy index',
      'methodology',
      indexView({
        report: buildIndexReport(db, quarterOf(clock.now())),
        consent: tenant?.index_consent === 1,
        tenantName: tenant?.name ?? '',
      }),
    );
  });
  r.post('/index-consent', (c) => {
    const consent = String(c.body.consent ?? '0') === '1';
    setConsent(db, c.a.tenantId, consent, clock.now().toISOString());
    return c.redirect(
      '/index',
      consent
        ? `Contributing. Exactly these fields leave this workspace: ${EXPORT_FIELDS.join(', ')}.`
        : 'No longer contributing. The next report excludes this workspace.',
    );
  });
  r.get('/audits', (c) =>
    c.show(
      'Audit requests',
      'audit',
      auditAdminView({
        reports: db
          .prepare('SELECT * FROM audit_reports WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50')
          .all(c.a.tenantId),
      }),
    ),
  );
}
