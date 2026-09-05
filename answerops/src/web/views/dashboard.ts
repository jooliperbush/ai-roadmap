import { html, raw, pct, type Raw } from "../html.js";
import type { DashboardData } from "../../services/dashboard.js";
import {
  formatMeasurement,
  formatP,
  type Measurement,
} from "../../domain/stats.js";
import { FAMILY_LABEL } from "../../domain/intent.js";
import { ACTION_LABEL } from "../../domain/priority.js";
import { section, table, empty, panel, properties } from "./components.js";
export function measureEl(m: Measurement): Raw {
  if (!m.sufficient || m.point == null || m.ciLow == null || m.ciHigh == null)
    return html`<span class="measure insufficient" data-testid="measurement" >insufficient data (n=${m.n})</span >`;
  return html`<span class="measure" data-testid="measurement" ><span class="point">${pct(m.point)}</span> <span class="ci" >95% CI ${pct(m.ciLow).replace("%", "")}–${pct(m.ciHigh)}</span > <span class="n">n=${m.n}</span></span >`;
}
function card(
  kind: string,
  url: string,
  headline: string,
  badge: Raw,
  details: Raw,
): Raw {
  return html`<a class="card" href="${url}" data-testid="${kind}-card" ><div class="card-top"> <div class="card-headline" data-testid="${kind}-headline"> ${headline} </div> ${badge} </div> <div class="card-meta">${details}</div></a >`;
}
export function dashboardView(d: DashboardData): Raw {
  const defects = d.defects.map((f, index) =>
    card(
      "defect",
      `/defect/${encodeURIComponent(f.misconceptionKey)}`,
      f.headline,
      html`<span class="severity ${f.severity}">${f.severity}</span>`,
      html`<span>${measureEl(f.measurement)}</span ><span>verdict <b>${f.verdict}</b></span ><span>intent <b>${FAMILY_LABEL[f.intentFamily]}</b></span ><span>surfaces <b>${f.providers.join(", ") || "—"}</b></span ><span>priority <b>#${index + 1}</b> (${f.priority.toFixed(4)})</span >${
        f.baselineComparison
          ? html`<span>vs baseline <b>${
              f.baselineComparison.significant
                ? "moved (significant)"
                : "no significant change"
            }</b > p=${formatP(f.baselineComparison.pValue)}${
              f.baselineComparison.qValue != null
                ? ` q=${formatP(f.baselineComparison.qValue)}`
                : ""
            }</span >`
          : null
      }`,
    ),
  );
  const demand = d.missedDemand.map((m, index) =>
    card(
      "demand",
      `/demand/${m.clusterId}`,
      m.label,
      html`<span class="pill amber">${FAMILY_LABEL[m.intentFamily]}</span>`,
      html`<span>absent in ${measureEl(m.absence)}</span ><span>demand share <b>${pct(m.demandWeight)}</b></span ><span>volume <b>${m.demandVolume}</b></span ><span>stage <b>${m.buyerStage}</b></span ><span>priority <b>#${index + 1}</b> (${m.priority.toFixed(4)})</span>`,
    ),
  );
  const wins = d.confirmedWins.map((w) =>
    card(
      "win",
      `/experiments/${w.experimentId}`,
      `After “${w.actionTitle}”: ${w.narrative}`,
      html`<span class="pill green">${pct(w.probabilityReal)} real</span>`,
      html`<span>baseline ${measureEl(w.baseline)}</span ><span>post ${measureEl(w.post)}</span ><span>difference-in-differences <b>${(w.didEffect * 100).toFixed(0)} pts</b></span ><span>${
        w.hasControl ? "matched controls" : "no control cluster available"
      }</span >`,
    ),
  );
  return html`<h1>Answer desk — ${d.brand.name}</h1> <p class="lede"> Three questions, and only three: what is wrong, what are we missing, and did the last fix work. Window <b>${d.window}</b> · ${d.totalRuns} sampled answers across ${d.coverage.surfaces} distinct model surfaces ${
    d.simulatedRuns > 0
      ? html`<span class="pill sim" data-testid="sim-badge" >${d.simulatedRuns} simulated runs</span >`
      : null
  } </p> <form method="get" action="/" class="inline-form" data-testid="window-picker" > <label for="window">Sampling window</label ><select id="window" name="window" onchange="this.form.submit()" data-testid="window-select" > ${d.windows.map(
    (w) =>
      html`<option value="${w.label}" ${w.label === d.window ? raw("selected") : ""} > ${w.label} — ${w.runs} runs, ${w.clusters} clusters${w.comparable ? "" : " (partial probe)"} </option>`,
  )}</select ><noscript><button class="secondary" type="submit">Show</button></noscript > </form> ${section(
    "1 · Critical answer defects",
    defects.length
      ? html`${defects}`
      : empty(
          "No defect clears the evidence bar in this window.",
          "defects-empty",
        ),
    {
      id: "section-defects",
      count: `${defects.length} open`,
      countId: "defect-count",
      note: "A defect is a claim that contradicts your approved record, or repeats something that stopped being true. Positive sentiment does not redeem a false answer.",
    },
  )} ${section(
    "2 · Missed commercial demand",
    demand.length
      ? html`${demand}`
      : empty(
          "No high-intent cluster shows defensible absence in this window.",
          "demand-empty",
        ),
    {
      id: "section-demand",
      count: `${demand.length} clusters`,
      countId: "demand-count",
      note: html`High-intent question clusters where you are absent from the answer often enough that the interval's lower bound clears half. Worth an estimated <b>${pct(d.missedDemandShare)}</b> of tracked category demand.`,
    },
  )} ${section(
    "3 · Confirmed wins",
    wins.length
      ? html`${wins}`
      : empty(
          "No intervention has cleared the evidence bar yet.",
          "wins-empty",
        ),
    {
      id: "section-wins",
      count: `${wins.length} confirmed`,
      countId: "wins-count",
      note: "An intervention counts here only after a controlled comparison, not because a number went up.",
    },
  )} ${section(
    "Coverage by intent family",
    table(
      ["Intent family", "Clusters", "Sampled answers", "Defect rate (95% CI)"],
      d.familySummaries.map(
        (f) =>
          html`<tr data-testid="family-row"> <td>${f.label}</td> <td class="mono">${f.clusters}</td> <td class="mono">${f.runs}</td> <td>${measureEl(f.defectRate)}</td> </tr>`,
      ),
    ),
    {
      id: "section-families",
      count: "never blended",
      note: "There is deliberately no single visibility score. Branded prompts nearly guarantee a mention; averaging them with unaided discovery produces a number that flatters you and tells you nothing.",
    },
  )}`;
}
/** Select non-overlapping spans in the original text, then escape once at emission. */
export function highlight(answer: string, statements: string[]): Raw {
  const ranges: Array<[number, number]> = [];
  for (const statement of [...new Set(statements.map((s) => s.trim()))].sort(
    (a, b) => b.length - a.length,
  )) {
    if (statement.length < 8) continue;
    let offset = answer.indexOf(statement);
    while (offset >= 0) {
      const end = offset + statement.length;
      if (!ranges.some(([a, b]) => offset < b && end > a))
        ranges.push([offset, end]);
      offset = answer.indexOf(statement, offset + statement.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let previous = 0;
  const pieces: Raw[] = [];
  for (const [start, end] of ranges) {
    pieces.push(
      html`${answer.slice(previous, start)}<mark>${answer.slice(start, end)}</mark >`,
    );
    previous = end;
  }
  return html`${pieces}${answer.slice(previous)}`;
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
  const answers = v.runs.map(
    ({ run, statements, citations }) =>
      html`<article data-testid="answer-block"> <div class="answer"> ${highlight(
        run.answer_text,
        statements.map((s) => s.statement),
      )} </div> <div class="provenance" data-testid="provenance"> ${[
        `${run.provider}/${run.model_id}@${run.model_version}`,
        `surface: ${run.surface}`,
        `grounding: ${run.grounding}`,
        `search: ${run.search_mode}`,
        `${run.geo}/${run.language}`,
        `personalization: ${run.personalization}`,
        `temp ${run.temperature}`,
        `seed ${run.seed}`,
        run.simulated ? "simulated" : "live",
        run.requested_at,
      ].map((text) => html`<span>${text}</span>`)} </div> ${statements.map(
        (s) =>
          html`<div class="card-meta"> <span>claim: <b>${s.statement}</b></span ><span>verdict <b>${s.verdict}</b></span ><span>adjudication <b>${s.adjudication}</b></span> </div>`,
      )}${
        citations.length
          ? table(
              ["Cited source", "Class", "Does the page support the claim?"],
              citations.map(
                (c) =>
                  html`<tr data-testid="citation-row"> <td class="mono">${c.url}</td> <td>${c.source_class}</td> <td><b>${c.support}</b></td> </tr>`,
              ),
            )
          : html`<p class="hint"> No sources cited — an unsourced assertion, not a verified one. </p>`
      } </article>`,
  );
  const fact = v.canonical;
  const canonical = fact
    ? html`<dl class="kv"> <dt>Approved statement</dt> <dd data-testid="canonical-text">${fact.claim_text}</dd> </dl> ${properties(
        [
          ["Subject", fact.subject],
          ["Predicate", fact.predicate],
          ["Object", fact.object],
          ["In force from", fact.effective_from],
          ["Until", fact.effective_to ?? "current"],
          ["Sensitivity", fact.sensitivity],
          ["Approved by", fact.approved_by ?? "not approved"],
        ],
      )}`
    : html`<p class="hint"> No canonical fact covers this claim — this is a registry gap. Add the fact before treating it as a defect. </p>`;
  const intervention = html`<p class="section-note"> ${
    v.expected
      ? html`Expected range: <b>${(v.expected.low * 100).toFixed(0)} to ${(v.expected.high * 100).toFixed(0)} points</b >. ${v.expected.basis}`
      : html`<span data-testid="no-expected-range" >No comparable prior in this workspace — this ships as an experiment, not a prediction. We do not invent an impact percentage.</span >`
  } </p> ${
    v.crawlerNote
      ? html`<p class="section-note" data-testid="crawler-note"> ${v.crawlerNote} </p>`
      : null
  } <form method="post" action="/actions" class="stack" data-testid="create-action-form" > ${Object.entries(
    {
      misconception_key: v.misconceptionKey,
      cluster_id: v.clusterId ?? "",
      treatment_clusters: v.treatmentClusterIds.join(","),
      evidence: v.evidenceIds.join(","),
    },
  ).map(
    ([name, value]) =>
      html`<input type="hidden" name="${name}" value="${value}">`,
  )} <div> <label for="action_type">Intervention</label ><select id="action_type" name="action_type" data-testid="action-type"> ${Object.entries(
    ACTION_LABEL,
  ).map(
    ([key, label]) =>
      html`<option value="${key}" ${key === v.suggestedActionType ? raw("selected") : ""} > ${label} </option>`,
  )} </select> </div> <div> <label for="title">Title</label ><input id="title" name="title" type="text" value="Correct the record on ${v.defectSubject}" data-testid="action-title"> </div> <div> <label for="rationale">Rationale</label ><textarea id="rationale" name="rationale" data-testid="action-rationale" > ${v.headline}</textarea > </div> <label class="hint" ><input type="checkbox" name="drop_evidence" value="1" data-testid="drop-evidence"> submit without evidence (will be rejected)</label ><button class="primary" type="submit" data-testid="create-action"> Create action </button> </form>`;
  return html`<h1 data-testid="defect-detail-headline">${v.headline}</h1> <p class="lede"> ${formatMeasurement(v.measurement)} of sampled answers in this window · verdict ${v.verdict} · severity ${v.severity} </p> <div class="detail-grid"> <div> ${panel(
    "Sampled answers",
    answers.length ? html`${answers}` : empty("No stored answers."),
  )} </div> <div> ${panel(
    "Conflicting canonical fact",
    canonical,
    "canonical-panel",
  )}${panel(
    "Why this ranks here",
    html`<div class="formula" data-testid="priority-explanation"> ${v.priorityExplanation} </div>`,
  )}${panel("Recommended intervention", intervention)}${
    v.actions.length
      ? panel(
          "Actions on this defect",
          html`${v.actions.map(
            (a) =>
              html`<p> <a href="/actions/${a.id}" data-testid="linked-action" >${a.title}</a > — ${a.state} </p>`,
          )}`,
        )
      : null
  } </div> </div>`;
}
