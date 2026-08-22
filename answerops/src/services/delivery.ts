/**
 * Delivery.
 *
 * A defect found on Tuesday and read on Friday is three days of wrong answers. Three
 * transports, all injectable, none of them clever: email, a Slack incoming webhook, and a
 * signed generic webhook. The digest is deliberately dull — the three dashboard sections and
 * nothing else — and when there is nothing to report it says so and states the sample size,
 * because a weekly email that invents a narrative out of a quiet week teaches people to stop
 * reading it.
 */

import { createHmac } from 'node:crypto';
import type { DB } from '../db/index.js';
import * as sched from '../db/repo/unattended.js';
import * as repo from '../db/repo/index.js';
import type { Row } from '../db/repo/index.js';
import { meetsSeverity } from './alerts.js';
import { buildDashboard, type DashboardData } from './dashboard.js';
import { formatMeasurement, MIN_SAMPLES, requiredSampleSize } from '../domain/stats.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';

export interface DeliveryPayload {
  kind: 'alert' | 'digest';
  subject: string;
  text: string;
  target: string;
  secret: string;
  /** raw JSON body for webhook transports, already stringified so the signature matches it */
  body: string;
}

export interface TransportResult {
  ok: boolean;
  error?: string;
}

export interface Transport {
  kind: string;
  send(payload: DeliveryPayload): Promise<TransportResult>;
}

export const MAX_ATTEMPTS = 3;

export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

// ------------------------------------------------------------------ transports

export class EmailTransport implements Transport {
  kind = 'email';
  constructor(private apiKey: string | undefined, private from: string, private fetchImpl: typeof fetch = fetch) {}
  async send(p: DeliveryPayload): Promise<TransportResult> {
    if (!this.apiKey) return { ok: false, error: 'RESEND_API_KEY is not set' };
    try {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [p.target], subject: p.subject, text: p.text }),
      });
      return res.ok ? { ok: true } : { ok: false, error: `resend ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
    }
  }
}

export class SlackTransport implements Transport {
  kind = 'slack';
  constructor(private fetchImpl: typeof fetch = fetch) {}
  async send(p: DeliveryPayload): Promise<TransportResult> {
    try {
      const res = await this.fetchImpl(p.target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `*${p.subject}*\n${p.text}` }),
      });
      return res.ok ? { ok: true } : { ok: false, error: `slack ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
    }
  }
}

export class WebhookTransport implements Transport {
  kind = 'webhook';
  constructor(private fetchImpl: typeof fetch = fetch) {}
  async send(p: DeliveryPayload): Promise<TransportResult> {
    try {
      const res = await this.fetchImpl(p.target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-miscited-signature': signBody(p.secret, p.body),
        },
        body: p.body,
      });
      return res.ok ? { ok: true } : { ok: false, error: `webhook ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
    }
  }
}

/** Records everything, sends nothing. The default in tests, CI and the seeded demo. */
export class RecordingTransport implements Transport {
  sent: DeliveryPayload[] = [];
  constructor(public kind: string, private failTimes = 0) {}
  async send(p: DeliveryPayload): Promise<TransportResult> {
    if (this.failTimes > 0) {
      this.failTimes--;
      return { ok: false, error: 'simulated failure' };
    }
    this.sent.push(p);
    return { ok: true };
  }
}

export function defaultTransports(fetchImpl: typeof fetch = fetch): Record<string, Transport> {
  return {
    email: new EmailTransport(process.env.RESEND_API_KEY, process.env.MISCITED_FROM ?? 'alerts@miscited.example', fetchImpl),
    slack: new SlackTransport(fetchImpl),
    webhook: new WebhookTransport(fetchImpl),
  };
}

// -------------------------------------------------------------------- dispatch

export interface DispatchResult {
  delivered: number;
  failed: number;
  skipped: number;
  attempts: number;
}

/**
 * Send every undelivered alert to every channel that wants it. Three failures on a channel
 * marks it `failing`, which the UI shows: a delivery route that has quietly stopped working
 * is indistinguishable from a quiet week unless someone says so.
 */
export async function dispatchAlerts(
  db: DB,
  tenantId: string,
  transports: Record<string, Transport>,
  clock: Clock = systemClock,
): Promise<DispatchResult> {
  const out: DispatchResult = { delivered: 0, failed: 0, skipped: 0, attempts: 0 };
  const channels = sched.listChannels(db, tenantId).filter((c) => c.enabled === 1);
  const alerts = sched.undeliveredAlerts(db, tenantId);
  if (channels.length === 0 || alerts.length === 0) {
    // Nothing to deliver is not a failure, but an undelivered alert with no channel would
    // otherwise sit forever pretending it is queued.
    for (const a of alerts) sched.markAlertDelivered(db, tenantId, a.id, clock.now().toISOString());
    out.skipped = alerts.length;
    return out;
  }

  for (const alert of alerts) {
    let anySent = false;
    for (const channel of channels) {
      if (!meetsSeverity(alert.severity, channel.min_severity)) {
        out.skipped++;
        continue;
      }
      const transport = transports[channel.kind];
      if (!transport) {
        out.skipped++;
        continue;
      }
      const payload = alertPayload(alert, channel);
      let sent = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !sent; attempt++) {
        out.attempts++;
        const res = await transport.send(payload);
        sched.recordAttempt(db, tenantId, {
          alert_id: alert.id,
          channel_id: channel.id,
          kind: 'alert',
          attempt,
          status: res.ok ? 'sent' : 'failed',
          error: res.error ?? '',
        });
        if (res.ok) sent = true;
      }
      if (sent) {
        out.delivered++;
        anySent = true;
        sched.setChannelHealth(db, tenantId, channel.id, 0, 'ok');
      } else {
        // Exhausting the retry budget on one alert is three consecutive failures, which is the
        // threshold. A route that has quietly stopped working is indistinguishable from a quiet
        // week unless it says so here.
        out.failed++;
        const failures = Number(channel.consecutive_failures ?? 0) + MAX_ATTEMPTS;
        sched.setChannelHealth(db, tenantId, channel.id, failures, 'failing');
      }
    }
    if (anySent) sched.markAlertDelivered(db, tenantId, alert.id, clock.now().toISOString());
  }
  return out;
}

export function alertPayload(alert: Row, channel: Row): DeliveryPayload {
  const body = JSON.stringify({
    id: alert.id,
    kind: alert.kind,
    severity: alert.severity,
    window: alert.window_label,
    headline: alert.headline,
    detail: alert.detail,
    link: alert.link,
    created_at: alert.created_at,
  });
  return {
    kind: 'alert',
    subject: `Miscited: ${alert.headline}`,
    text: `${alert.headline}\n\n${alert.detail}\n\n${alert.link ? `Open: ${alert.link}` : ''}`.trim(),
    target: channel.target,
    secret: channel.secret ?? '',
    body,
  };
}

// ---------------------------------------------------------------------- digest

export interface Digest {
  subject: string;
  text: string;
  empty: boolean;
}

/**
 * The weekly digest. Three sections, or an honest statement that there was nothing to report
 * and what the week was powered to detect. No "highlights", no trend narration.
 */
export function buildDigest(data: DashboardData, weekLabel: string): Digest {
  const lines: string[] = [];
  const brandName = data.brand.name;
  lines.push(`Miscited weekly digest for ${brandName} — window ${data.window} (${weekLabel})`);
  lines.push('');

  if (data.windowStatus === 'partial') {
    lines.push('Note: this window is incomplete. Some surfaces did not answer, so rates below cover fewer runs than planned.');
    lines.push('');
  }

  const empty = data.defects.length === 0 && data.missedDemand.length === 0 && data.confirmedWins.length === 0;
  if (empty) {
    const powered = requiredSampleSize(0.2, 0.2);
    lines.push('Nothing new to report this week.');
    lines.push('');
    lines.push(
      `We sampled ${data.totalRuns} answers across ${data.coverage.sampledClusters} of ${data.coverage.clusters} clusters ` +
        `and ${data.coverage.surfaces} surfaces. At that size a change of 20 points would have been detectable ` +
        `(n=${powered} per arm is the size that reaches 80% power for that effect at the current base rate).`,
    );
    lines.push('');
    lines.push('No defect crossed the alerting gates, and no experiment reached a verdict. That is the report.');
    return { subject: `Miscited: nothing new for ${brandName}`, text: lines.join('\n'), empty: true };
  }

  lines.push('1. Critical answer defects');
  if (data.defects.length === 0) lines.push('   None above the alerting gates this window.');
  for (const d of data.defects.slice(0, 5)) {
    lines.push(`   - ${d.headline}`);
    lines.push(`     ${formatMeasurement(d.measurement)} · ${d.clusterLabels.join(', ')}`);
  }
  lines.push('');

  lines.push('2. Missed commercial demand');
  if (data.missedDemand.length === 0) lines.push('   No cluster showed defensible absence at this sample size.');
  for (const m of data.missedDemand.slice(0, 5)) {
    lines.push(`   - ${m.label}: absent in ${formatMeasurement(m.absence)}`);
  }
  lines.push('');

  lines.push('3. Confirmed wins');
  if (data.confirmedWins.length === 0) lines.push('   No experiment reached a confirmed verdict this window.');
  for (const w of data.confirmedWins.slice(0, 5)) {
    lines.push(`   - ${w.actionTitle}: ${w.narrative}`);
  }
  lines.push('');
  lines.push(`Sampled ${data.totalRuns} answers. Minimum sample before a rate is shown: ${MIN_SAMPLES}.`);

  return { subject: `Miscited weekly digest — ${brandName}`, text: lines.join('\n'), empty: false };
}

export async function sendDigest(
  db: DB,
  tenantId: string,
  brandId: string,
  weekLabel: string,
  transports: Record<string, Transport>,
): Promise<{ sent: number; failed: number; empty: boolean }> {
  const data = buildDashboard(db, tenantId, brandId, null);
  const digest = buildDigest(data, weekLabel);
  const channels = sched.listChannels(db, tenantId).filter((c) => c.enabled === 1 && c.digest === 1);
  let sent = 0;
  let failed = 0;
  for (const channel of channels) {
    const transport = transports[channel.kind];
    if (!transport) continue;
    const body = JSON.stringify({ kind: 'digest', week: weekLabel, subject: digest.subject, text: digest.text });
    const res = await transport.send({
      kind: 'digest',
      subject: digest.subject,
      text: digest.text,
      target: channel.target,
      secret: channel.secret ?? '',
      body,
    });
    sched.recordAttempt(db, tenantId, {
      channel_id: channel.id,
      kind: 'digest',
      attempt: 1,
      status: res.ok ? 'sent' : 'failed',
      error: res.error ?? '',
    });
    if (res.ok) sent++;
    else failed++;
  }
  repo.audit(db, tenantId, 'system', 'digest', 'brand', brandId, `week=${weekLabel} sent=${sent} failed=${failed} empty=${digest.empty}`);
  return { sent, failed, empty: digest.empty };
}
