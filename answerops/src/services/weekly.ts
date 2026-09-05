import type { DB } from '../db/index.js';
import { id } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import * as sched from '../db/repo/unattended.js';
import { computeNextRun, windowLabelFor } from '../domain/scheduler.js';
import type { Clock } from '../domain/clock.js';
import { liveProviders } from '../providers/live.js';
import { runSamplingRound } from './observatory.js';
import { buildDashboard } from './dashboard.js';
import type { SchedulerOptions } from './scheduler.js';
import type { Transport } from './delivery.js';
export interface WeeklyQuestion {
  clusterId: string;
  variantId: string;
  prompt: string;
  geo: string;
  language: string;
}
export function weeklyQuestions(db: DB, tenantId: string, scheduleId: string): WeeklyQuestion[] {
  const s = sched.getSchedule(db, tenantId, scheduleId);
  if (!s) return [];
  const stored = repo.jsonParse<WeeklyQuestion[]>(s.weekly_questions, []);
  if (stored.length) return stored;
  return repo
    .listClusters(db, tenantId, s.brand_id)
    .slice(0, 10)
    .flatMap((c) => {
      const v = repo.listVariants(db, tenantId, c.id)[0];
      return v
        ? [{ clusterId: c.id, variantId: v.id, prompt: v.prompt, geo: v.geo, language: v.language }]
        : [];
    });
}
export function enableWeekly(db: DB, tenantId: string, brandId: string, clock: Clock) {
  return db
    .transaction(() => {
      const existing = sched.listSchedules(db, tenantId, brandId).find((s) => s.weekly_briefing === 1);
      if (existing) return existing;
      const s = sched.createSchedule(db, tenantId, {
        brand_id: brandId,
        cadence: 'weekly',
        hour_utc: 6,
        budget_runs: 50,
        monthly_budget_usd: 20,
        next_run_at: computeNextRun('weekly', clock.now(), 6).toISOString(),
      });
      db.prepare('UPDATE schedules SET weekly_briefing=1,weekly_questions=? WHERE tenant_id=? AND id=?').run(
        JSON.stringify(weeklyQuestions(db, tenantId, s.id)),
        tenantId,
        s.id,
      );
      return sched.getSchedule(db, tenantId, s.id)!;
    })
    .immediate();
}
export function weeklyJobs(db: DB, tenantId: string, brandId: string) {
  return db
    .prepare('SELECT * FROM weekly_jobs WHERE tenant_id=? AND brand_id=? ORDER BY created_at DESC LIMIT 20')
    .all(tenantId, brandId) as repo.Row[];
}
function queue(db: DB, s: repo.Row, j: repo.Row, kind: string, subject: string, text: string, clock: Clock) {
  if (!s.weekly_email) return;
  db.prepare(
    'INSERT OR IGNORE INTO weekly_messages(id,tenant_id,job_id,kind,target,subject,body,next_attempt_at) VALUES(?,?,?,?,?,?,?,?)',
  ).run(
    id('wmsg'),
    s.tenant_id,
    j.id,
    kind,
    s.weekly_email,
    subject,
    text +
      '\n\nOpen your plan and evidence: https://miscited.com/weekly\nPause or disable these emails in Weekly briefing settings.',
    clock.now().toISOString(),
  );
}
export async function processWeekly(
  db: DB,
  s: repo.Row,
  opts: SchedulerOptions,
  clock: Clock,
): Promise<'planned' | 'complete' | 'failed' | 'idle'> {
  const now = clock.now();
  const week = windowLabelFor('weekly', now);
  const overdue = db
    .prepare("SELECT * FROM weekly_jobs WHERE schedule_id=? AND week<? AND status IN ('planned','running')")
    .all(s.id, week) as repo.Row[];
  for (const old of overdue) {
    db.transaction(() => {
      const error =
        'This scheduled week elapsed before completion. Coverage is incomplete; no catch-up sampling was charged.';
      db.prepare("UPDATE weekly_jobs SET status='failed',finished_at=?,result=? WHERE id=?").run(
        now.toISOString(),
        JSON.stringify({ error }),
        old.id,
      );
      queue(db, s, old, 'report', 'Miscited: missed weekly check', error, clock);
    })();
  }

  let j = db.prepare('SELECT * FROM weekly_jobs WHERE schedule_id=? AND week=?').get(s.id, week) as
    | repo.Row
    | undefined;
  const providers = (
    opts.providers ??
    liveProviders((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60000) }))
  ).filter((p) => p.key !== 'simulated' && p.available());
  const finishSchedule = (next: string, error: string | null = null) =>
    sched.releaseSchedule(db, s.tenant_id, s.id, {
      next_run_at: next,
      last_run_at: clock.now().toISOString(),
      last_window_label: j?.window_label ?? null,
      last_error: error,
    });
  if (!j) {
    const questions = weeklyQuestions(db, s.tenant_id, s.id).slice(
      0,
      Math.min(10, Math.floor(s.budget_runs / 5)),
    );
    j = {
      id: id('week'),
      tenant_id: s.tenant_id,
      schedule_id: s.id,
      brand_id: s.brand_id,
      week,
      window_label: week + '-' + s.id,
      questions: JSON.stringify(questions),
      providers: JSON.stringify(providers.flatMap((p) => p.surfaces)),
      execute_at: new Date(+now + 3600000).toISOString(),
      created_at: now.toISOString(),
      status: 'planned',
    };
    db.transaction(() => {
      db.prepare(
        'INSERT INTO weekly_jobs(id,tenant_id,schedule_id,brand_id,week,window_label,questions,providers,execute_at,created_at) VALUES(@id,@tenant_id,@schedule_id,@brand_id,@week,@window_label,@questions,@providers,@execute_at,@created_at)',
      ).run(j!);
      queue(
        db,
        s,
        j!,
        'plan',
        'Miscited: this week’s question plan',
        `We plan to check ${questions.length} questions with five samples each. Providers: ${providers.map(p=>p.displayName).join(', ')||'none configured'}. Starts ${j!.execute_at} (UTC). You can edit or skip in the app; otherwise it runs automatically.\n\n${questions.map((q, i) => `${i + 1}. ${q.prompt}`).join('\n')}\n\nFacts from your website need your review. Missing providers or coverage will be reported explicitly.`,
        clock,
      );
      finishSchedule(j!.execute_at);
    })();
    return 'planned';
  }
  if (j.status !== 'planned') {
    if (j.status === 'running') {
      const error =
        'Interrupted run; results may be incomplete. Not retried automatically to avoid duplicate charges.';
      db.prepare("UPDATE weekly_jobs SET status='failed',finished_at=?,result=? WHERE id=?").run(
        now.toISOString(),
        JSON.stringify({ error }),
        j.id,
      );
      queue(db, s, j, 'report', 'Miscited: weekly check interrupted', error, clock);
    }
    finishSchedule(computeNextRun('weekly', now, s.hour_utc).toISOString());
    return j.status === 'running' ? 'failed' : 'idle';
  }
  if (j.execute_at > now.toISOString()) {
    finishSchedule(j.execute_at);
    return 'planned';
  }
  db.prepare("UPDATE weekly_jobs SET status='running' WHERE id=?").run(j.id);
  let status: 'complete' | 'failed' = 'complete';
  let output: any;
  const renewal = setInterval(() => {
    db.prepare('UPDATE schedules SET lease_expires_at=? WHERE id=? AND lease_owner=?').run(
      new Date(+clock.now() + 600000).toISOString(),
      s.id,
      opts.owner,
    );
  }, 60000);
  renewal.unref();
  try {
    const frozen = JSON.parse(j.providers) as any[];
    const selected = providers
      .map((p) => ({
        ...p,
        available: () => p.available(),
        run: p.run.bind(p),
        surfaces: p.surfaces.filter((surface) =>
          frozen.some((f) => f.provider === surface.provider && f.modelId === surface.modelId && f.modelVersion === surface.modelVersion && f.surface === surface.surface && f.grounding === surface.grounding && f.searchMode === surface.searchMode),
        ),
      }))
      .filter((p) => p.surfaces.length);
    if (!selected.length)
      throw Error('No live provider available for the planned surfaces. No simulated results were used.');
    if(selected.flatMap(p=>p.surfaces).length!==frozen.length)throw Error('Some planned provider surfaces are unavailable. No replacement sampling was charged; review coverage before the next check.');
    const questions = JSON.parse(j.questions) as WeeklyQuestion[];
    if (!questions.length) throw Error('No questions selected. Add questions before next Monday.');
    const round = await runSamplingRound(db, {
      tenantId: s.tenant_id,
      brandId: s.brand_id,
      windowLabel: j.window_label,
      budget: s.budget_runs,
      monthlyBudgetUsd: s.monthly_budget_usd,
      actor: 'weekly',
      samplingReason: 'weekly_briefing',
      providers: selected,
      plannedQuestions: questions,
      liveOnly: true,
      fetcher: opts.fetcher,
      clock,
    });
    const dashboard = buildDashboard(db, s.tenant_id, s.brand_id, j.window_label);
    const previous = weeklyJobs(db, s.tenant_id, s.brand_id).find(
      (x) =>
        x.schedule_id === s.id && x.status === 'complete' && x.id !== j!.id && x.created_at < j!.created_at,
    );
    const comparable =
      previous &&
      previous.questions === j.questions &&
      previous.providers === j.providers &&
      JSON.parse(previous.result).complete;
    const old = comparable ? (JSON.parse(previous.result).issues ?? []) : [];
    const issues = dashboard.defects.map((d) => ({
      key: d.misconceptionKey,
      headline: d.headline,
      answer: d.exampleStatement,
      fact: d.canonicalClaimText,
      measurement: d.measurementText,
      change: comparable
        ? old.some((x: any) => x.key === d.misconceptionKey)
          ? 'Continuing'
          : 'New'
        : 'First observation',
      next: 'Review the cited evidence and approved fact. Correct a source you control if needed, then recheck.',
      link: '/defect/' + encodeURIComponent(d.misconceptionKey),
    }));
    const complete = round.runsCreated === questions.length * 5 && round.gaps.length === 0;
    output = {
      samples: round.runsCreated,
      planned: questions.length * 5,
      complete,
      issues,
      registryGaps: dashboard.registryGaps,
      gaps: round.gaps,
      comparison: comparable
        ? 'Same questions and provider surfaces'
        : 'No comparable completed previous check',
      notObserved:
        complete && comparable
          ? old.filter((x: any) => !issues.some((y) => y.key === x.key)).map((x: any) => x.headline)
          : [],
      note: 'No flagged issue is not proof every answer is correct. Not observed again does not prove a correction worked. Facts require human review.',
    };
    if (!round.runsCreated) {
      status = 'failed';
      output.error = 'No live answers completed. Check provider access, facts and budget.';
    }
  } catch (e) {
    status = 'failed';
    output = { error: e instanceof Error ? e.message : 'Weekly check failed', samples: 0, complete: false };
  } finally {
    clearInterval(renewal);
  }
  db.transaction(() => {
    db.prepare('UPDATE weekly_jobs SET status=?,result=?,finished_at=? WHERE id=?').run(
      status,
      JSON.stringify(output),
      clock.now().toISOString(),
      j!.id,
    );
    const issues = output.issues ?? [];
    queue(
      db,
      s,
      j!,
      'report',
      `Miscited: ${status === 'failed' ? 'check failed' : output.complete ? 'weekly results' : 'incomplete weekly results'}`,
      output.error ??
        `${output.samples}/${output.planned} live answers completed. ${issues.length} potential issue groups.\n${output.comparison}\n\n${issues.map((x: any) => `${x.change}: ${x.headline}\nAnswer: ${x.answer}\nRecorded fact: ${x.fact ?? 'Needs review'}\nNext: ${x.next}\nhttps://miscited.com${x.link}`).join('\n\n')}\n\n${output.registryGaps?.length ?? 0} registry gaps need review.\nNot observed again: ${(output.notObserved ?? []).join('; ') || 'None to report'}.\n${output.note}`,
      clock,
    );
    finishSchedule(computeNextRun('weekly', clock.now(), s.hour_utc).toISOString(), output.error ?? null);
  })();
  return status;
}
export async function deliverWeekly(
  db: DB,
  transports: Record<string, Transport>,
  clock: Clock,
  tenantId?: string,
) {
  const now = clock.now().toISOString();
  db.prepare(
    "UPDATE weekly_messages SET status='failed',error='Delivery interrupted after maximum attempts; retry manually.' WHERE status='pending' AND attempts>=3 AND (lease_until IS NULL OR lease_until<=?)",
  ).run(now);
  const rows = db
    .prepare(
      "SELECT m.* FROM weekly_messages m JOIN weekly_jobs j ON j.id=m.job_id JOIN schedules s ON s.id=j.schedule_id WHERE m.status='pending' AND m.attempts<3 AND m.next_attempt_at<=? AND (m.lease_until IS NULL OR m.lease_until<=?) AND s.weekly_email=m.target AND s.enabled=1 AND j.status!='skipped'",
    )
    .all(now, now) as repo.Row[];
  for (const m of rows.filter((m) => !tenantId || m.tenant_id === tenantId)) {
    if (!transports.email) continue;
    const lease = new Date(+clock.now() + 60000).toISOString();
    if (
      !db
        .prepare(
          "UPDATE weekly_messages SET lease_until=?,attempts=attempts+1 WHERE id=? AND status='pending' AND (lease_until IS NULL OR lease_until<=?)",
        )
        .run(lease, m.id, now).changes
    )
      continue;
    let response;
    try {
      response = await transports.email.send({
        kind: 'digest',
        subject: m.subject,
        text: m.body,
        target: m.target,
        secret: '',
        body: JSON.stringify({ subject: m.subject, text: m.body }),
        idempotencyKey: m.id,
      });
    } catch {
      response = { ok: false, error: 'Email transport failed' };
    }
    db.prepare(
      'UPDATE weekly_messages SET status=?,error=?,next_attempt_at=?,lease_until=NULL WHERE id=?',
    ).run(
      response.ok ? 'sent' : m.attempts + 1 >= 3 ? 'failed' : 'pending',
      response.error ?? '',
      new Date(+clock.now() + 3600000).toISOString(),
      m.id,
    );
  }
}
