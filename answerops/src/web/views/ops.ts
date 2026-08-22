/**
 * Views for the parts of the product that run without anyone watching: schedules, alerts,
 * delivery channels, the snapshot locker, the multi-brand portfolio, market coverage, the
 * accuracy index, and the self-serve audit report.
 */

import { html, Raw, raw, pct } from '../html.js';
import { MIN_SAMPLES } from '../../domain/stats.js';
import { MARKETS, marketLabel } from '../../domain/geo.js';
import { CADENCES } from '../../domain/scheduler.js';
import { K_ANON } from '../../services/index-report.js';
import { SNAPSHOT_RETENTION_DAYS } from '../../domain/fetcher.js';

function when(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 19).replace('T', ' ') : '—';
}

// ------------------------------------------------------------------ schedules

export function schedulesView(v: {
  schedules: any[];
  brands: any[];
  spend: { usd: number; pricedRuns: number; unpricedRuns: number };
  month: string;
  byProvider: any[];
  windows: any[];
  lastTick: string | null;
}): Raw {
  return html`
<h1>Schedules</h1>
<p class="lede">
  The product's value is a time series, and a time series with gaps is a worse time series. A schedule
  claims a lease before it runs, so two workers cannot sample the same window twice, and a round that
  fails leaves its window marked partial rather than pretending to be a baseline.
</p>

<section class="section">
  <div class="section-head"><h2>Month to date</h2><span class="count" data-testid="mtd-month">${v.month}</span></div>
  <div class="stat-row">
    <div class="stat"><span class="stat-label">Spend</span><span class="stat-value" data-testid="mtd-spend">$${v.spend.usd.toFixed(2)}</span></div>
    <div class="stat"><span class="stat-label">Priced runs</span><span class="stat-value" data-testid="mtd-priced">${v.spend.pricedRuns}</span></div>
    <div class="stat"><span class="stat-label">Unpriced runs</span><span class="stat-value" data-testid="mtd-unpriced">${v.spend.unpricedRuns}</span></div>
  </div>
  ${v.spend.unpricedRuns > 0
    ? html`<p class="hint" data-testid="unpriced-note">
        ${v.spend.unpricedRuns} runs are unpriced: the provider returned no usage block, so their cost is
        unknown. They are excluded from the total rather than counted as free.
      </p>`
    : null}
  <div class="table-wrap"><table>
    <thead><tr><th>Provider</th><th>Spend</th><th>Runs</th><th>Unpriced</th></tr></thead>
    <tbody>
      ${v.byProvider.length === 0
        ? html`<tr><td colspan="4" class="empty">No runs this month.</td></tr>`
        : v.byProvider.map((p) => html`<tr>
            <td class="mono">${p.provider}</td>
            <td class="mono">$${Number(p.usd).toFixed(4)}</td>
            <td class="mono">${p.runs}</td>
            <td class="mono">${p.unpriced}</td>
          </tr>`)}
    </tbody>
  </table></div>
</section>

<section class="section">
  <div class="section-head"><h2>Active schedules</h2><span class="count" data-testid="schedule-count">${v.schedules.length}</span></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Brand</th><th>Cadence</th><th>Next run</th><th>Last run</th><th>Budget</th><th>State</th><th></th></tr></thead>
    <tbody>
      ${v.schedules.length === 0
        ? html`<tr><td colspan="7" class="empty" data-testid="no-schedules">No schedule yet. Nothing is being sampled on its own.</td></tr>`
        : v.schedules.map((s) => html`<tr data-testid="schedule-row">
            <td>${v.brands.find((b) => b.id === s.brand_id)?.name ?? s.brand_id}</td>
            <td class="mono">${s.cadence} @ ${s.hour_utc}:00 UTC</td>
            <td class="mono" data-testid="next-run">${when(s.next_run_at)}</td>
            <td class="mono">${when(s.last_run_at)}${s.last_window_label ? html` · ${s.last_window_label}` : null}</td>
            <td class="mono">$${Number(s.monthly_budget_usd).toFixed(0)}/mo · ${s.budget_runs} runs</td>
            <td>
              ${s.enabled === 1 ? html`<span class="pill ok" data-testid="schedule-enabled">enabled</span>` : html`<span class="pill" data-testid="schedule-disabled">paused</span>`}
              ${s.last_error ? html`<span class="pill bad" title="${s.last_error}">last run failed</span>` : null}
            </td>
            <td class="row-actions">
              <form method="post" action="/schedules/${s.id}/toggle"><button class="linkbtn" data-testid="toggle-schedule">${s.enabled === 1 ? 'Pause' : 'Resume'}</button></form>
              <form method="post" action="/schedules/${s.id}/run"><button class="linkbtn" data-testid="run-schedule-now">Run now</button></form>
            </td>
          </tr>`)}
    </tbody>
  </table></div>
</section>

<section class="section">
  <div class="section-head"><h2>Add a schedule</h2></div>
  <form method="post" action="/schedules" class="stack" data-testid="schedule-form">
    <div>
      <label for="brand_id">Brand</label>
      <select id="brand_id" name="brand_id" data-testid="schedule-brand">
        ${v.brands.map((b) => html`<option value="${b.id}">${b.name}</option>`)}
      </select>
    </div>
    <div>
      <label for="cadence">Cadence</label>
      <select id="cadence" name="cadence" data-testid="schedule-cadence">
        ${CADENCES.map((c) => html`<option value="${c}">${c}</option>`)}
      </select>
    </div>
    <div>
      <label for="monthly_budget_usd">Monthly budget (USD)</label>
      <input id="monthly_budget_usd" name="monthly_budget_usd" type="number" value="500" min="10" max="100000" data-testid="schedule-budget">
    </div>
    <div>
      <label for="budget_runs">Runs per round</label>
      <input id="budget_runs" name="budget_runs" type="number" value="60" min="${MIN_SAMPLES}" max="600" data-testid="schedule-runs">
    </div>
    <button class="primary" type="submit" data-testid="create-schedule">Create schedule</button>
  </form>
</section>

<section class="section">
  <div class="section-head"><h2>Window ledger</h2><span class="count" data-testid="window-count">${v.windows.length}</span></div>
  <p class="hint">A partial window lost at least one surface. It is never used as an experiment baseline.</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Window</th><th>Status</th><th>Runs</th><th>Cost</th><th>Gaps</th><th>Finished</th></tr></thead>
    <tbody>
      ${v.windows.length === 0
        ? html`<tr><td colspan="6" class="empty">No windows recorded yet.</td></tr>`
        : v.windows.map((w) => html`<tr data-testid="window-row">
            <td class="mono">${w.window_label}</td>
            <td>${w.status === 'partial'
              ? html`<span class="pill bad" data-testid="window-partial">partial</span>`
              : html`<span class="pill ok">complete</span>`}</td>
            <td class="mono">${w.actual_runs}/${w.planned_runs}</td>
            <td class="mono">${w.cost_known === 1 ? html`$${Number(w.cost_usd).toFixed(4)}` : 'partly unpriced'}</td>
            <td class="mono">${(JSON.parse(w.gaps || '[]') as any[]).length}</td>
            <td class="mono">${when(w.finished_at)}</td>
          </tr>`)}
    </tbody>
  </table></div>
</section>`;
}

// --------------------------------------------------------------------- alerts

export function alertsView(v: { alerts: any[]; channels: any[]; attempts: any[] }): Raw {
  return html`
<h1>Alerts</h1>
<p class="lede">
  Only two things reach this page: movement that survived the two-proportion test, the minimum effect and
  the Benjamini-Hochberg correction, and a critical contradiction two evaluators agreed on. Every body
  carries its sample size, because an alert is read fastest and questioned least.
</p>

<section class="section">
  <div class="section-head"><h2>Recent alerts</h2><span class="count" data-testid="alert-count">${v.alerts.length}</span></div>
  <div class="table-wrap"><table>
    <thead><tr><th>When</th><th>Kind</th><th>Severity</th><th>Window</th><th>Headline</th><th>Delivered</th></tr></thead>
    <tbody>
      ${v.alerts.length === 0
        ? html`<tr><td colspan="6" class="empty" data-testid="no-alerts">No alerts. Nothing crossed the gates.</td></tr>`
        : v.alerts.map((a) => html`<tr data-testid="alert-row">
            <td class="mono">${when(a.created_at)}</td>
            <td class="mono" data-testid="alert-kind">${a.kind}</td>
            <td><span class="pill ${a.severity === 'critical' ? 'bad' : ''}">${a.severity}</span></td>
            <td class="mono">${a.window_label}</td>
            <td>
              ${a.link ? html`<a href="${a.link}" data-testid="alert-link">${a.headline}</a>` : a.headline}
              <div class="hint">${a.detail}</div>
            </td>
            <td class="mono">${a.delivered_at ? when(a.delivered_at) : html`<span class="pill">queued</span>`}</td>
          </tr>`)}
    </tbody>
  </table></div>
</section>

${channelsView(v)}`;
}

export function channelsView(v: { channels: any[]; attempts: any[] }): Raw {
  return html`
<section class="section">
  <div class="section-head"><h2>Delivery channels</h2><span class="count" data-testid="channel-count">${v.channels.length}</span></div>
  <p class="hint">
    A delivery route that has quietly stopped working looks exactly like a quiet week, so a channel that
    fails three times in a row is marked failing here rather than failing silently.
  </p>
  <div class="table-wrap"><table>
    <thead><tr><th>Kind</th><th>Target</th><th>Minimum severity</th><th>Digest</th><th>State</th><th></th></tr></thead>
    <tbody>
      ${v.channels.length === 0
        ? html`<tr><td colspan="6" class="empty" data-testid="no-channels">No channels. Alerts are recorded and nobody is told.</td></tr>`
        : v.channels.map((c) => html`<tr data-testid="channel-row">
            <td class="mono">${c.kind}</td>
            <td class="mono">${c.target}</td>
            <td class="mono">${c.min_severity}</td>
            <td class="mono">${c.digest === 1 ? 'yes' : 'no'}</td>
            <td>${c.state === 'failing'
              ? html`<span class="pill bad" data-testid="channel-failing">failing</span>`
              : html`<span class="pill ok">ok</span>`}</td>
            <td class="row-actions">
              <form method="post" action="/channels/${c.id}/test"><button class="linkbtn" data-testid="test-channel">Send test</button></form>
              <form method="post" action="/channels/${c.id}/delete"><button class="linkbtn" data-testid="delete-channel">Remove</button></form>
            </td>
          </tr>`)}
    </tbody>
  </table></div>

  <form method="post" action="/channels" class="stack" data-testid="channel-form">
    <div>
      <label for="kind">Channel</label>
      <select id="kind" name="kind" data-testid="channel-kind">
        <option value="email">Email</option>
        <option value="slack">Slack incoming webhook</option>
        <option value="webhook">Signed webhook</option>
      </select>
    </div>
    <div>
      <label for="target">Address or URL</label>
      <input id="target" name="target" type="text" placeholder="ops@example.com" data-testid="channel-target">
    </div>
    <div>
      <label for="min_severity">Minimum severity</label>
      <select id="min_severity" name="min_severity" data-testid="channel-severity">
        <option value="low">low</option><option value="medium">medium</option>
        <option value="high" selected>high</option><option value="critical">critical</option>
      </select>
    </div>
    <button class="primary" type="submit" data-testid="create-channel">Add channel</button>
  </form>
</section>

<section class="section">
  <div class="section-head"><h2>Delivery attempts</h2><span class="count">${v.attempts.length}</span></div>
  <div class="table-wrap"><table>
    <thead><tr><th>When</th><th>Kind</th><th>Attempt</th><th>Status</th><th>Error</th></tr></thead>
    <tbody>
      ${v.attempts.length === 0
        ? html`<tr><td colspan="5" class="empty">Nothing sent yet.</td></tr>`
        : v.attempts.slice(0, 30).map((t) => html`<tr data-testid="attempt-row">
            <td class="mono">${when(t.created_at)}</td>
            <td class="mono">${t.kind}</td>
            <td class="mono">${t.attempt}</td>
            <td>${t.status === 'sent' ? html`<span class="pill ok">sent</span>` : html`<span class="pill bad">failed</span>`}</td>
            <td class="mono">${t.error || '—'}</td>
          </tr>`)}
    </tbody>
  </table></div>
</section>`;
}

// ------------------------------------------------------------------ snapshots

export function snapshotView(v: { snapshot: any; citation: any | null }): Raw {
  return html`
<div class="snapshot-banner" data-testid="snapshot-banner">
  This is a snapshot captured on <b>${when(v.snapshot.fetched_at)}</b>. It is not the live page, and the live
  page may since have changed. That is the reason it is kept.
</div>
<h1>Snapshot ${v.snapshot.sha256.slice(0, 12)}</h1>
<div class="table-wrap"><table>
  <tbody>
    <tr><th>URL</th><td class="mono"><a href="${v.snapshot.url}" rel="nofollow noopener">${v.snapshot.url}</a></td></tr>
    <tr><th>Captured</th><td class="mono" data-testid="snapshot-date">${when(v.snapshot.fetched_at)}</td></tr>
    <tr><th>sha256</th><td class="mono" data-testid="snapshot-sha">${v.snapshot.sha256}</td></tr>
    <tr><th>HTTP status</th><td class="mono">${v.snapshot.http_status ?? '—'}</td></tr>
    <tr><th>Bytes</th><td class="mono">${v.snapshot.bytes}${v.snapshot.truncated === 1 ? ' (truncated)' : ''}</td></tr>
    <tr><th>Retention</th><td>Kept indefinitely while an open defect or a confirmed experiment refers to it, otherwise pruned after ${SNAPSHOT_RETENTION_DAYS} days.</td></tr>
  </tbody>
</table></div>
<section class="section">
  <div class="section-head"><h2>Captured content</h2></div>
  <pre class="snapshot-body" data-testid="snapshot-body">${String(v.snapshot.body).slice(0, 20000)}</pre>
</section>`;
}

// ------------------------------------------------------------------ portfolio

export function portfolioView(v: { rows: Array<{ brand: any; critical: number; defects: number; runs: number; lastWindow: string | null; partial: boolean }> }): Raw {
  return html`
<h1>Portfolio</h1>
<p class="lede">
  Every brand in this workspace, ranked by open critical defects. The schema has been multi-brand since the
  first migration; this is the page that makes an agency able to use it.
</p>
<div class="table-wrap"><table>
  <thead><tr><th>Brand</th><th>Critical</th><th>All defects</th><th>Runs in last window</th><th>Last window</th><th></th></tr></thead>
  <tbody>
    ${v.rows.length === 0
      ? html`<tr><td colspan="6" class="empty">No brands.</td></tr>`
      : v.rows.map((r) => html`<tr data-testid="portfolio-row">
          <td><b>${r.brand.name}</b><div class="hint mono">${r.brand.domain}</div></td>
          <td class="mono ${r.critical > 0 ? 'bad' : ''}" data-testid="portfolio-critical">${r.critical}</td>
          <td class="mono">${r.defects}</td>
          <td class="mono">${r.runs}</td>
          <td class="mono">${r.lastWindow ?? '—'} ${r.partial ? html`<span class="pill bad">partial</span>` : null}</td>
          <td class="row-actions">
            <form method="post" action="/brands/switch">
              <input type="hidden" name="brand_id" value="${r.brand.id}">
              <button class="linkbtn" data-testid="open-brand">Open</button>
            </form>
          </td>
        </tr>`)}
  </tbody>
</table></div>`;
}

// -------------------------------------------------------------------- markets

export function marketsView(v: { cluster: any; variants: any[]; breakdown: any[]; geos: string[]; languages: string[] }): Raw {
  return html`
<h1>Markets for "${v.cluster.label}"</h1>
<p class="lede">
  Two markets are two populations. Rates are reported per market and never pooled, for the same reason
  intent families are never blended: an average across them describes nobody.
</p>

<section class="section">
  <div class="section-head"><h2>Sampled markets</h2><span class="count" data-testid="variant-count">${v.variants.length}</span></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Market</th><th>Prompt</th></tr></thead>
    <tbody>
      ${v.variants.map((x) => html`<tr data-testid="variant-row">
        <td class="mono">${marketLabel(x.geo, x.language)}</td>
        <td>${x.prompt}</td>
      </tr>`)}
    </tbody>
  </table></div>
</section>

<section class="section">
  <div class="section-head"><h2>Add markets</h2></div>
  <form method="post" action="/clusters/${v.cluster.id}/markets" class="stack" data-testid="markets-form">
    <fieldset>
      <legend>Markets</legend>
      ${MARKETS.map((m) => html`<label class="check">
        <input type="checkbox" name="market" value="${m.geo}:${m.language}" ${v.geos.includes(m.geo) ? raw('checked') : ''} data-testid="market-${m.geo}">
        ${m.label}
      </label>`)}
    </fieldset>
    <button class="primary" type="submit" data-testid="save-markets">Save markets</button>
  </form>
</section>

<section class="section">
  <div class="section-head"><h2>Defect rate by market</h2></div>
  <p class="hint">Shown separately, never combined.</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Market</th><th>Runs</th><th>Runs with a defect</th><th>Rate</th></tr></thead>
    <tbody>
      ${v.breakdown.length === 0
        ? html`<tr><td colspan="4" class="empty">No runs in this window.</td></tr>`
        : v.breakdown.map((b) => html`<tr data-testid="market-row">
            <td class="mono">${b.label}</td>
            <td class="mono">${b.runs}</td>
            <td class="mono">${b.defects}</td>
            <td class="mono">${b.runs >= MIN_SAMPLES ? pct(b.defects / b.runs) : `insufficient data (n=${b.runs})`}</td>
          </tr>`)}
    </tbody>
  </table></div>
</section>`;
}

// ---------------------------------------------------------------------- index

export function indexView(v: { report: any; consent: boolean; tenantName: string }): Raw {
  return html`
<h1>AI Brand Accuracy Index</h1>
<p class="lede">
  Which models repeat stale or contradicted company facts, by category, over time. Built only from
  workspaces that opted in, and suppressed wherever a cell would rest on fewer than ${K_ANON} of them.
</p>

<section class="section">
  <div class="section-head"><h2>Your participation</h2></div>
  <p>
    ${v.consent
      ? html`<b>${v.tenantName}</b> is contributing to the index. You can revoke this at any time and the
        next report will exclude you.`
      : html`<b>${v.tenantName}</b> is not contributing. Participation is off by default.`}
  </p>
  <p class="hint" data-testid="export-fields">
    Exactly these fields leave your workspace: ${EXPORT_FIELDS_TEXT}. No brand name, cluster label,
    prompt or answer text ever crosses the boundary.
  </p>
  <form method="post" action="/index-consent">
    <input type="hidden" name="consent" value="${v.consent ? '0' : '1'}">
    <button class="primary" type="submit" data-testid="toggle-consent">${v.consent ? 'Stop contributing' : 'Contribute to the index'}</button>
  </form>
</section>

<section class="section">
  <div class="section-head">
    <h2>${v.report.quarter}</h2>
    <span class="count" data-testid="index-participants">${v.report.consentingTenants} participating workspaces</span>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>Provider</th><th>Model version</th><th>Claim class</th><th>Category</th><th>Workspaces</th><th>Stale or contradicted</th></tr></thead>
    <tbody>
      ${v.report.cells.length === 0
        ? html`<tr><td colspan="6" class="empty" data-testid="index-empty">No live runs from consenting workspaces yet.</td></tr>`
        : v.report.cells.map((c: any) => html`<tr data-testid="index-row">
            <td class="mono">${c.provider}</td>
            <td class="mono">${c.modelVersion}</td>
            <td class="mono">${c.predicateClass}</td>
            <td class="mono">${c.industryCategory}</td>
            <td class="mono">${c.tenants}</td>
            <td class="mono">${c.suppressed
              ? html`<span class="pill" data-testid="index-suppressed">suppressed, fewer than ${K_ANON} workspaces</span>`
              : html`${pct(c.staleOrWrong.point)} (n=${c.staleOrWrong.n})`}</td>
          </tr>`)}
    </tbody>
  </table></div>
</section>

<section class="section">
  <div class="section-head"><h2>Methodology</h2></div>
  <ul class="rules">${v.report.methodology.map((m: string) => html`<li>${m}</li>`)}</ul>
</section>`;
}

const EXPORT_FIELDS_TEXT = 'provider, model_version, predicate_class, verdict, industry_category, quarter';

// --------------------------------------------------------------- audit report

export function auditReportView(v: { report: any; findings: any; candidates: any[]; surfaces: string[]; notTested: string[] }): Raw {
  const r = v.report;
  const empty = (v.findings.defects ?? []).length === 0 && (v.findings.missed ?? []).length === 0;
  return html`
<article class="audit">
<h1>Answer risk audit: ${r.brand_name || r.domain}</h1>
<p class="lede">
  Dated ${when(r.completed_at ?? r.created_at)}. We read ${r.domain}, took what it says about itself as the
  comparison, asked ${(v.findings.familySummaries ?? []).length} families of buyer question across
  ${v.surfaces.length} surfaces, and checked every answer and every citation.
</p>

<section class="section">
  <div class="section-head"><h2>What this sample was</h2></div>
  <div class="stat-row">
    <div class="stat"><span class="stat-label">Answers sampled</span><span class="stat-value" data-testid="audit-sample">${r.sample_size}</span></div>
    <div class="stat"><span class="stat-label">Cost of the sample</span><span class="stat-value" data-testid="audit-cost">${r.cost_known === 1 ? `$${Number(r.cost_usd).toFixed(2)}` : 'partly unpriced'}</span></div>
    <div class="stat"><span class="stat-label">Powered to detect</span><span class="stat-value" data-testid="audit-power">${Math.round(Number(r.powered_for ?? 1) * 100)} points</span></div>
  </div>
  <p class="hint">Surfaces: ${v.surfaces.join('; ') || 'none recorded'}.</p>
</section>

${empty
  ? html`<section class="section" data-testid="audit-nothing-found">
      <div class="section-head"><h2>We found no defect at this sample size</h2></div>
      <p>
        That is the finding. Across ${r.sample_size} sampled answers nothing contradicted or outdated what
        your own pages say. At this sample size a difference of about
        <b>${Math.round(Number(r.powered_for ?? 1) * 100)} points</b> would have been detectable, so a smaller
        problem could still exist and this audit would not have seen it.
      </p>
    </section>`
  : html`
<section class="section">
  <div class="section-head"><h2>1. Answer defects</h2><span class="count" data-testid="audit-defect-count">${(v.findings.defects ?? []).length}</span></div>
  ${(v.findings.defects ?? []).map((d: any) => html`<div class="finding" data-testid="audit-defect">
    <h3>${d.headline}</h3>
    <p class="mono">${d.measurementText}</p>
    <blockquote>${d.example}</blockquote>
    ${d.canonical ? html`<p class="hint">Your own page says: ${d.canonical}</p>` : null}
  </div>`)}
</section>

<section class="section">
  <div class="section-head"><h2>2. Missed demand</h2><span class="count">${(v.findings.missed ?? []).length}</span></div>
  ${(v.findings.missed ?? []).length === 0
    ? html`<p>No question cluster showed defensible absence at this sample size.</p>`
    : (v.findings.missed ?? []).map((m: any) => html`<div class="finding" data-testid="audit-missed">
        <h3>${m.label}</h3><p class="mono">absent in ${m.absenceText}</p>
      </div>`)}
</section>`}

<section class="section">
  <div class="section-head"><h2>By question family</h2></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Family</th><th>Runs</th><th>Defect rate</th></tr></thead>
    <tbody>
      ${(v.findings.familySummaries ?? []).map((f: any) => html`<tr>
        <td>${f.label}</td><td class="mono">${f.runs}</td><td class="mono">${f.defectRateText}</td>
      </tr>`)}
    </tbody>
  </table></div>
</section>

<section class="section">
  <div class="section-head"><h2>Facts we read from your site</h2><span class="count" data-testid="audit-candidate-count">${v.candidates.length}</span></div>
  <p class="hint">
    Candidates, not an approved registry. Nobody has confirmed these; they are what your own published pages
    state, read the same way we read a model's answer.
  </p>
  <div class="table-wrap"><table>
    <thead><tr><th>Subject</th><th>Predicate</th><th>Value</th><th>Source</th></tr></thead>
    <tbody>
      ${v.candidates.slice(0, 20).map((c: any) => html`<tr data-testid="audit-candidate">
        <td>${c.subject}</td><td class="mono">${c.predicate}</td><td>${c.object}</td>
        <td class="mono"><a href="${c.sourceUrl}" rel="nofollow noopener">${String(c.sourceUrl).slice(0, 48)}</a></td>
      </tr>`)}
    </tbody>
  </table></div>
</section>

<section class="section">
  <div class="section-head"><h2>What this did not test</h2></div>
  <ul class="rules" data-testid="audit-not-tested">${v.notTested.map((n) => html`<li>${n}</li>`)}</ul>
</section>

<section class="section">
  <div class="section-head"><h2>Start monitoring</h2></div>
  <p>
    This workspace already holds the candidates, the question clusters and one window of runs. Creating an
    account attaches you to it and schedules the first daily round.
  </p>
  <form method="post" action="/audit/${r.token}/start" class="stack" data-testid="convert-form">
    <div><label for="email">Work email</label><input id="email" name="email" type="email" required data-testid="convert-email"></div>
    <div><label for="password">Choose a password</label><input id="password" name="password" type="password" required minlength="8" data-testid="convert-password"></div>
    <button class="primary" type="submit" data-testid="start-monitoring">Start monitoring</button>
  </form>
</section>
</article>`;
}

export function auditAdminView(v: { reports: any[] }): Raw {
  return html`
<h1>Audit requests</h1>
<p class="lede">Self-serve audits, newest first. Each ran the real pipeline in its own provisional workspace.</p>
<div class="table-wrap"><table>
  <thead><tr><th>When</th><th>Domain</th><th>Status</th><th>Sample</th><th>Report</th></tr></thead>
  <tbody>
    ${v.reports.length === 0
      ? html`<tr><td colspan="5" class="empty">No audits requested.</td></tr>`
      : v.reports.map((r) => html`<tr data-testid="audit-report-row">
          <td class="mono">${when(r.created_at)}</td>
          <td class="mono">${r.domain}</td>
          <td>${r.status === 'complete'
            ? html`<span class="pill ok">complete</span>`
            : r.status === 'failed'
              ? html`<span class="pill bad" title="${r.error ?? ''}">failed</span>`
              : html`<span class="pill">${r.status}</span>`}</td>
          <td class="mono">${r.sample_size}</td>
          <td>${r.status === 'complete' ? html`<a href="/audit/${r.token}" data-testid="audit-report-link">open</a>` : '—'}</td>
        </tr>`)}
  </tbody>
</table></div>`;
}
