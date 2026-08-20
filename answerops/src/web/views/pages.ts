import { html, Raw, pct } from '../html.js';
import { measureEl } from './dashboard.js';
import { FAMILY_LABEL, INTENT_FAMILIES } from '../../domain/intent.js';
import { ACTION_LABEL, ACTION_TYPES } from '../../domain/priority.js';
import { ACTION_STATES, ALLOWED_TRANSITIONS, STATE_LABEL, ActionState } from '../../domain/actions.js';
import { BOT_CLASS_LABEL, BOT_SIGNATURES, BotClass } from '../../domain/crawlers.js';
import { RELATIONS, RELATION_LABEL } from '../../domain/entities.js';
import { DEMAND_SOURCES, SOURCE_LABEL } from '../../services/demand.js';
import { METRIC_LABEL } from '../../services/actionEngine.js';
import { measure, MIN_SAMPLES, formatMeasurement, formatP } from '../../domain/stats.js';

/** Dates in the registry are calendar dates; a millisecond stamp adds noise, not precision. */
function day(iso: string): string {
  return String(iso).slice(0, 10);
}

function stamp(iso: string): string {
  return String(iso).slice(0, 16).replace('T', ' ');
}

// -------------------------------------------------------------------- demand
export function clustersView(v: {
  clusters: any[];
  signals: any[];
  byFamily: Record<string, number>;
  sampleCsv: string;
}): Raw {
  return html`
<h1>Demand graph</h1>
<p class="lede">
  We do not ask you to invent fifty prompts. Every cluster below comes from questions your buyers already asked —
  Search Console, site search, support chat, sales calls, CRM loss reasons, review sites and public communities —
  and is filed under one intent family. Families are never averaged together.
</p>

<section class="section">
  <div class="section-head"><h2>Import demand signals</h2><span class="count">source,question,volume</span></div>
  <form method="post" action="/demand/import" class="stack" data-testid="import-form">
    <div>
      <label for="csv">Paste rows — <code>source,question,volume</code>. Permitted sources: ${DEMAND_SOURCES.join(', ')}</label>
      <textarea id="csv" name="csv" data-testid="import-csv">${v.sampleCsv}</textarea>
    </div>
    <button class="primary" type="submit" data-testid="import-submit">Import and cluster</button>
  </form>
</section>

<section class="section">
  <div class="section-head"><h2>Intent clusters</h2><span class="count" data-testid="cluster-count">${v.clusters.length}</span></div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Cluster</th><th>Intent family</th><th>Buyer stage</th><th>Volume</th><th>Demand share</th><th>Economic value</th></tr></thead>
      <tbody>
        ${v.clusters.length === 0
          ? html`<tr><td colspan="6" class="empty">No clusters yet.</td></tr>`
          : v.clusters.map(
              (c) => html`<tr data-testid="cluster-row">
                <td><a href="/demand/${c.id}">${c.label}</a></td>
                <td><span class="pill amber" data-testid="cluster-family">${FAMILY_LABEL[c.intent_family as keyof typeof FAMILY_LABEL] ?? c.intent_family}</span></td>
                <td>${c.buyer_stage}</td>
                <td class="mono">${c.demand_volume}</td>
                <td class="mono">${pct(c.demand_weight, 1)}</td>
                <td class="mono">${c.economic_value.toFixed(2)}</td>
              </tr>`,
            )}
      </tbody>
    </table>
  </div>
</section>

<section class="section">
  <div class="section-head"><h2>Family breakdown</h2><span class="count">why blending is refused</span></div>
  <div class="metric-row">
    ${INTENT_FAMILIES.map(
      (f) => html`<div class="metric"><div class="label">${FAMILY_LABEL[f]}</div><div class="value">${v.byFamily[f] ?? 0}</div><div class="sub">clusters</div></div>`,
    )}
  </div>
</section>

<section class="section">
  <div class="section-head"><h2>Raw signals</h2><span class="count">${v.signals.length}</span></div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Source</th><th>Question</th><th>Volume</th><th>Clustered</th></tr></thead>
      <tbody>
        ${v.signals.slice(0, 60).map(
          (s) => html`<tr data-testid="signal-row">
            <td>${SOURCE_LABEL[s.source as keyof typeof SOURCE_LABEL] ?? s.source}</td>
            <td>${s.question}</td><td class="mono">${s.volume}</td>
            <td class="mono">${s.cluster_id ? 'yes' : 'no'}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </div>
</section>`;
}

export function clusterDetailView(v: { cluster: any; variants: any[]; runs: any[]; absence: any; signals: any[] }): Raw {
  return html`
<h1 data-testid="cluster-detail-label">${v.cluster.label}</h1>
<p class="lede">
  ${FAMILY_LABEL[v.cluster.intent_family as keyof typeof FAMILY_LABEL]} · ${v.cluster.buyer_stage} ·
  demand share ${pct(v.cluster.demand_weight, 1)} · ${v.cluster.demand_volume} monthly questions
</p>

<div class="detail-grid">
  <div>
    <div class="panel">
      <h3>Brand absence in this cluster</h3>
      <p data-testid="absence-measure">${measureEl(v.absence)}</p>
      <p class="section-note">Absence is only reported when the interval's lower bound clears half. A single missing answer is not a finding.</p>
    </div>
    <div class="panel">
      <h3>Sampled answers</h3>
      ${v.runs.length === 0 ? html`<div class="empty">Not yet sampled.</div>` : null}
      ${v.runs.slice(0, 8).map(
        (r) => html`<div>
          <div class="answer">${r.answer_text}</div>
          <div class="provenance"><span>${r.provider}/${r.model_id}</span><span>${r.surface}</span><span>${r.grounding}</span><span>${r.geo}/${r.language}</span><span>${r.window_label}</span></div>
        </div>`,
      )}
    </div>
  </div>
  <div>
    <div class="panel">
      <h3>Prompt variants</h3>
      <ul class="plain">${v.variants.map((p) => html`<li data-testid="variant">${p.prompt}</li>`)}</ul>
      <p class="section-note">Every cluster is sampled with more than one wording, because one phrasing is one sample of a distribution.</p>
    </div>
    <div class="panel">
      <h3>Source questions</h3>
      <ul class="plain">${v.signals.slice(0, 12).map((s) => html`<li>${s.question} <span class="pill">${s.source}</span></li>`)}</ul>
    </div>
  </div>
</div>`;
}

// --------------------------------------------------------------------- truth
export function truthView(v: { claims: any[]; sources: any[]; brandName: string; grouped: Array<{ key: string; rows: any[] }> }): Raw {
  const today = new Date().toISOString().slice(0, 10);
  return html`
<h1>Truth registry</h1>
<p class="lede">
  Facts are true over an interval, not forever. Every entry carries an effective date, an expiry, a source and an
  approver — which is how we catch answers that are correctly sourced and still wrong, because they cite something
  that stopped being true.
</p>

<section class="section">
  <div class="section-head"><h2>Canonical facts</h2><span class="count" data-testid="claim-count">${v.claims.length}</span></div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Statement</th><th>Subject / predicate</th><th>Object</th><th>In force</th><th>Sensitivity</th><th>Approval</th><th></th></tr></thead>
      <tbody>
        ${v.claims.length === 0
          ? html`<tr><td colspan="7" class="empty">No canonical facts yet.</td></tr>`
          : v.claims.map(
              (c) => html`<tr data-testid="claim-row" data-claim-id="${c.id}">
                <td>${c.claim_text}</td>
                <td class="mono">${c.subject} / ${c.predicate}</td>
                <td class="mono">${c.object}</td>
                <td class="mono">${day(c.effective_from)} → ${c.effective_to ? day(c.effective_to) : 'current'}</td>
                <td><span class="pill ${c.sensitivity === 'routine' ? '' : 'red'}">${c.sensitivity}</span></td>
                <td class="mono" data-testid="claim-approval">${c.approved_by ?? 'unapproved'}</td>
                <td>
                  ${c.approved_by
                    ? html`<a href="/truth/${c.id}" data-testid="claim-history">history</a>`
                    : html`<form method="post" action="/truth/${c.id}/approve" class="inline-form"><button class="secondary" data-testid="approve-claim">Approve</button></form>`}
                </td>
              </tr>`,
            )}
      </tbody>
    </table>
  </div>
</section>

<section class="section">
  <div class="section-head"><h2>Add a canonical fact</h2><span class="count">approval required before it can create defects</span></div>
  <form method="post" action="/truth" class="stack" data-testid="truth-form">
    <div><label for="subject">Subject</label><input id="subject" name="subject" type="text" value="${v.brandName}" data-testid="truth-subject"></div>
    <div><label for="predicate">Predicate</label><input id="predicate" name="predicate" type="text" placeholder="acquired_by / pricing / feature_support" data-testid="truth-predicate"></div>
    <div><label for="object">Object</label><input id="object" name="object" type="text" data-testid="truth-object"></div>
    <div><label for="claim_text">Human-readable statement</label><input id="claim_text" name="claim_text" type="text" data-testid="truth-text"></div>
    <div><label for="effective_from">Effective from</label><input id="effective_from" name="effective_from" type="date" value="${today}" data-testid="truth-from"></div>
    <div>
      <label for="sensitivity">Sensitivity</label>
      <select id="sensitivity" name="sensitivity" data-testid="truth-sensitivity">
        <option value="routine">routine</option>
        <option value="material">material — contradictions are critical</option>
        <option value="regulated">regulated — contradictions are critical</option>
      </select>
    </div>
    <div>
      <label for="supersedes">Supersedes (optional)</label>
      <select id="supersedes" name="supersedes" data-testid="truth-supersedes">
        <option value="">— nothing —</option>
        ${v.claims.filter((c) => !c.effective_to).map((c) => html`<option value="${c.id}">${c.claim_text}</option>`)}
      </select>
    </div>
    <button class="primary" type="submit" data-testid="truth-submit">Add fact</button>
  </form>
</section>`;
}

export function truthHistoryView(v: { subject: string; predicate: string; rows: any[] }): Raw {
  return html`
<h1>${v.subject} · ${v.predicate}</h1>
<p class="lede">Every version of this fact, newest first. Nothing is deleted — a superseded fact is what turns a
sourced answer into a stale one.</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Statement</th><th>Object</th><th>In force</th><th>Superseded by</th><th>Approved</th></tr></thead>
    <tbody>
      ${v.rows.map(
        (c) => html`<tr data-testid="history-row">
          <td>${c.claim_text}</td><td class="mono">${c.object}</td>
          <td class="mono">${day(c.effective_from)} → ${c.effective_to ? day(c.effective_to) : 'current'}</td>
          <td class="mono">${c.superseded_by_id ?? '—'}</td>
          <td class="mono">${c.approved_by ?? 'unapproved'}</td>
        </tr>`,
      )}
    </tbody>
  </table>
</div>`;
}

// --------------------------------------------------------------- observatory
export function observatoryView(v: { runs: any[]; surfaces: string[]; windows: string[]; lastResult: any | null }): Raw {
  return html`
<h1>Observatory</h1>
<p class="lede">
  Every run records the exact surface it came from. “ChatGPT” is not a measurement surface: provider, model,
  version, access mode, grounding mode, geo, language, personalization state and system config all change the
  answer, so all of them are stored.
</p>

<section class="section">
  <div class="section-head"><h2>Run a sampling round</h2><span class="count">adaptive allocation, ${MIN_SAMPLES}-run floor</span></div>
  <form method="post" action="/sampling/run" class="stack" data-testid="sampling-form">
    <div>
      <label for="window_label">Window label</label>
      <input id="window_label" name="window_label" type="text" value="post" data-testid="window-label">
    </div>
    <div>
      <label for="budget">Run budget for this round</label>
      <input id="budget" name="budget" type="number" value="60" min="5" max="600" data-testid="budget">
    </div>
    <button class="primary" type="submit" data-testid="run-sampling">Sample now</button>
  </form>
  ${v.lastResult
    ? html`<p class="hint" data-testid="sampling-result">${v.lastResult}</p>`
    : null}
</section>

<section class="section">
  <div class="section-head"><h2>Recent runs</h2><span class="count" data-testid="run-count">${v.runs.length}</span></div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>When</th><th>Surface</th><th>Grounding</th><th>Geo</th><th>Window</th><th>Cost</th><th>Answer</th></tr></thead>
      <tbody>
        ${v.runs.length === 0
          ? html`<tr><td colspan="7" class="empty">No runs yet.</td></tr>`
          : v.runs.slice(0, 80).map(
              (r) => html`<tr data-testid="run-row">
                <td class="mono">${r.requested_at.slice(0, 19).replace('T', ' ')}</td>
                <td class="mono">${r.provider}/${r.model_id}@${r.model_version} · ${r.surface}</td>
                <td class="mono">${r.grounding}${r.simulated ? html` <span class="pill sim">sim</span>` : null}</td>
                <td class="mono">${r.geo}/${r.language}</td>
                <td class="mono">${r.window_label}</td>
                <td class="mono">$${Number(r.cost_usd).toFixed(4)}</td>
                <td><a href="/runs/${r.id}" data-testid="run-link">${r.answer_text.slice(0, 90)}…</a></td>
              </tr>`,
            )}
      </tbody>
    </table>
  </div>
</section>`;
}

export function runDetailView(v: { run: any; observed: any[]; citations: any[]; searchQueries: string[] }): Raw {
  return html`
<h1>Run ${v.run.id}</h1>
<p class="lede">Full provenance, extracted claims and citation checks for a single sampled answer.</p>
<div class="detail-grid">
  <div>
    <div class="panel"><h3>Answer</h3><div class="answer" data-testid="run-answer">${v.run.answer_text}</div></div>
    <div class="panel">
      <h3>Extracted claims</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Statement</th><th>Predicate</th><th>Object</th><th>Verdict</th><th>Severity</th><th>Adjudication</th></tr></thead>
        <tbody>${v.observed.map(
          (o) => html`<tr data-testid="observed-row"><td>${o.statement}</td><td class="mono">${o.predicate}</td><td class="mono">${o.object}</td><td><b>${o.verdict}</b></td><td>${o.severity}</td><td class="mono">${o.adjudication}</td></tr>`,
        )}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3>Citations</h3>
      ${v.citations.length === 0
        ? html`<p class="hint">No sources cited.</p>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>URL</th><th>Class</th><th>Supports the claim?</th><th>Snapshot</th></tr></thead>
            <tbody>${v.citations.map(
              (c) => html`<tr><td class="mono">${c.url}</td><td>${c.source_class}</td><td><b>${c.support}</b></td><td class="mono">${c.snapshot_ref || '—'}</td></tr>`,
            )}</tbody>
          </table></div>`}
    </div>
  </div>
  <div>
    <div class="panel">
      <h3>Provenance</h3>
      <dl class="kv" data-testid="run-provenance">
        <dt>Provider</dt><dd>${v.run.provider}</dd>
        <dt>Model</dt><dd>${v.run.model_id}</dd>
        <dt>Version</dt><dd>${v.run.model_version}</dd>
        <dt>Surface</dt><dd>${v.run.surface}</dd>
        <dt>Grounding</dt><dd>${v.run.grounding}</dd>
        <dt>Search mode</dt><dd>${v.run.search_mode}</dd>
        <dt>Geo / language</dt><dd>${v.run.geo} / ${v.run.language}</dd>
        <dt>Personalization</dt><dd>${v.run.personalization}</dd>
        <dt>System config</dt><dd>${v.run.system_config_hash}</dd>
        <dt>Temperature</dt><dd>${v.run.temperature}</dd>
        <dt>Seed</dt><dd>${v.run.seed}</dd>
        <dt>Simulated</dt><dd>${v.run.simulated ? 'yes' : 'no'}</dd>
        <dt>Sampling reason</dt><dd>${v.run.sampling_reason}</dd>
        <dt>Window</dt><dd>${v.run.window_label}</dd>
        <dt>Latency</dt><dd>${v.run.latency_ms} ms</dd>
        <dt>Cost</dt><dd>$${Number(v.run.cost_usd).toFixed(5)}</dd>
        <dt>Raw response</dt><dd>${v.run.raw_response_ref}</dd>
      </dl>
    </div>
    <div class="panel">
      <h3>Search queries performed</h3>
      ${v.searchQueries.length ? html`<ul class="plain">${v.searchQueries.map((q) => html`<li>${q}</li>`)}</ul>` : html`<p class="hint">None exposed by this surface (ungrounded run).</p>`}
    </div>
  </div>
</div>`;
}

// ------------------------------------------------------------------- actions
export function actionsView(v: { actions: any[] }): Raw {
  return html`
<h1>Actions</h1>
<p class="lede">
  Every action carries evidence, stated assumptions and an experiment. Nothing here is an AI-generated suggestion
  with an invented impact percentage attached.
</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Action</th><th>Type</th><th>State</th><th>Priority</th><th>Expected range</th><th>Experiment</th></tr></thead>
    <tbody>
      ${v.actions.length === 0
        ? html`<tr><td colspan="6" class="empty" data-testid="actions-empty">No actions yet.</td></tr>`
        : v.actions.map(
            (a) => html`<tr data-testid="action-row">
              <td><a href="/actions/${a.id}" data-testid="action-link">${a.title}</a></td>
              <td>${ACTION_LABEL[a.action_type as keyof typeof ACTION_LABEL] ?? a.action_type}</td>
              <td><span class="pill ${a.state === 'confirmed' ? 'green' : a.state === 'rejected' ? 'red' : 'amber'}" data-testid="action-state">${STATE_LABEL[a.state as ActionState] ?? a.state}</span></td>
              <td class="mono">${Number(a.priority).toFixed(3)}</td>
              <td class="mono">${a.expected_low === null ? 'ships as experiment' : `${(a.expected_low * 100).toFixed(0)} to ${(a.expected_high * 100).toFixed(0)} pts`}</td>
              <td class="mono">${a.experiment_id ? html`<a href="/experiments/${a.experiment_id}">open</a>` : '—'}</td>
            </tr>`,
          )}
    </tbody>
  </table>
</div>`;
}

export function actionDetailView(v: {
  action: any;
  transitions: any[];
  evidence: string[];
  assumptions: string[];
  factors: any;
  experiment: any | null;
  next: ActionState[];
}): Raw {
  const order: ActionState[] = ['detected', 'approved', 'shipped', 'crawled', 'observed', 'confirmed'];
  const idx = order.indexOf(v.action.state as ActionState);
  return html`
<h1 data-testid="action-title">${v.action.title}</h1>
<p class="lede">${ACTION_LABEL[v.action.action_type as keyof typeof ACTION_LABEL] ?? v.action.action_type}</p>

<div class="state-track" data-testid="state-track">
  ${order.map((s, i) => html`<span class="step ${v.action.state === s ? 'current' : idx > i && idx >= 0 ? 'done' : ''}">${STATE_LABEL[s]}</span>${i < order.length - 1 ? html`<span class="arrow">→</span>` : null}`)}
  ${v.action.state === 'rejected' ? html`<span class="step dead">Rejected</span>` : null}
  ${v.action.state === 'dismissed' ? html`<span class="step dead">Dismissed</span>` : null}
</div>

<div class="detail-grid" style="margin-top:20px">
  <div>
    <div class="panel"><h3>Rationale</h3><p>${v.action.rationale}</p></div>
    <div class="panel">
      <h3>Evidence</h3>
      <ul class="plain">${v.evidence.map((e) => html`<li class="mono" data-testid="evidence-item">${e}</li>`)}</ul>
      <p class="section-note">An action with no evidence is an opinion; the API rejects it.</p>
    </div>
    <div class="panel">
      <h3>Assumptions</h3>
      <ul class="reasons">${v.assumptions.map((a) => html`<li data-testid="assumption-item">${a}</li>`)}</ul>
    </div>
    <div class="panel">
      <h3>Expected range</h3>
      <p data-testid="expected-range">${v.action.expected_low === null
        ? 'No comparable prior in this workspace — this ships as an experiment, not a prediction.'
        : `${(v.action.expected_low * 100).toFixed(0)} to ${(v.action.expected_high * 100).toFixed(0)} points`}</p>
      <p class="section-note">${v.action.expected_basis}</p>
    </div>
  </div>
  <div>
    <div class="panel">
      <h3>Advance</h3>
      ${v.next.length === 0
        ? html`<p class="hint" data-testid="terminal-state">Terminal state — no further transitions are legal.</p>`
        : html`<form method="post" action="/actions/${v.action.id}/transition" class="stack" data-testid="transition-form">
            <div>
              <label for="to">Next state</label>
              <select id="to" name="to" data-testid="transition-select">
                ${ACTION_STATES.map(
                  (s) => html`<option value="${s}" ${v.next.includes(s) ? '' : 'data-illegal="1"'}>${STATE_LABEL[s]}${v.next.includes(s) ? '' : ' — illegal from here'}</option>`,
                )}
              </select>
            </div>
            <div><label for="note">Note</label><input id="note" name="note" type="text" data-testid="transition-note"></div>
            <button class="primary" type="submit" data-testid="transition-submit">Advance</button>
          </form>
          <p class="section-note">Legal from ${STATE_LABEL[v.action.state as ActionState]}: ${(ALLOWED_TRANSITIONS[v.action.state as ActionState] ?? []).map((s) => STATE_LABEL[s]).join(', ') || 'none'}.</p>`}
    </div>
    <div class="panel">
      <h3>Priority factors</h3>
      <dl class="kv" data-testid="priority-factors">
        <dt>Demand</dt><dd>${fmt(v.factors.demand)}</dd>
        <dt>Buyer intent</dt><dd>${fmt(v.factors.buyerIntent)}</dd>
        <dt>Economic value</dt><dd>${fmt(v.factors.economicValue)}</dd>
        <dt>Defect probability</dt><dd>${fmt(v.factors.defectProbability)}</dd>
        <dt>Fixability</dt><dd>${fmt(v.factors.fixability)}</dd>
        <dt>Confidence</dt><dd>${fmt(v.factors.confidence)}</dd>
        <dt>Score</dt><dd>${fmt(v.factors.score)}</dd>
      </dl>
    </div>
    ${v.experiment
      ? html`<div class="panel"><h3>Experiment</h3><p><a href="/experiments/${v.experiment.id}" data-testid="action-experiment-link">${METRIC_LABEL[v.experiment.metric as keyof typeof METRIC_LABEL] ?? v.experiment.metric}</a> — ${v.experiment.verdict}</p></div>`
      : null}
    <div class="panel">
      <h3>History</h3>
      <ul class="plain">${v.transitions.map((t) => html`<li class="mono" data-testid="transition-row">${t.created_at.slice(0, 19).replace('T', ' ')} ${t.from_state} → ${t.to_state} (${t.actor}) ${t.note}</li>`)}</ul>
    </div>
  </div>
</div>`;
}

function fmt(x: number | undefined): string {
  return typeof x === 'number' ? x.toFixed(3) : '—';
}

// --------------------------------------------------------------- experiments
export function experimentsView(v: { experiments: any[]; actionsById: Record<string, any> }): Raw {
  return html`
<h1>Experiment ledger</h1>
<p class="lede">
  Baseline, treatment, matched controls, publish and crawl dates, and the alternative explanations we could not
  rule out. Reported the same way whether the answer flatters the intervention or not.
</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Action</th><th>Metric</th><th>Baseline</th><th>Post</th><th>DiD</th><th>p</th><th>Verdict</th><th></th></tr></thead>
    <tbody>
      ${v.experiments.length === 0
        ? html`<tr><td colspan="8" class="empty" data-testid="experiments-empty">No experiments yet.</td></tr>`
        : v.experiments.map(
            (e) => html`<tr data-testid="experiment-row">
              <td>${v.actionsById[e.action_id]?.title ?? e.action_id}</td>
              <td>${METRIC_LABEL[e.metric as keyof typeof METRIC_LABEL] ?? e.metric}</td>
              <td class="mono">${e.baseline_n ? `${e.baseline_k}/${e.baseline_n}` : '—'}</td>
              <td class="mono">${e.post_n ? `${e.post_k}/${e.post_n}` : '—'}</td>
              <td class="mono">${e.did_effect === null ? '—' : `${(e.did_effect * 100).toFixed(0)} pts`}</td>
              <td class="mono">${formatP(e.p_value)}</td>
              <td><span class="pill ${e.verdict === 'confirmed' ? 'green' : e.verdict === 'rejected' ? 'red' : ''}" data-testid="experiment-verdict">${e.verdict}</span></td>
              <td><a href="/experiments/${e.id}" data-testid="experiment-link">open</a></td>
            </tr>`,
          )}
    </tbody>
  </table>
</div>`;
}

export function experimentDetailView(v: {
  experiment: any;
  action: any | null;
  analysis: any;
  outcomes: any[];
  treatmentLabels: string[];
  controlLabels: string[];
}): Raw {
  const e = v.experiment;
  return html`
<h1>Experiment · ${METRIC_LABEL[e.metric as keyof typeof METRIC_LABEL] ?? e.metric}</h1>
<p class="lede">${v.action ? v.action.title : e.action_id}</p>

<form method="post" action="/experiments/${e.id}/analyze" class="inline-form" data-testid="analyze-form">
  <button class="primary" type="submit" data-testid="analyze-submit">Analyze from stored runs</button>
</form>

<div class="metric-row" style="margin-top:20px">
  <div class="metric"><div class="label">Baseline</div><div class="value" data-testid="exp-baseline">${e.baseline_n ? `${e.baseline_k}/${e.baseline_n}` : '—'}</div><div class="sub">${e.baseline_n ? formatMeasurement(measure(e.baseline_k, e.baseline_n)) : 'not analyzed'}</div></div>
  <div class="metric"><div class="label">Post</div><div class="value" data-testid="exp-post">${e.post_n ? `${e.post_k}/${e.post_n}` : '—'}</div><div class="sub">${e.post_n ? formatMeasurement(measure(e.post_k, e.post_n)) : 'not analyzed'}</div></div>
  <div class="metric"><div class="label">Difference-in-differences</div><div class="value">${e.did_effect === null ? '—' : `${(e.did_effect * 100).toFixed(0)}`}</div><div class="sub">points vs control</div></div>
  <div class="metric"><div class="label">Probability real</div><div class="value" data-testid="exp-probability">${e.probability_real === null ? '—' : pct(e.probability_real)}</div><div class="sub">1 − one-sided p</div></div>
  <div class="metric"><div class="label">Verdict</div><div class="value" data-testid="exp-verdict">${e.verdict}</div><div class="sub">p=${formatP(e.p_value)}</div></div>
</div>

<div class="detail-grid">
  <div>
    <div class="panel">
      <h3>Design</h3>
      <dl class="kv">
        <dt>Treatment clusters</dt><dd>${v.treatmentLabels.join(', ') || '—'}</dd>
        <dt>Control clusters</dt><dd data-testid="control-clusters">${v.controlLabels.join(', ') || 'none available — stated, not hidden'}</dd>
        <dt>Baseline window</dt><dd>${e.baseline_window}</dd>
        <dt>Post window</dt><dd>${e.post_window}</dd>
        <dt>Published</dt><dd>${e.published_at ? stamp(e.published_at) : '—'}</dd>
        <dt>Crawled</dt><dd>${e.crawled_at ? stamp(e.crawled_at) : '—'}</dd>
        <dt>Indexed</dt><dd>${e.indexed_at ? stamp(e.indexed_at) : '—'}</dd>
      </dl>
    </div>
    <div class="panel">
      <h3>Business outcomes</h3>
      ${v.outcomes.length === 0
        ? html`<p class="hint">None attached.</p>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Source</th><th>Metric</th><th>Baseline</th><th>Post</th><th>Reading</th></tr></thead>
            <tbody>${v.outcomes.map(
              (o) => html`<tr data-testid="outcome-row"><td>${o.source}</td><td>${o.metric}</td><td class="mono">${o.baseline_value}</td><td class="mono">${o.post_value}</td><td><span class="pill">${o.interpretation}</span></td></tr>`,
            )}</tbody></table></div>
            <p class="section-note" data-testid="outcome-caveat">${v.outcomes[0].caveat}</p>`}
    </div>
  </div>
  <div>
    <div class="panel">
      <h3>What else could explain this</h3>
      <ul class="reasons" data-testid="alternatives">${v.analysis.alternatives.map((a: string) => html`<li>${a}</li>`)}</ul>
    </div>
    <div class="panel">
      <h3>Reading</h3>
      <p data-testid="exp-narrative">${v.analysis.narrative}</p>
    </div>
  </div>
</div>`;
}

// ------------------------------------------------------------------ crawlers
export function crawlersView(v: { byClass: Record<string, any[]>; findings: any[]; total: number }): Raw {
  return html`
<h1>Crawler access</h1>
<p class="lede">
  Bots are grouped by what they actually do. Training ingestion, retrieval indexing, user-triggered fetches and
  agentic browsing are different jobs — unblocking the wrong one costs a change-control cycle and fixes nothing.
</p>

<section class="section">
  <div class="section-head"><h2>Blocked retrieval</h2><span class="count" data-testid="crawler-total">${v.total} events</span></div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Bot</th><th>Purpose class</th><th>Blocked</th><th>Total hits</th><th>Blocked by</th></tr></thead>
      <tbody>
        ${v.findings.length === 0
          ? html`<tr><td colspan="5" class="empty">No crawler events recorded.</td></tr>`
          : v.findings.map(
              (f) => html`<tr data-testid="crawler-row">
                <td class="mono">${f.botName}</td>
                <td><span class="pill ${f.botClass === 'search_index' ? 'amber' : ''}" data-testid="bot-class">${BOT_CLASS_LABEL[f.botClass as BotClass]}</span></td>
                <td class="mono">${f.blockedCount}</td>
                <td class="mono">${f.totalCount}</td>
                <td class="mono">${f.blockedBy || '—'}</td>
              </tr>`,
            )}
      </tbody>
    </table>
  </div>
</section>

<section class="section">
  <div class="section-head"><h2>What each class can and cannot change</h2><span class="count">${BOT_SIGNATURES.length} signatures</span></div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Bot</th><th>Operator</th><th>Class</th><th>What allowing it affects</th></tr></thead>
      <tbody>
        ${BOT_SIGNATURES.map(
          (s) => html`<tr><td class="mono">${s.name}</td><td>${s.operator}</td><td>${BOT_CLASS_LABEL[s.botClass]}</td><td>${s.effect}</td></tr>`,
        )}
      </tbody>
    </table>
  </div>
</section>`;
}

// ------------------------------------------------------------------ entities
export function entitiesView(v: { relationships: any[] }): Raw {
  return html`
<h1>Entity relationships</h1>
<p class="lede">
  Co-occurrence is not competition. Every edge carries a basis, and an edge derived from co-mention alone can only
  ever be “unrelated co-mention” until a human classifies it.
</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Entity</th><th>Relation</th><th>Basis</th><th>Confidence</th><th>Note</th><th>Reclassify</th></tr></thead>
    <tbody>
      ${v.relationships.length === 0
        ? html`<tr><td colspan="6" class="empty" data-testid="entities-empty">No entities observed yet.</td></tr>`
        : v.relationships.map(
            (r) => html`<tr data-testid="entity-row">
              <td>${r.entity_name}</td>
              <td><span class="pill ${r.relation === 'competitor' ? 'amber' : ''}" data-testid="entity-relation">${RELATION_LABEL[r.relation as keyof typeof RELATION_LABEL] ?? r.relation}</span></td>
              <td class="mono" data-testid="entity-basis">${r.basis}</td>
              <td class="mono">${Number(r.confidence).toFixed(2)}</td>
              <td>${r.note}</td>
              <td>
                <form method="post" action="/entities/${r.entity_id}/classify" class="inline-form">
                  <select name="relation" data-testid="relation-select">
                    ${RELATIONS.map((rel) => html`<option value="${rel}" ${rel === r.relation ? 'selected' : ''}>${RELATION_LABEL[rel]}</option>`)}
                  </select>
                  <select name="basis" data-testid="basis-select">
                    <option value="customer_declared">customer declared</option>
                    <option value="market_registry">market registry</option>
                    <option value="contract">contract</option>
                    <option value="observed_comention">observed co-mention</option>
                  </select>
                  <button class="secondary" data-testid="classify-submit">Set</button>
                </form>
              </td>
            </tr>`,
          )}
    </tbody>
  </table>
</div>`;
}

// --------------------------------------------------------------- methodology
export function methodologyView(v: { stats: any }): Raw {
  return html`
<h1>Methodology &amp; limitations</h1>
<p class="lede">
  Trust is the product. This page states how the numbers are produced, what they can support, and what we
  deliberately refuse to claim. If any of it stops being true, this page is the bug report.
</p>

<section class="section">
  <div class="section-head"><h2>Sampling design</h2></div>
  <dl class="kv" data-testid="methodology-sampling">
    <dt>Minimum samples</dt><dd>${v.stats.minSamples} runs per cluster per window before any rate is displayed</dd>
    <dt>Maximum samples</dt><dd>${v.stats.maxSamples} runs, allocated by demand × value × volatility × defect risk</dd>
    <dt>Interval</dt><dd>95% Wilson score interval (correct at k=0 and k=n)</dd>
    <dt>Alerting</dt><dd>two-proportion z-test, p &lt; ${v.stats.alpha}, minimum effect ${pct(v.stats.minEffect)}, Benjamini-Hochberg at q=${v.stats.bhQ}</dd>
    <dt>Below the floor</dt><dd>the number is suppressed and labelled “insufficient data”, never rounded into a percentage</dd>
    <dt>Surfaces recorded</dt><dd>provider, model, version, access mode, grounding, search mode, geo, language, personalization, system config hash, temperature, seed</dd>
  </dl>
</section>

<section class="section">
  <div class="section-head"><h2>What we do not claim</h2></div>
  <ul class="reasons" data-testid="methodology-limits">
    <li>We cannot control what an external model says. We measure it, correct the record, and test whether answers moved.</li>
    <li>We do not produce a single blended visibility score. Branded and unaided prompts answer different questions and are never averaged.</li>
    <li>We do not predict an impact percentage for a recommendation unless this workspace has a cohort of comparable confirmed experiments.</li>
    <li>We do not claim prompt-level revenue attribution. Assistants rarely pass the originating conversation, and assistant referrals remain a small share of tracked traffic.</li>
    <li>We do not post to third-party sites, generate reviews, or manufacture mentions. That is spam, and it is not in the action catalogue.</li>
    <li>Simulated runs are labelled as such everywhere and are excluded from any customer-facing claim.</li>
  </ul>
</section>

<section class="section">
  <div class="section-head"><h2>Unit economics</h2></div>
  <p class="section-note">
    50 clusters × 4 providers × 5 repetitions × 30 days = 30,000 answers a month. With current grounded-search
    tool pricing plus model tokens, robust daily coverage costs roughly $400–$1,000 a month in inference and
    evaluation alone. That is why statistically serious monitoring is not sold at $49 — a $49 product cannot
    afford to sample enough to know whether it is right.
  </p>
  <div class="table-wrap"><table>
    <thead><tr><th>Plan</th><th>Coverage</th><th>Price</th></tr></thead>
    <tbody>
      <tr><td>Answer Risk Audit</td><td>One-time manual audit, truth registry seeded, top defects evidenced</td><td class="mono">free</td></tr>
      <tr><td>Monitor</td><td>50 intent clusters, 4 surfaces, weekly and adaptive sampling</td><td class="mono">$750/mo</td></tr>
      <tr><td>Operate</td><td>100 clusters, daily sampling, truth registry, execution and experiments</td><td class="mono">$2,000/mo</td></tr>
      <tr><td>Enterprise / agency</td><td>Multi-brand, CRM, governance, export</td><td class="mono">$5,000+/mo</td></tr>
    </tbody>
  </table></div>
  <p class="section-note">Priced on monitored intent coverage and confidence, not on an arbitrary number of raw prompts.</p>
</section>

<section class="section">
  <div class="section-head"><h2>Action catalogue</h2><span class="count">closed by design</span></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Action</th><th>Fixability prior</th></tr></thead>
    <tbody>${ACTION_TYPES.map((t) => html`<tr><td>${ACTION_LABEL[t]}</td><td class="mono">${v.stats.fixability[t].toFixed(2)}</td></tr>`)}</tbody>
  </table></div>
</section>`;
}

// --------------------------------------------------------------------- audit
export function auditView(v: { rows: any[] }): Raw {
  return html`
<h1>Audit log</h1>
<p class="lede">Append-only. Every mutation carries an actor, a target and a summary — including ours.</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Summary</th></tr></thead>
    <tbody>
      ${v.rows.length === 0
        ? html`<tr><td colspan="5" class="empty">Nothing logged yet.</td></tr>`
        : v.rows.map(
            (r) => html`<tr data-testid="audit-row">
              <td class="mono">${r.created_at.slice(0, 19).replace('T', ' ')}</td>
              <td class="mono">${r.actor}</td><td class="mono">${r.action}</td>
              <td class="mono">${r.target_type}/${r.target_id}</td><td>${r.summary}</td>
            </tr>`,
          )}
    </tbody>
  </table>
</div>`;
}
