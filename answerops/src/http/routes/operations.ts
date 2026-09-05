import { weeklyView } from '../../web/views/weekly.js';
import { enableWeekly, weeklyQuestions, weeklyJobs } from '../../services/weekly.js';
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
  r.get('/weekly', (c) => {
    const schedule = sched.listSchedules(db, c.a.tenantId, c.brand.id).find((s) => s.weekly_briefing === 1);
    return c.show(
      'Weekly briefing',
      'weekly',
      weeklyView({
        schedule,
        questions: schedule ? weeklyQuestions(db, c.a.tenantId, schedule.id) : [],
        jobs: weeklyJobs(db, c.a.tenantId, c.brand.id),
        messages: db
          .prepare(
            'SELECT m.* FROM weekly_messages m JOIN weekly_jobs j ON j.id=m.job_id WHERE m.tenant_id=? AND j.brand_id=? ORDER BY m.next_attempt_at DESC LIMIT 20',
          )
          .all(c.a.tenantId, c.brand.id) as repo.Row[],
        emailReady: !!process.env.RESEND_API_KEY && !!process.env.MISCITED_FROM,
        email: c.a.email,
      }),
    );
  });
  r.post('/weekly/messages/:id/retry', (c) => {
    const m = db
      .prepare(
        "SELECT m.id FROM weekly_messages m JOIN weekly_jobs j ON j.id=m.job_id JOIN schedules s ON s.id=j.schedule_id WHERE m.id=? AND m.tenant_id=? AND j.brand_id=? AND m.status='failed' AND s.weekly_email=m.target AND s.enabled=1 AND j.status!='skipped'",
      )
      .get(c.params.id, c.a.tenantId, c.brand.id);
    if (!m) return c.missing('weekly');
    db.prepare(
      "UPDATE weekly_messages SET status='pending',attempts=0,next_attempt_at=?,error='' WHERE id=?",
    ).run(clock.now().toISOString(), c.params.id);
    return c.redirect('/weekly', 'Email queued for retry. Sampling will not run again.');
  });
  r.post('/weekly/enable', (c) => {
    enableWeekly(db, c.a.tenantId, c.brand.id, clock);
    return c.redirect('/weekly', 'Monday monitoring enabled. Review your questions.');
  });
  r.post('/weekly/:id/settings', (c) => {
    const s = sched.getSchedule(db, c.a.tenantId, c.params.id);
    if (!s || s.brand_id !== c.brand.id || !s.weekly_briefing) return c.missing('weekly');
    const lines = String(c.body.questions ?? '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!lines.length || lines.length > 10 || lines.some((x) => x.length > 300))
      return c.redirect('/weekly', 'Enter 1–10 questions, each at most 300 characters.', 'error');
    db.transaction(() => {
      const existing = weeklyQuestions(db, c.a.tenantId, s.id);
      const questions = [...new Set(lines)].map((prompt) => {
        const old = existing.find((q) => q.prompt === prompt);
        if (old) return old;
        const cluster = repo.createCluster(db, c.a.tenantId, c.brand.id, {
          label: prompt,
          intent_family: 'factual',
          buyer_stage: 'consideration',
          demand_volume: 1,
          demand_weight: 1 / lines.length,
          economic_value: 0.5,
          volatility: 0.3,
          demand_basis: 'estimated',
        });
        const variant = repo.createPromptVariant(db, c.a.tenantId, cluster.id, prompt);
        return {
          clusterId: cluster.id,
          variantId: variant.id,
          prompt,
          geo: variant.geo,
          language: variant.language,
        };
      });
      const value = JSON.stringify(questions);
      if (c.body.email_enabled !== 'yes')
        db.prepare(
          "UPDATE weekly_messages SET status='cancelled' WHERE tenant_id=? AND job_id IN (SELECT id FROM weekly_jobs WHERE schedule_id=?) AND status IN ('pending','failed')",
        ).run(c.a.tenantId, s.id);
      db.prepare('UPDATE schedules SET weekly_questions=?,weekly_email=? WHERE tenant_id=? AND id=?').run(
        value,
        c.body.email_enabled === 'yes' ? c.a.email : '',
        c.a.tenantId,
        s.id,
      );
      db.prepare(
        "UPDATE weekly_jobs SET questions=? WHERE schedule_id=? AND tenant_id=? AND status='planned'",
      ).run(value, s.id, c.a.tenantId);
    })();
    return c.redirect(
      '/weekly',
      'Questions saved. Pending plans use this updated list; active checks keep their original list.',
    );
  });
  r.post('/weekly/:id/skip', (c) => {
    const s = sched.getSchedule(db, c.a.tenantId, c.params.id);
    if (!s || s.brand_id !== c.brand.id || !s.weekly_briefing) return c.missing('weekly');
    if (db.prepare("SELECT 1 FROM weekly_jobs WHERE schedule_id=? AND status='running'").get(s.id))
      return c.redirect(
        '/weekly',
        'This check is already running. Pause monitoring to prevent future checks.',
        'error',
      );
    db.prepare(
      "UPDATE weekly_jobs SET status='skipped',finished_at=? WHERE tenant_id=? AND schedule_id=? AND status='planned'",
    ).run(clock.now().toISOString(), c.a.tenantId, s.id);
    sched.updateScheduleNextRun(
      db,
      c.a.tenantId,
      s.id,
      computeNextRun('weekly', new Date(Math.max(+clock.now(), Date.parse(s.next_run_at))), 6).toISOString(),
    );
    return c.redirect(
      '/weekly',
      'Skipped the next pending check. Monitoring resumes on the following Monday.',
    );
  });
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
