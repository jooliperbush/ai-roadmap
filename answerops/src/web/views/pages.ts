import { html, raw, pct, type Raw } from "../html.js";
import { measureEl } from "./dashboard.js";
import { section, table, panel, empty, properties } from "./components.js";
import { FAMILY_LABEL, INTENT_FAMILIES } from "../../domain/intent.js";
import { ACTION_LABEL, ACTION_TYPES } from "../../domain/priority.js";
import {
  ACTION_STATES,
  ALLOWED_TRANSITIONS,
  STATE_LABEL,
  type ActionState,
} from "../../domain/actions.js";
import {
  BOT_CLASS_LABEL,
  BOT_SIGNATURES,
  type BotClass,
} from "../../domain/crawlers.js";
import { RELATIONS, RELATION_LABEL } from "../../domain/entities.js";
import { DEMAND_SOURCES, SOURCE_LABEL } from "../../services/demand.js";
import { METRIC_LABEL } from "../../services/actionEngine.js";
import {
  measure,
  MIN_SAMPLES,
  formatMeasurement,
  formatP,
} from "../../domain/stats.js";
const day = (value: unknown): string => String(value).slice(0, 10);
const stamp = (value: unknown): string =>
  String(value).slice(0, 19).replace("T", " ");
const label = (dictionary: Record<string, string>, key: string): string =>
  dictionary[key] ?? key;
const title = (text: string, description: string, id?: string): Raw =>
  html`<h1 ${id ? raw(`data-testid="${id}"`) : ""}>${text}</h1> <p class="lede">${description}</p>`;
function grid(
  headers: string[],
  rows: Raw[],
  message = "No entries yet.",
  id?: string,
): Raw {
  return table(
    headers,
    rows.length
      ? rows
      : [
          html`<tr> <td colspan="${headers.length}">${empty(message, id)}</td> </tr>`,
        ],
  );
}
function input(
  name: string,
  caption: string,
  id: string,
  value = "",
  type = "text",
  extra = raw(""),
): Raw {
  return html`<div> <label for="${name}">${caption}</label ><input id="${name}" name="${name}" type="${type}" value="${value}" data-testid="${id}" ${extra}> </div>`;
}
function select(
  name: string,
  caption: string,
  id: string,
  options: Array<[string, string]>,
  chosen?: string,
): Raw {
  return html`<div> <label for="${name}">${caption}</label ><select id="${name}" name="${name}" data-testid="${id}"> ${options.map(
    ([key, text]) =>
      html`<option value="${key}" ${key === chosen ? raw("selected") : ""}> ${text} </option>`,
  )} </select> </div>`;
}
function list(items: string[], id?: string, liId?: string): Raw {
  return html`<ul class="plain" ${id ? raw(`data-testid="${id}"`) : ""}> ${items.map(
    (item) =>
      html`<li ${liId ? raw(`data-testid="${liId}"`) : ""}>${item}</li>`,
  )} </ul>`;
}
function badge(text: string, tone = "", id?: string): Raw {
  return html`<span class="pill ${tone}" ${id ? raw(`data-testid="${id}"`) : ""} >${text}</span >`;
}
export function clustersView(v: {
  clusters: any[];
  signals: any[];
  byFamily: Record<string, number>;
  sampleCsv: string;
}): Raw {
  const importForm = html`<form method="post" action="/demand/import" class="stack" data-testid="import-form" > <div> <label for="csv" >Paste rows — <code>source,question,volume</code>. Permitted sources: ${DEMAND_SOURCES.join(", ")}</label ><textarea id="csv" name="csv" data-testid="import-csv"> ${v.sampleCsv}</textarea > </div> <button class="primary" type="submit" data-testid="import-submit"> Import and cluster </button> </form>`;
  const clusters = grid(
    [
      "Cluster",
      "Intent family",
      "Buyer stage",
      "Volume",
      "Demand share",
      "Economic value",
    ],
    v.clusters.map(
      (c) =>
        html`<tr data-testid="cluster-row"> <td> <a href="/demand/${c.id}" data-testid="cluster-link">${c.label}</a> </td> <td> ${badge(
          label(FAMILY_LABEL, c.intent_family),
          "amber",
          "cluster-family",
        )} </td> <td>${c.buyer_stage}</td> <td>${c.demand_volume}</td> <td class="mono">${pct(c.demand_weight, 1)}</td> <td class="mono">${Number(c.economic_value).toFixed(2)}</td> </tr>`,
    ),
    "No clusters yet.",
  );
  return html`${title(
    "Demand graph",
    "We do not ask you to invent fifty prompts. Every cluster below comes from questions your buyers already asked — Search Console, site search, support chat, sales calls, CRM loss reasons, review sites and public communities — and is filed under one intent family. Families are never averaged together.",
  )}${section("Import demand signals", importForm, {
    count: "source,question,volume",
  })}${section("Intent clusters", clusters, {
    count: String(v.clusters.length),
    countId: "cluster-count",
  })}${section(
    "Family breakdown",
    html`<div class="metric-row"> ${INTENT_FAMILIES.map(
      (f) =>
        html`<div class="metric"> <div class="label">${FAMILY_LABEL[f]}</div> <div class="value">${v.byFamily[f] ?? 0}</div> <div class="sub">clusters</div> </div>`,
    )} </div>`,
    { count: "why blending is refused" },
  )}${section(
    "Raw signals",
    table(
      ["Source", "Question", "Volume", "Clustered"],
      v.signals
        .slice(0, 60)
        .map(
          (s) =>
            html`<tr data-testid="signal-row"> <td>${label(SOURCE_LABEL, s.source)}</td> <td>${s.question}</td> <td>${s.volume}</td> <td>${s.cluster_id ? "yes" : "no"}</td> </tr>`,
        ),
    ),
    { count: String(v.signals.length) },
  )}`;
}
export function clusterDetailView(v: {
  cluster: any;
  variants: any[];
  runs: any[];
  absence: any;
  signals: any[];
}): Raw {
  const c = v.cluster;
  return html`${title(
    c.label,
    `${label(FAMILY_LABEL, c.intent_family)} · ${c.buyer_stage} · demand share ${pct(c.demand_weight, 1)} · ${c.demand_volume} monthly questions`,
    "cluster-detail-label",
  )} <div class="detail-grid"> <div> ${panel(
    "Brand absence in this cluster",
    html`<p data-testid="absence-measure">${measureEl(v.absence)}</p> <p class="section-note"> Absence is only reported when the interval's lower bound clears half. A single missing answer is not a finding. </p>`,
  )}${panel(
    "Sampled answers",
    v.runs.length
      ? html`${v.runs
          .slice(0, 8)
          .map(
            (r) =>
              html`<article> <div class="answer">${r.answer_text}</div> <div class="provenance"> ${[
                `${r.provider}/${r.model_id}`,
                r.surface,
                r.grounding,
                `${r.geo}/${r.language}`,
                r.window_label,
              ].map((text) => html`<span>${text}</span>`)} </div> </article>`,
          )}`
      : empty("Not yet sampled."),
  )} </div> <div> ${panel(
    "Prompt variants",
    html`<ul class="plain"> ${v.variants.map(
      (p) =>
        html`<li data-testid="variant"> <span class="mono">${p.geo}/${p.language}</span> ${p.prompt} </li>`,
    )} </ul> <p> <a href="/clusters/${c.id}/markets" data-testid="cluster-markets-link" >Sample this question in more markets</a > </p> <p class="section-note"> Every cluster is sampled with more than one wording, because one phrasing is one sample of a distribution. </p>`,
  )}${panel(
    "Source questions",
    html`<ul class="plain"> ${v.signals
      .slice(0, 12)
      .map((s) => html`<li>${s.question} ${badge(s.source)}</li>`)} </ul>`,
  )} </div> </div>`;
}
export function truthView(v: {
  claims: any[];
  sources: any[];
  brandName: string;
  grouped: Array<{ key: string; rows: any[] }>;
}): Raw {
  const claims = grid(
    [
      "Statement",
      "Subject / predicate",
      "Object",
      "In force",
      "Sensitivity",
      "Approval",
      "",
    ],
    v.claims.map(
      (c) =>
        html`<tr data-testid="claim-row" data-claim-id="${c.id}"> <td>${c.claim_text}</td> <td class="mono">${c.subject} / ${c.predicate}</td> <td>${c.object}</td> <td class="mono"> ${day(c.effective_from)} → ${c.effective_to ? day(c.effective_to) : "current"} </td> <td> ${badge(c.sensitivity, c.sensitivity === "routine" ? "" : "red")} </td> <td data-testid="claim-approval">${c.approved_by ?? "unapproved"}</td> <td> ${
          c.approved_by
            ? html`<a href="/truth/${c.id}" data-testid="claim-history" >history</a >`
            : html`<form method="post" action="/truth/${c.id}/approve" class="inline-form" > <button class="secondary" data-testid="approve-claim"> Approve </button> </form>`
        } </td> </tr>`,
    ),
    "No canonical facts yet.",
  );
  const form = html`<form method="post" action="/truth" class="stack" data-testid="truth-form" > ${input("subject", "Subject", "truth-subject", v.brandName)}${input(
    "predicate",
    "Predicate",
    "truth-predicate",
  )}${input("object", "Object", "truth-object")}${input(
    "claim_text",
    "Human-readable statement",
    "truth-text",
  )}${input(
    "effective_from",
    "Effective from",
    "truth-from",
    day(new Date().toISOString()),
    "date",
  )}${select("sensitivity", "Sensitivity", "truth-sensitivity", [
    ["routine", "routine"],
    ["material", "material — contradictions are critical"],
    ["regulated", "regulated — contradictions are critical"],
  ])}${select("supersedes", "Supersedes (optional)", "truth-supersedes", [
    ["", "— nothing —"],
    ...v.claims
      .filter((c) => !c.effective_to)
      .map((c) => [c.id, c.claim_text] as [string, string]),
  ])}<button class="primary" type="submit" data-testid="truth-submit"> Add fact </button> </form>`;
  return html`${title(
    "Truth registry",
    "Facts are true over an interval, not forever. Every entry carries an effective date, an expiry, a source and an approver — which is how we catch answers that are correctly sourced and still wrong, because they cite something that stopped being true.",
  )}${section("Canonical facts", claims, {
    count: String(v.claims.length),
    countId: "claim-count",
  })}${section("Add a canonical fact", form, {
    count: "approval required before it can create defects",
  })}`;
}
export function truthHistoryView(v: {
  subject: string;
  predicate: string;
  rows: any[];
}): Raw {
  return html`${title(
    `${v.subject} · ${v.predicate}`,
    "Every version of this fact, newest first. Nothing is deleted — a superseded fact is what turns a sourced answer into a stale one.",
  )}${table(
    ["Statement", "Object", "In force", "Superseded by", "Approved"],
    v.rows.map(
      (c) =>
        html`<tr data-testid="history-row"> <td>${c.claim_text}</td> <td>${c.object}</td> <td class="mono"> ${day(c.effective_from)} → ${c.effective_to ? day(c.effective_to) : "current"} </td> <td>${c.superseded_by_id ?? "—"}</td> <td>${c.approved_by ?? "unapproved"}</td> </tr>`,
    ),
  )}`;
}
export function observatoryView(v: {
  runs: any[];
  surfaces: string[];
  windows: string[];
  lastResult: any | null;
}): Raw {
  const form = html`<form method="post" action="/sampling/run" class="stack" data-testid="sampling-form" > ${input("window_label", "Window label", "window-label", "post")}${input(
    "budget",
    "Run budget for this round",
    "budget",
    "60",
    "number",
    raw('min="5" max="600"'),
  )}<button class="primary" type="submit" data-testid="run-sampling"> Sample now </button> </form> ${
    v.lastResult
      ? html`<p class="hint" data-testid="sampling-result">${v.lastResult}</p>`
      : null
  }`;
  const rows = v.runs
    .slice(0, 80)
    .map(
      (r) =>
        html`<tr data-testid="run-row"> <td class="mono">${stamp(r.requested_at)}</td> <td class="mono"> ${r.provider}/${r.model_id}@${r.model_version} · ${r.surface} </td> <td>${r.grounding} ${r.simulated ? badge("sim", "sim") : null}</td> <td>${r.geo}/${r.language}</td> <td>${r.window_label}</td> <td class="mono">$${Number(r.cost_usd).toFixed(4)}</td> <td> <a href="/runs/${r.id}" data-testid="run-link" >${r.answer_text.slice(0, 90)}…</a > </td> </tr>`,
    );
  return html`${title(
    "Observatory",
    "Every run records the exact surface it came from. “ChatGPT” is not a measurement surface: provider, model, version, access mode, grounding mode, geo, language, personalization state and system config all change the answer, so all of them are stored.",
  )}${section("Run a sampling round", form, {
    count: `adaptive allocation, ${MIN_SAMPLES}-run floor`,
  })}${section(
    "Recent runs",
    grid(
      ["When", "Surface", "Grounding", "Geo", "Window", "Cost", "Answer"],
      rows,
      "No runs yet.",
    ),
    { count: String(v.runs.length), countId: "run-count" },
  )}`;
}
export function runDetailView(v: {
  run: any;
  observed: any[];
  citations: any[];
  searchQueries: string[];
}): Raw {
  const r = v.run;
  const provenance: Array<[string, unknown]> = [
    ["Provider", r.provider],
    ["Model", r.model_id],
    ["Version", r.model_version],
    ["Surface", r.surface],
    ["Grounding", r.grounding],
    ["Search mode", r.search_mode],
    ["Geo / language", `${r.geo} / ${r.language}`],
    ["Personalization", r.personalization],
    ["System config", r.system_config_hash],
    ["Temperature", r.temperature],
    ["Seed", r.seed],
    ["Simulated", r.simulated ? "yes" : "no"],
    ["Sampling reason", r.sampling_reason],
    ["Window", r.window_label],
    ["Latency", `${r.latency_ms} ms`],
    ["Extractor", v.observed[0]?.extractor_version ?? "n/a"],
    ["Raw response", r.raw_response_ref],
  ];
  const citations = html`<p class="hint"> Every cited page is fetched and stored by the hash of its bytes, so "the cited page does not contain this claim" is still checkable after the page changes. </p> ${
    v.citations.length
      ? table(
          [
            "URL",
            "Class",
            "Supports the claim?",
            "Checked against",
            "Snapshot",
            "",
          ],
          v.citations.map(
            (c) =>
              html`<tr data-testid="citation-row"> <td class="mono">${c.url}</td> <td>${c.source_class}</td> <td> <b data-testid="citation-support">${c.support}</b> <div class="hint">${c.reason || ""}</div> </td> <td>${c.checked_claim || "—"}</td> <td> ${
                c.snapshot_sha256
                  ? html`<a href="/snapshot/${c.snapshot_sha256}" data-testid="snapshot-link" >${String(c.snapshot_sha256).slice(0, 12)}</a > <div class="hint"> ${day(c.snapshot_fetched_at ?? "")}${
                      c.http_status ? ` · HTTP ${c.http_status}` : ""
                    } </div>`
                  : html`<span class="hint" data-testid="no-snapshot" >${c.fetch_error ?? "not retrieved"}</span >`
              } </td> <td class="row-actions"> <form method="post" action="/citations/${c.id}/recheck"> <button class="linkbtn" data-testid="recheck"> Re-check </button> </form> </td> </tr>`,
          ),
        )
      : html`<p class="hint">No sources cited.</p>`
  }`;
  return html`${title(
    `Run ${r.id}`,
    "Full provenance, extracted claims and citation checks for a single sampled answer.",
  )} <div class="detail-grid"> <div> ${panel(
    "Answer",
    html`<div class="answer" data-testid="run-answer"> ${r.answer_text} </div>`,
  )}${panel(
    "Extracted claims",
    table(
      [
        "Statement",
        "Predicate",
        "Object",
        "Verdict",
        "Severity",
        "Adjudication",
      ],
      v.observed.map(
        (o) =>
          html`<tr data-testid="observed-row"> <td>${o.statement}</td> <td>${o.predicate}</td> <td>${o.object}</td> <td><b>${o.verdict}</b></td> <td>${o.severity}</td> <td>${o.adjudication}</td> </tr>`,
      ),
    ),
  )}${panel("Citations", citations)} </div> <div> ${panel(
    "Provenance",
    html`<dl class="kv" data-testid="run-provenance"> ${provenance.map(
      ([key, value]) =>
        html`<dt>${key}</dt> <dd>${value == null ? "—" : String(value)}</dd>`,
    )} <dt>Cost</dt> <dd data-testid="run-cost"> ${
      r.cost_known === 0
        ? "unpriced (the provider reported no usage)"
        : `$${Number(r.cost_usd).toFixed(5)}`
    } </dd> </dl>`,
  )}${panel(
    "Search queries performed",
    v.searchQueries.length
      ? list(v.searchQueries)
      : html`<p class="hint"> None exposed by this surface (ungrounded run). </p>`,
  )} </div> </div>`;
}
const effect = (value: number): string => (value * 100).toFixed(0);
export function actionsView(v: { actions: any[] }): Raw {
  return html`${title(
    "Actions",
    "Every action carries evidence, stated assumptions and an experiment. Nothing here is an AI-generated suggestion with an invented impact percentage attached.",
  )}${grid(
    ["Action", "Type", "State", "Priority", "Expected range", "Experiment"],
    v.actions.map(
      (a) =>
        html`<tr data-testid="action-row"> <td> <a href="/actions/${a.id}" data-testid="action-link">${a.title}</a> </td> <td>${label(ACTION_LABEL, a.action_type)}</td> <td> ${badge(
          label(STATE_LABEL, a.state),
          a.state === "confirmed"
            ? "green"
            : a.state === "rejected"
              ? "red"
              : "amber",
          "action-state",
        )} </td> <td class="mono">${Number(a.priority).toFixed(3)}</td> <td> ${
          a.expected_low === null
            ? "ships as experiment"
            : `${effect(a.expected_low)} to ${effect(a.expected_high)} pts`
        } </td> <td> ${
          a.experiment_id
            ? html`<a href="/experiments/${a.experiment_id}">open</a>`
            : "—"
        } </td> </tr>`,
    ),
    "No actions yet.",
    "actions-empty",
  )}`;
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
  const a = v.action;
  const order: ActionState[] = [
    "detected",
    "approved",
    "shipped",
    "crawled",
    "observed",
    "confirmed",
  ];
  const current = order.indexOf(a.state);
  const track = html`<div class="state-track" data-testid="state-track"> ${order.map(
    (state, index) =>
      html`<span class="step ${
        state === a.state ? "current" : current > index ? "done" : ""
      }" >${STATE_LABEL[state]}</span >${
        index < order.length - 1
          ? html`<span class="arrow" aria-hidden="true">→</span>`
          : null
      }`,
  )}${
    ["rejected", "dismissed"].includes(a.state)
      ? html`<span class="step dead">${label(STATE_LABEL, a.state)}</span>`
      : null
  } </div>`;
  const advance = v.next.length
    ? html`<form method="post" action="/actions/${a.id}/transition" class="stack" data-testid="transition-form" > <div> <label for="to">Next state</label ><select id="to" name="to" data-testid="transition-select"> ${ACTION_STATES.map(
        (state) =>
          html`<option value="${state}" ${v.next.includes(state) ? "" : raw('data-illegal="1"')}> ${STATE_LABEL[state]}${
            v.next.includes(state) ? "" : " — illegal from here"
          } </option>`,
      )} </select> </div> ${input("note", "Note", "transition-note")}<button class="primary" type="submit" data-testid="transition-submit" > Advance </button> </form> <p class="section-note"> Legal from ${label(STATE_LABEL, a.state)}: ${
        (ALLOWED_TRANSITIONS[a.state as ActionState] ?? [])
          .map((state) => STATE_LABEL[state])
          .join(", ") || "none"
      }. </p>`
    : html`<p class="hint" data-testid="terminal-state"> Terminal state — no further transitions are legal. </p>`;
  const factorNames = [
    ["Demand", "demand"],
    ["Buyer intent", "buyerIntent"],
    ["Economic value", "economicValue"],
    ["Defect probability", "defectProbability"],
    ["Fixability", "fixability"],
    ["Confidence", "confidence"],
    ["Score", "score"],
  ];
  return html`${title(
    a.title,
    label(ACTION_LABEL, a.action_type),
    "action-title",
  )}${track} <div class="detail-grid"> <div> ${panel("Rationale", html`<p>${a.rationale}</p>`)}${panel(
    "Evidence",
    html`${list(v.evidence, undefined, "evidence-item")} <p class="section-note"> An action with no evidence is an opinion; the API rejects it. </p>`,
  )}${panel(
    "Assumptions",
    list(v.assumptions, undefined, "assumption-item"),
  )}${panel(
    "Expected range",
    html`<p data-testid="expected-range"> ${
      a.expected_low === null
        ? "No comparable prior in this workspace — this ships as an experiment, not a prediction."
        : `${effect(a.expected_low)} to ${effect(a.expected_high)} points`
    } </p> <p class="section-note">${a.expected_basis}</p>`,
  )} </div> <div> ${panel("Advance", advance)}${panel(
    "Priority factors",
    html`<dl class="kv" data-testid="priority-factors"> ${factorNames.map(
      ([name, key]) =>
        html`<dt>${name}</dt> <dd> ${
          typeof v.factors[key!] === "number" ? v.factors[key!].toFixed(3) : "—"
        } </dd>`,
    )} </dl>`,
  )}${
    v.experiment
      ? panel(
          "Experiment",
          html`<p> <a href="/experiments/${v.experiment.id}" data-testid="action-experiment-link" >${label(METRIC_LABEL, v.experiment.metric)}</a > — ${v.experiment.verdict} </p>`,
        )
      : null
  }${panel(
    "History",
    list(
      v.transitions.map(
        (t) =>
          `${stamp(t.created_at)} ${t.from_state} → ${t.to_state} (${t.actor}) ${t.note}`,
      ),
      undefined,
      "transition-row",
    ),
  )} </div> </div>`;
}
const ratio = (e: any, prefix: string): string =>
  e[`${prefix}_n`] ? `${e[`${prefix}_k`]}/${e[`${prefix}_n`]}` : "—";
export function experimentsView(v: {
  experiments: any[];
  actionsById: Record<string, any>;
}): Raw {
  return html`${title(
    "Experiment ledger",
    "Baseline, treatment, matched controls, publish and crawl dates, and the alternative explanations we could not rule out. Reported the same way whether the answer flatters the intervention or not.",
  )}${grid(
    ["Action", "Metric", "Baseline", "Post", "DiD", "p", "Verdict", ""],
    v.experiments.map(
      (e) =>
        html`<tr data-testid="experiment-row"> <td>${v.actionsById[e.action_id]?.title ?? e.action_id}</td> <td>${label(METRIC_LABEL, e.metric)}</td> <td>${ratio(e, "baseline")}</td> <td>${ratio(e, "post")}</td> <td> ${e.did_effect === null ? "—" : `${effect(e.did_effect)} pts`} </td> <td>${formatP(e.p_value)}</td> <td> ${badge(
          e.verdict,
          e.verdict === "confirmed"
            ? "green"
            : e.verdict === "rejected"
              ? "red"
              : "",
          "experiment-verdict",
        )} </td> <td> <a href="/experiments/${e.id}" data-testid="experiment-link" >open</a > </td> </tr>`,
    ),
    "No experiments yet.",
    "experiments-empty",
  )}`;
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
  const metrics: Array<[string, string, string, string?]> = [
    [
      "Baseline",
      ratio(e, "baseline"),
      e.baseline_n
        ? formatMeasurement(measure(e.baseline_k, e.baseline_n))
        : "not analyzed",
      "exp-baseline",
    ],
    [
      "Post",
      ratio(e, "post"),
      e.post_n
        ? formatMeasurement(measure(e.post_k, e.post_n))
        : "not analyzed",
      "exp-post",
    ],
    [
      "Difference-in-differences",
      e.did_effect === null ? "—" : effect(e.did_effect),
      "points vs control",
    ],
    [
      "Probability real",
      e.probability_real === null ? "—" : pct(e.probability_real),
      "1 − one-sided p",
      "exp-probability",
    ],
    ["Verdict", e.verdict, `p=${formatP(e.p_value)}`, "exp-verdict"],
  ];
  const design = html`<dl class="kv"> <dt>Treatment clusters</dt> <dd>${v.treatmentLabels.join(", ") || "—"}</dd> <dt>Control clusters</dt> <dd data-testid="control-clusters"> ${v.controlLabels.join(", ") || "none available — stated, not hidden"} </dd> <dt>Baseline window</dt> <dd>${e.baseline_window}</dd> <dt>Post window</dt> <dd>${e.post_window}</dd> ${[
    ["Published", "published_at"],
    ["Crawled", "crawled_at"],
    ["Indexed", "indexed_at"],
  ].map(
    ([name, key]) =>
      html`<dt>${name}</dt> <dd>${e[key!] ? stamp(e[key!]) : "—"}</dd>`,
  )} </dl>`;
  const outcomes = v.outcomes.length
    ? html`${table(
        ["Source", "Metric", "Baseline", "Post", "Reading"],
        v.outcomes.map(
          (o) =>
            html`<tr data-testid="outcome-row"> <td>${o.source}</td> <td>${o.metric}</td> <td>${o.baseline_value}</td> <td>${o.post_value}</td> <td>${badge(o.interpretation)}</td> </tr>`,
        ),
      )} <p class="section-note" data-testid="outcome-caveat"> ${v.outcomes[0].caveat} </p>`
    : html`<p class="hint">None attached.</p>`;
  return html`${title(
    `Experiment · ${label(METRIC_LABEL, e.metric)}`,
    v.action?.title ?? e.action_id,
  )} <form method="post" action="/experiments/${e.id}/analyze" class="inline-form" data-testid="analyze-form" > <button class="primary" type="submit" data-testid="analyze-submit"> Analyze from stored runs </button> </form> <div class="metric-row"> ${metrics.map(
    ([name, value, note, id]) =>
      html`<div class="metric"> <div class="label">${name}</div> <div class="value" ${id ? raw(`data-testid="${id}"`) : ""}> ${value} </div> <div class="sub">${note}</div> </div>`,
  )} </div> <div class="detail-grid"> <div> ${panel("Design", design)}${panel("Business outcomes", outcomes)} </div> <div> ${panel(
    "What else could explain this",
    list(v.analysis.alternatives, "alternatives"),
  )}${panel(
    "Reading",
    html`<p data-testid="exp-narrative">${v.analysis.narrative}</p>`,
  )} </div> </div>`;
}
export function crawlersView(v: {
  byClass: Record<string, any[]>;
  findings: any[];
  total: number;
}): Raw {
  return html`${title(
    "Crawler access",
    "Bots are grouped by what they actually do. Training ingestion, retrieval indexing, user-triggered fetches and agentic browsing are different jobs — unblocking the wrong one costs a change-control cycle and fixes nothing.",
  )}${section(
    "Blocked retrieval",
    grid(
      ["Bot", "Purpose class", "Blocked", "Total hits", "Blocked by"],
      v.findings.map(
        (f) =>
          html`<tr data-testid="crawler-row"> <td class="mono">${f.botName}</td> <td> ${badge(
            BOT_CLASS_LABEL[f.botClass as BotClass],
            f.botClass === "search_index" ? "amber" : "",
            "bot-class",
          )} </td> <td>${f.blockedCount}</td> <td>${f.totalCount}</td> <td>${f.blockedBy || "—"}</td> </tr>`,
      ),
      "No crawler events recorded.",
    ),
    { count: `${v.total} events`, countId: "crawler-total" },
  )}${section(
    "What each class can and cannot change",
    table(
      ["Bot", "Operator", "Class", "What allowing it affects"],
      BOT_SIGNATURES.map(
        (bot) =>
          html`<tr> <td>${bot.name}</td> <td>${bot.operator}</td> <td>${BOT_CLASS_LABEL[bot.botClass]}</td> <td>${bot.effect}</td> </tr>`,
      ),
    ),
    { count: `${BOT_SIGNATURES.length} signatures` },
  )}`;
}
export function entitiesView(v: { relationships: any[] }): Raw {
  return html`${title(
    "Entity relationships",
    "Co-occurrence is not competition. Every edge carries a basis, and an edge derived from co-mention alone can only ever be “unrelated co-mention” until a human classifies it.",
  )}${grid(
    ["Entity", "Relation", "Basis", "Confidence", "Note", "Reclassify"],
    v.relationships.map(
      (r) =>
        html`<tr data-testid="entity-row"> <td>${r.entity_name}</td> <td> ${badge(
          label(RELATION_LABEL, r.relation),
          r.relation === "competitor" ? "amber" : "",
          "entity-relation",
        )} </td> <td data-testid="entity-basis">${r.basis}</td> <td>${Number(r.confidence).toFixed(2)}</td> <td>${r.note}</td> <td> <form method="post" action="/entities/${r.entity_id}/classify" class="inline-form" > <select name="relation" aria-label="Relation for ${r.entity_name}" data-testid="relation-select" > ${RELATIONS.map(
          (relation) =>
            html`<option value="${relation}" ${relation === r.relation ? raw("selected") : ""} > ${RELATION_LABEL[relation]} </option>`,
        )}</select ><select name="basis" aria-label="Evidence basis for ${r.entity_name}" data-testid="basis-select" > ${[
          ["customer_declared", "customer declared"],
          ["market_registry", "market registry"],
          ["contract", "contract"],
          ["observed_comention", "observed co-mention"],
        ].map(
          ([key, text]) => html`<option value="${key}">${text}</option>`,
        )}</select ><button class="secondary" data-testid="classify-submit"> Set </button> </form> </td> </tr>`,
    ),
    "No entities observed yet.",
    "entities-empty",
  )}`;
}
export function methodologyView(v: {
  stats: any;
  extractor: any | null;
  prices: any;
  retentionDays: number;
  snapshotCount: number;
}): Raw {
  const sampling = html`<dl class="kv" data-testid="methodology-sampling"> <dt>Minimum samples</dt> <dd> ${v.stats.minSamples} runs per cluster per window before any rate is displayed </dd> <dt>Maximum samples</dt> <dd> ${v.stats.maxSamples} runs, allocated by demand × value × volatility × defect risk </dd> <dt>Interval</dt> <dd>95% Wilson score interval (correct at k=0 and k=n)</dd> <dt>Alerting</dt> <dd> two-proportion z-test, p &lt; ${v.stats.alpha}, minimum effect ${pct(v.stats.minEffect)}, Benjamini-Hochberg at q=${v.stats.bhQ} </dd> <dt>Below the floor</dt> <dd> the number is suppressed and labelled “insufficient data”, never rounded into a percentage </dd> <dt>Surfaces recorded</dt> <dd> provider, model, version, access mode, grounding, search mode, geo, language, personalization, system config hash, temperature, seed </dd> </dl>`;
  const x = v.extractor;
  const extractor = x
    ? html`<p class="section-note"> Everything on the answer desk rests on a layer that reads a sentence and decides what it asserted. These are its measured numbers on a held-out split, regenerated by <span class="mono">npm run eval:extractor</span>. A predicate below the ${pct(x.gates.precision)} precision gate is marked recall-only: it still appears in a drill-down and it never raises an alert. </p> <div class="stat-row"> ${[
        ["Gold set", x.goldSetSize, "gold-size"],
        ["Held out", x.holdoutSize, ""],
        ["Distractors", x.distractors, ""],
        ["Recall lift over patterns alone", `${effect(x.recallLift)} pts`, ""],
      ].map(
        ([name, value, id]) =>
          html`<div class="stat"> <span class="stat-label">${name}</span ><span class="stat-value" ${id ? raw(`data-testid="${id}"`) : ""} >${value}</span > </div>`,
      )} </div> <div data-testid="extractor-table"> ${table(
        ["Predicate", "Precision", "Recall", "F1", "Held-out claims", ""],
        x.perPredicate.map(
          (p: any) =>
            html`<tr> <td class="mono">${p.predicate}</td> <td>${p.precision.toFixed(2)}</td> <td>${p.recall.toFixed(2)}</td> <td>${p.f1.toFixed(2)}</td> <td>${p.support}</td> <td> ${
              p.recallOnly ? badge("recall-only", "", "recall-only") : null
            } </td> </tr>`,
        ),
      )} </div> <p class="section-note" data-testid="extractor-caveat"> <b>How to read this.</b> ${x.caveat} </p>`
    : html`<p class="section-note" data-testid="extractor-missing"> No evaluation has been run. Until one has, the precision of every defect on the answer desk is unmeasured, and this page will keep saying so. </p>`;
  const retention = html`<p class="section-note"> Every cited page is fetched at sampling time and stored by the hash of its bytes, so "the cited page does not contain the claim" is still checkable after the page changes. We honour robots.txt, cap concurrency at two requests per host, and identify ourselves. A snapshot an open defect or a confirmed experiment depends on is kept indefinitely; anything else is pruned after ${v.retentionDays} days. </p>`;
  const costs = html`<p class="section-note"> A run whose provider returned no usage block is recorded as unpriced rather than as free, and is excluded from spend totals. Budgets are enforced before a round spends, by dropping whole clusters rather than thinning every one of them below the point where a rate can be shown. </p> ${table(
    ["Model", "Input / Mtok", "Output / Mtok", "Per search call"],
    Object.entries(v.prices.table).map(
      ([model, p]: any) =>
        html`<tr> <td>${model}</td> <td>$${p.inputPerMTok.toFixed(2)}</td> <td>$${p.outputPerMTok.toFixed(2)}</td> <td>$${p.searchPerCall.toFixed(3)}</td> </tr>`,
    ),
  )}`;
  const limitations = [
    "We cannot control what an external model says. We measure it, correct the record, and test whether answers moved.",
    "We do not produce a single blended visibility score. Branded and unaided prompts answer different questions and are never averaged.",
    "We do not predict an impact percentage for a recommendation unless this workspace has a cohort of comparable confirmed experiments.",
    "We do not claim prompt-level revenue attribution. Assistants rarely pass the originating conversation, and assistant referrals remain a small share of tracked traffic.",
    "We do not post to third-party sites, generate reviews, or manufacture mentions. That is spam, and it is not in the action catalogue.",
    "Simulated runs are labelled as such everywhere and are excluded from any customer-facing claim.",
  ];
  const plans = [
    [
      "Answer Risk Audit",
      "One-time automatic sample, provisional site facts, findings for human review",
      "free",
    ],
    [
      "Monitor",
      "50 intent clusters, 4 surfaces, weekly and adaptive sampling",
      "$750/mo",
    ],
    [
      "Operate",
      "100 clusters, daily sampling, truth registry, execution and experiments",
      "$2,000/mo",
    ],
    [
      "Enterprise / agency",
      "Multi-brand, CRM, governance, export",
      "$5,000+/mo",
    ],
  ];
  const economics = html`<p class="section-note"> Early access: the one-time audit is free; ongoing pilots are scoped individually before any paid engagement. The table below preserves historical planning examples for reference and is not a current price list. </p><p class="section-note"> A sample workload of 50 clusters × 4 providers × 5 repetitions × 30 days produces 30,000 answers a month. Actual cost depends on model tokens, search tools, retries and human review. Set a usage budget and measure realized costs before choosing a cadence. </p> ${table(
    ["Historical plan", "Proposed coverage", "Historical price"],
    plans.map(
      ([name, coverage, price]) =>
        html`<tr> <td>${name}</td> <td>${coverage}</td> <td class="mono">${price}</td> </tr>`,
    ),
  )} <p class="section-note"> Agree the live surfaces, sampling budget and review responsibilities for each pilot. </p>`;
  return html`${title(
    "Methodology & limitations",
    "Trust is the product. This page states how the numbers are produced, what they can support, and what we deliberately refuse to claim. If any of it stops being true, this page is the bug report.",
  )}${section("Sampling design", sampling)}${section(
    "Extractor accuracy",
    extractor,
    {
      count: x ? `evaluated ${x.evaluatedAt}` : "not evaluated",
      countId: "extractor-evaluated",
    },
  )}${section("Evidence retention", retention, {
    count: `${v.snapshotCount} snapshots held`,
    countId: "snapshot-count",
  })}${section("What a measurement costs", costs, {
    count: `list prices reviewed ${v.prices.reviewed}`,
  })}${section(
    "What we do not claim",
    list(limitations, "methodology-limits"),
  )}${section("Unit economics", economics)}${section(
    "Action catalogue",
    table(
      ["Action", "Fixability prior"],
      ACTION_TYPES.map(
        (type) =>
          html`<tr> <td>${ACTION_LABEL[type]}</td> <td class="mono">${v.stats.fixability[type].toFixed(2)}</td> </tr>`,
      ),
    ),
    { count: "closed by design" },
  )}`;
}
export function auditView(v: { rows: any[] }): Raw {
  return html`${title(
    "Audit log",
    "Append-only. Every mutation carries an actor, a target and a summary — including ours.",
  )}${grid(
    ["When", "Actor", "Action", "Target", "Summary"],
    v.rows.map(
      (r) =>
        html`<tr data-testid="audit-row"> <td class="mono">${stamp(r.created_at)}</td> <td>${r.actor}</td> <td>${r.action}</td> <td>${r.target_type}/${r.target_id}</td> <td>${r.summary}</td> </tr>`,
    ),
    "Nothing logged yet.",
  )}`;
}
