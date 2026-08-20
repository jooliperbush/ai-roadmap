import { html, Raw, raw, escapeHtml, pct } from '../html.js';
import type { DashboardData } from '../../services/dashboard.js';
import { formatMeasurement, formatP, Measurement } from '../../domain/stats.js';
import { FAMILY_LABEL } from '../../domain/intent.js';
import { ACTION_LABEL } from '../../domain/priority.js';

export function measureEl(m: Measurement): Raw {
  if (!m.sufficient || m.point === null || m.ciLow === null || m.ciHigh === null) {
    return html`<span class="measure insufficient" data-testid="measurement">insufficient data (n=${m.n})</span>`;
  }
  return html`<span class="measure" data-testid="measurement"><span class="point">${pct(m.point)}</span> <span class="ci">95% CI ${(m.ciLow * 100).toFixed(0)}–${pct(m.ciHigh)}</span> <span class="n">n=${m.n}</span></span>`;
}

export function dashboardView(d: DashboardData): Raw {
  return html`
<h1>Answer desk — ${d.brand.name}</h1>
<p class="lede">
  Three questions, and only three: what is wrong, what are we missing, and did the last fix work.
  Window <b>${d.window}</b> · ${d.totalRuns} sampled answers across ${d.coverage.surfaces} distinct model surfaces
  ${d.simulatedRuns > 0 ? html` · <span class="pill sim" data-testid="sim-badge">${d.simulatedRuns} simulated runs</span>` : null}
</p>

<form method="get" action="/" class="inline-form" data-testid="window-picker" style="margin-bottom:22px">
  <label for="window" style="margin:0">Sampling window</label>
  <select id="window" name="window" onchange="this.form.submit()" data-testid="window-select">
    ${d.windows.map(
      (w) => html`<option value="${w.label}" ${w.label === d.window ? 'selected' : ''}>${w.label} — ${w.runs} runs, ${w.clusters} clusters${w.comparable ? '' : ' (partial probe)'}</option>`,
    )}
  </select>
  <noscript><button class="secondary" type="submit">Show</button></noscript>
</form>

<section class="section" data-testid="section-defects">
  <div class="section-head">
    <h2>1 · Critical answer defects</h2>
    <span class="count" data-testid="defect-count">${d.defects.length} open</span>
  </div>
  <p class="section-note">
    A defect is a claim that contradicts your approved record, or repeats something that stopped being true.
    Positive sentiment does not redeem a false answer.
  </p>
  ${d.defects.length === 0
    ? html`<div class="empty" data-testid="defects-empty">No defect clears the evidence bar in this window.</div>`
    : d.defects.map(
        (f, i) => html`
  <a class="card" href="/defect/${encodeURIComponent(f.misconceptionKey)}" data-testid="defect-card">
    <div class="card-top">
      <div class="card-headline" data-testid="defect-headline">${f.headline}</div>
      <span class="severity ${f.severity}">${f.severity}</span>
    </div>
    <div class="card-meta">
      <span>${measureEl(f.measurement)}</span>
      <span>verdict <b>${f.verdict}</b></span>
      <span>intent <b>${FAMILY_LABEL[f.intentFamily]}</b></span>
      <span>surfaces <b>${f.providers.join(', ') || '—'}</b></span>
      <span>priority <b>#${i + 1}</b> (${f.priority.toFixed(4)})</span>
      ${f.baselineComparison
        ? html`<span>vs baseline <b>${f.baselineComparison.significant ? 'moved (significant)' : 'no significant change'}</b> p=${formatP(f.baselineComparison.pValue)}${f.baselineComparison.qValue !== null ? html` q=${formatP(f.baselineComparison.qValue)}` : null}</span>`
        : null}
    </div>
  </a>`,
      )}
</section>

<section class="section" data-testid="section-demand">
  <div class="section-head">
    <h2>2 · Missed commercial demand</h2>
    <span class="count" data-testid="demand-count">${d.missedDemand.length} clusters</span>
  </div>
  <p class="section-note">
    High-intent question clusters where you are absent from the answer often enough that the interval's
    lower bound clears half. Worth an estimated <b>${pct(d.missedDemandShare)}</b> of tracked category demand.
  </p>
  ${d.missedDemand.length === 0
    ? html`<div class="empty" data-testid="demand-empty">No high-intent cluster shows defensible absence in this window.</div>`
    : d.missedDemand.map(
        (m, i) => html`
  <a class="card" href="/demand/${m.clusterId}" data-testid="demand-card">
    <div class="card-top">
      <div class="card-headline">${m.label}</div>
      <span class="pill amber">${FAMILY_LABEL[m.intentFamily]}</span>
    </div>
    <div class="card-meta">
      <span>absent in ${measureEl(m.absence)}</span>
      <span>demand share <b>${pct(m.demandWeight)}</b></span>
      <span>volume <b>${m.demandVolume}</b></span>
      <span>stage <b>${m.buyerStage}</b></span>
      <span>priority <b>#${i + 1}</b> (${m.priority.toFixed(4)})</span>
    </div>
  </a>`,
      )}
</section>

<section class="section" data-testid="section-wins">
  <div class="section-head">
    <h2>3 · Confirmed wins</h2>
    <span class="count" data-testid="wins-count">${d.confirmedWins.length} confirmed</span>
  </div>
  <p class="section-note">
    An intervention counts here only after a controlled comparison, not because a number went up.
  </p>
  ${d.confirmedWins.length === 0
    ? html`<div class="empty" data-testid="wins-empty">No intervention has cleared the evidence bar yet.</div>`
    : d.confirmedWins.map(
        (w) => html`
  <a class="card" href="/experiments/${w.experimentId}" data-testid="win-card">
    <div class="card-top">
      <div class="card-headline" data-testid="win-headline">After “${w.actionTitle}”: ${w.narrative}</div>
      <span class="pill green">${pct(w.probabilityReal)} real</span>
    </div>
    <div class="card-meta">
      <span>baseline ${measureEl(w.baseline)}</span>
      <span>post ${measureEl(w.post)}</span>
      <span>difference-in-differences <b>${(w.didEffect * 100).toFixed(0)} pts</b></span>
      <span>${w.hasControl ? 'matched controls' : 'no control cluster available'}</span>
    </div>
  </a>`,
      )}
</section>

<section class="section" data-testid="section-families">
  <div class="section-head">
    <h2>Coverage by intent family</h2>
    <span class="count">never blended</span>
  </div>
  <p class="section-note">
    There is deliberately no single visibility score. Branded prompts nearly guarantee a mention;
    averaging them with unaided discovery produces a number that flatters you and tells you nothing.
  </p>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Intent family</th><th>Clusters</th><th>Sampled answers</th><th>Defect rate (95% CI)</th></tr></thead>
      <tbody>
        ${d.familySummaries.map(
          (f) => html`<tr data-testid="family-row">
            <td>${f.label}</td>
            <td class="mono">${f.clusters}</td>
            <td class="mono">${f.runs}</td>
            <td>${measureEl(f.defectRate)}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </div>
</section>`;
}

/** Marks the defective statements inside the answer so the reader sees the claim in context. */
export function highlight(answer: string, statements: string[]): Raw {
  let out = escapeHtml(answer);
  for (const statement of [...new Set(statements)].sort((a, b) => b.length - a.length)) {
    const needle = escapeHtml(statement.trim());
    if (needle.length < 8 || !out.includes(needle)) continue;
    out = out.split(needle).join(`<mark>${needle}</mark>`);
  }
  return raw(out);
}

export function defectDetailView(v: {
  headline: string;
  verdict: string;
  severity: string;
  measurement: Measurement;
  priorityExplanation: string;
  canonical: any | null;
  runs: Array<{ run: any; statements: any[]; citations: any[] }>;
  suggestedActionType: string;
  misconceptionKey: string;
  /** human label for what the defect is about, e.g. "your transaction fees" */
  defectSubject: string;
  clusterId: string | null;
  clusterLabel: string | null;
  treatmentClusterIds: string[];
  evidenceIds: string[];
  actions: any[];
  expected: { low: number; high: number; basis: string } | null;
  crawlerNote: string | null;
}): Raw {
  return html`
<h1 data-testid="defect-detail-headline">${v.headline}</h1>
<p class="lede">${formatMeasurement(v.measurement)} of sampled answers in this window · verdict ${v.verdict} · severity ${v.severity}</p>

<div class="detail-grid">
  <div>
    <div class="panel">
      <h3>Sampled answers</h3>
      ${v.runs.length === 0 ? html`<div class="empty">No stored answers.</div>` : null}
      ${v.runs.map(
        (r) => html`
      <div data-testid="answer-block">
        <div class="answer">${highlight(r.run.answer_text, r.statements.map((s: any) => s.statement))}</div>
        <div class="provenance" data-testid="provenance">
          <span>${r.run.provider}/${r.run.model_id}@${r.run.model_version}</span>
          <span>surface: ${r.run.surface}</span>
          <span>grounding: ${r.run.grounding}</span>
          <span>search: ${r.run.search_mode}</span>
          <span>${r.run.geo}/${r.run.language}</span>
          <span>personalization: ${r.run.personalization}</span>
          <span>temp ${r.run.temperature}</span>
          <span>seed ${r.run.seed}</span>
          <span>${r.run.simulated ? 'simulated' : 'live'}</span>
          <span>${r.run.requested_at}</span>
        </div>
        ${r.statements.map(
          (s: any) => html`<div class="card-meta"><span>claim: <b>${s.statement}</b></span><span>verdict <b>${s.verdict}</b></span><span>adjudication <b>${s.adjudication}</b></span></div>`,
        )}
        ${r.citations.length
          ? html`<table><thead><tr><th>Cited source</th><th>Class</th><th>Does the page support the claim?</th></tr></thead><tbody>
              ${r.citations.map(
                (c: any) => html`<tr data-testid="citation-row"><td class="mono">${c.url}</td><td>${c.source_class}</td><td><b>${c.support}</b></td></tr>`,
              )}
            </tbody></table>`
          : html`<p class="hint">No sources cited — an unsourced assertion, not a verified one.</p>`}
      </div>`,
      )}
    </div>
  </div>

  <div>
    <div class="panel" data-testid="canonical-panel">
      <h3>Conflicting canonical fact</h3>
      ${v.canonical
        ? html`<dl class="kv">
            <dt>Approved statement</dt><dd data-testid="canonical-text">${v.canonical.claim_text}</dd>
            <dt>Subject</dt><dd>${v.canonical.subject}</dd>
            <dt>Predicate</dt><dd>${v.canonical.predicate}</dd>
            <dt>Object</dt><dd>${v.canonical.object}</dd>
            <dt>In force from</dt><dd>${v.canonical.effective_from}</dd>
            <dt>Until</dt><dd>${v.canonical.effective_to ?? 'current'}</dd>
            <dt>Sensitivity</dt><dd>${v.canonical.sensitivity}</dd>
            <dt>Approved by</dt><dd>${v.canonical.approved_by ?? 'not approved'}</dd>
          </dl>`
        : html`<p class="hint">No canonical fact covers this claim — this is a registry gap. Add the fact before treating it as a defect.</p>`}
    </div>

    <div class="panel">
      <h3>Why this ranks here</h3>
      <div class="formula" data-testid="priority-explanation">${v.priorityExplanation}</div>
    </div>

    <div class="panel">
      <h3>Recommended intervention</h3>
      <p class="section-note">
        ${v.expected
          ? html`Expected range: <b>${(v.expected.low * 100).toFixed(0)} to ${(v.expected.high * 100).toFixed(0)} points</b>. ${v.expected.basis}`
          : html`<span data-testid="no-expected-range">No comparable prior in this workspace — this ships as an experiment, not a prediction. We do not invent an impact percentage.</span>`}
      </p>
      ${v.crawlerNote ? html`<p class="section-note" data-testid="crawler-note">${v.crawlerNote}</p>` : null}
      <form method="post" action="/actions" class="stack" data-testid="create-action-form">
        <input type="hidden" name="misconception_key" value="${v.misconceptionKey}">
        <input type="hidden" name="cluster_id" value="${v.clusterId ?? ''}">
        <input type="hidden" name="treatment_clusters" value="${v.treatmentClusterIds.join(',')}">
        <input type="hidden" name="evidence" value="${v.evidenceIds.join(',')}">
        <div>
          <label for="action_type">Intervention</label>
          <select id="action_type" name="action_type" data-testid="action-type">
            ${Object.entries(ACTION_LABEL).map(
              ([k, label]) => html`<option value="${k}" ${k === v.suggestedActionType ? 'selected' : ''}>${label}</option>`,
            )}
          </select>
        </div>
        <div>
          <label for="title">Title</label>
          <input id="title" name="title" type="text" value="Correct the record on ${v.defectSubject}" data-testid="action-title">
        </div>
        <div>
          <label for="rationale">Rationale</label>
          <textarea id="rationale" name="rationale" data-testid="action-rationale">${v.headline}</textarea>
        </div>
        <label class="hint"><input type="checkbox" name="drop_evidence" value="1" data-testid="drop-evidence"> submit without evidence (will be rejected)</label>
        <button class="primary" type="submit" data-testid="create-action">Create action</button>
      </form>
    </div>

    ${v.actions.length
      ? html`<div class="panel"><h3>Actions on this defect</h3>
          ${v.actions.map((a: any) => html`<p><a href="/actions/${a.id}" data-testid="linked-action">${a.title}</a> — ${a.state}</p>`)}
        </div>`
      : null}
  </div>
</div>`;
}
