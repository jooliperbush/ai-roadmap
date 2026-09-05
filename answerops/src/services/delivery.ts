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
  idempotencyKey?: string;
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

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: string,
  label: string,
  headers: Record<string, string> = {},
): Promise<TransportResult> {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(15000),
    });
    return response.ok ? { ok: true } : { ok: false, error: `${label} ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'send failed' };
  }
}

export class EmailTransport implements Transport {
  kind = 'email';
  constructor(
    private apiKey: string | undefined,
    private from: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(payload: DeliveryPayload): Promise<TransportResult> {
    if (!this.apiKey) return { ok: false, error: 'RESEND_API_KEY is not set' };
    return postJson(
      this.fetchImpl,
      'https://api.resend.com/emails',
      JSON.stringify({ from: this.from, to: [payload.target], subject: payload.subject, text: payload.text }),
      'resend',
      {
        authorization: `Bearer ${this.apiKey}`,
        ...(payload.idempotencyKey ? { 'Idempotency-Key': payload.idempotencyKey } : {}),
      },
    );
  }
}

export class SlackTransport implements Transport {
  kind = 'slack';
  constructor(private fetchImpl: typeof fetch = fetch) {}
  send(payload: DeliveryPayload): Promise<TransportResult> {
    return postJson(
      this.fetchImpl,
      payload.target,
      JSON.stringify({ text: `*${payload.subject}*\n${payload.text}` }),
      'slack',
    );
  }
}

export class WebhookTransport implements Transport {
  kind = 'webhook';
  constructor(private fetchImpl: typeof fetch = fetch) {}
  send(payload: DeliveryPayload): Promise<TransportResult> {
    return postJson(this.fetchImpl, payload.target, payload.body, 'webhook', {
      'x-miscited-signature': signBody(payload.secret, payload.body),
    });
  }
}

/** Records everything, sends nothing. The default in tests, CI and the seeded demo. */
export class RecordingTransport implements Transport {
  sent: DeliveryPayload[] = [];
  private attempts = 0;
  constructor(
    public kind: string,
    private failTimes = 0,
  ) {}
  async send(payload: DeliveryPayload): Promise<TransportResult> {
    const failed = this.attempts++ < this.failTimes;
    if (!failed) this.sent.push(payload);
    return failed ? { ok: false, error: 'simulated failure' } : { ok: true };
  }
}

export function defaultTransports(fetchImpl: typeof fetch = fetch): Record<string, Transport> {
  const configured: Transport[] = [
    new EmailTransport(
      process.env.RESEND_API_KEY,
      process.env.MISCITED_FROM ?? 'alerts@miscited.example',
      fetchImpl,
    ),
    new SlackTransport(fetchImpl),
    new WebhookTransport(fetchImpl),
  ];
  return Object.fromEntries(configured.map((transport) => [transport.kind, transport]));
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
async function sendSafely(transport: Transport, payload: DeliveryPayload): Promise<TransportResult> {
  try {
    return await transport.send(payload);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'send failed' };
  }
}

export async function dispatchAlerts(
  db: DB,
  tenantId: string,
  transports: Record<string, Transport>,
  clock: Clock = systemClock,
): Promise<DispatchResult> {
  const totals: DispatchResult = { delivered: 0, failed: 0, skipped: 0, attempts: 0 };
  const channels = sched.listChannels(db, tenantId).filter((channel) => channel.enabled === 1);
  const alerts = sched.undeliveredAlerts(db, tenantId);
  if (!channels.length) {
    db.transaction(() =>
      alerts.forEach((alert) => sched.markAlertDelivered(db, tenantId, alert.id, clock.now().toISOString())),
    )();
    return { ...totals, skipped: alerts.length };
  }
  for (const alert of alerts) {
    let delivered = false;
    for (const channel of channels) {
      const transport = transports[channel.kind];
      if (!transport || !meetsSeverity(alert.severity, channel.min_severity)) {
        totals.skipped++;
        continue;
      }
      const payload = alertPayload(alert, channel);
      let success = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const result = await sendSafely(transport, payload);
        totals.attempts++;
        sched.recordAttempt(db, tenantId, {
          alert_id: alert.id,
          channel_id: channel.id,
          kind: 'alert',
          attempt,
          status: result.ok ? 'sent' : 'failed',
          error: result.error ?? '',
        });
        if (result.ok) {
          success = true;
          break;
        }
      }
      if (success) {
        totals.delivered++;
        delivered = true;
        channel.consecutive_failures = 0;
        sched.setChannelHealth(db, tenantId, channel.id, 0, 'ok');
      } else {
        totals.failed++;
        channel.consecutive_failures = Number(channel.consecutive_failures ?? 0) + MAX_ATTEMPTS;
        sched.setChannelHealth(db, tenantId, channel.id, channel.consecutive_failures, 'failing');
      }
    }
    if (delivered) sched.markAlertDelivered(db, tenantId, alert.id, clock.now().toISOString());
  }
  return totals;
}

export function alertPayload(alert: Row, channel: Row): DeliveryPayload {
  const fields = ['id', 'kind', 'severity', 'window', 'headline', 'detail', 'link', 'created_at'];
  const sourceFields = ['id', 'kind', 'severity', 'window_label', 'headline', 'detail', 'link', 'created_at'];
  const wire = Object.fromEntries(fields.map((name, index) => [name, alert[sourceFields[index]]]));
  const paragraphs = [alert.headline, alert.detail, alert.link ? `Open: ${alert.link}` : ''];
  return {
    kind: 'alert',
    subject: `Miscited: ${alert.headline}`,
    text: paragraphs.join('\n\n').trim(),
    target: channel.target,
    secret: channel.secret ?? '',
    body: JSON.stringify(wire),
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
  const brand = data.brand.name;
  const sections = [
    {
      title: '1. Critical answer defects',
      fallback: '   None above the alerting gates this window.',
      rows: data.defects
        .slice(0, 5)
        .flatMap((defect) => [
          `   - ${defect.headline}`,
          `     ${formatMeasurement(defect.measurement)} · ${defect.clusterLabels.join(', ')}`,
        ]),
    },
    {
      title: '2. Missed commercial demand',
      fallback: '   No cluster showed defensible absence at this sample size.',
      rows: data.missedDemand
        .slice(0, 5)
        .map((demand) => `   - ${demand.label}: absent in ${formatMeasurement(demand.absence)}`),
    },
    {
      title: '3. Confirmed wins',
      fallback: '   No experiment reached a confirmed verdict this window.',
      rows: data.confirmedWins.slice(0, 5).map((win) => `   - ${win.actionTitle}: ${win.narrative}`),
    },
  ];
  const empty = sections.every((section) => section.rows.length === 0);
  const header = [`Miscited weekly digest for ${brand} — window ${data.window} (${weekLabel})`, ''];
  if (data.windowStatus === 'partial')
    header.push(
      'Note: this window is incomplete. Some surfaces did not answer, so rates below cover fewer runs than planned.',
      '',
    );
  const body = empty
    ? [
        'Nothing new to report this week.',
        '',
        `We sampled ${data.totalRuns} answers across ${data.coverage.sampledClusters} of ${data.coverage.clusters} clusters ` +
          `and ${data.coverage.surfaces} surfaces. At that size a change of 20 points would have been detectable ` +
          `(n=${requiredSampleSize(0.2, 0.2)} per arm is the size that reaches 80% power for that effect at the current base rate).`,
        '',
        'No defect crossed the alerting gates, and no experiment reached a verdict. That is the report.',
      ]
    : [
        ...sections.flatMap((section) => [
          section.title,
          ...(section.rows.length ? section.rows : [section.fallback]),
          '',
        ]),
        `Sampled ${data.totalRuns} answers. Minimum sample before a rate is shown: ${MIN_SAMPLES}.`,
      ];
  return {
    subject: empty ? `Miscited: nothing new for ${brand}` : `Miscited weekly digest — ${brand}`,
    text: [...header, ...body].join('\n'),
    empty,
  };
}

export async function sendDigest(
  db: DB,
  tenantId: string,
  brandId: string,
  weekLabel: string,
  transports: Record<string, Transport>,
): Promise<{ sent: number; failed: number; empty: boolean }> {
  const digest = buildDigest(buildDashboard(db, tenantId, brandId, null), weekLabel);
  const totals = { sent: 0, failed: 0, empty: digest.empty };
  const body = JSON.stringify({
    kind: 'digest',
    week: weekLabel,
    subject: digest.subject,
    text: digest.text,
  });
  for (const channel of sched.listChannels(db, tenantId)) {
    const transport = transports[channel.kind];
    if (channel.enabled !== 1 || channel.digest !== 1 || !transport) continue;
    const result = await sendSafely(transport, {
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
      status: result.ok ? 'sent' : 'failed',
      error: result.error ?? '',
    });
    if (result.ok) totals.sent++;
    else totals.failed++;
  }
  repo.audit(
    db,
    tenantId,
    'system',
    'digest',
    'brand',
    brandId,
    `week=${weekLabel} sent=${totals.sent} failed=${totals.failed} empty=${digest.empty}`,
  );
  return totals;
}
