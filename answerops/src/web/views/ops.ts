import { html, raw, pct, type Raw } from "../html.js";
import { MIN_SAMPLES } from "../../domain/stats.js";
import { MARKETS, marketLabel } from "../../domain/geo.js";
import { CADENCES } from "../../domain/scheduler.js";
import { K_ANON } from "../../services/index-report.js";
import { SNAPSHOT_RETENTION_DAYS } from "../../domain/fetcher.js";
import { section, table, empty } from "./components.js";
const when = (date: unknown): string =>
  date ? String(date).slice(0, 19).replace("T", " ") : "—";
const money = (value: unknown, digits = 2): string =>
  `$${Number(value).toFixed(digits)}`;
const heading = (title: string, description: string): Raw =>
  html`<h1>${title}</h1> <p class="lede">${description}</p>`;
const badge = (text: string, tone = "", id?: string): Raw =>
  html`<span class="pill ${tone}" ${id ? raw(`data-testid="${id}"`) : ""} >${text}</span >`;
const action = (
  path: string,
  label: string,
  id: string,
  fields: Record<string, string> = {},
): Raw =>
  html`<form method="post" action="${path}"> ${Object.entries(fields).map(
    ([name, value]) =>
      html`<input type="hidden" name="${name}" value="${value}">`,
  )}<button class="linkbtn" data-testid="${id}">${label}</button> </form>`;
function grid(
  headers: string[],
  rows: Raw[],
  message: string,
  id?: string,
): Raw {
  return rows.length
    ? table(headers, rows)
    : table(headers, [
        html`<tr> <td colspan="${headers.length}">${empty(message, id)}</td> </tr>`,
      ]);
}
function field(
  name: string,
  label: string,
  id: string,
  options: {
    type?: string;
    value?: string;
    min?: number;
    max?: number;
    choices?: Array<[string, string]>;
  } = {},
): Raw {
  return html`<div> <label for="${name}">${label}</label>${
    options.choices
      ? html`<select id="${name}" name="${name}" data-testid="${id}"> ${options.choices.map(
          ([value, text]) =>
            html`<option value="${value}" ${value === options.value ? raw("selected") : ""} > ${text} </option>`,
        )} </select>`
      : html`<input id="${name}" name="${name}" type="${options.type ?? "text"}" value="${options.value ?? ""}" ${options.min != null ? raw(`min="${options.min}"`) : ""} ${options.max != null ? raw(`max="${options.max}"`) : ""} data-testid="${id}">`
  } </div>`;
}
function stats(items: Array<[string, string | number, string]>): Raw {
  return html`<div class="stat-row"> ${items.map(
    ([label, value, id]) =>
      html`<div class="stat"> <span class="stat-label">${label}</span ><span class="stat-value" data-testid="${id}">${value}</span> </div>`,
  )} </div>`;
}
export function schedulesView(v: {
  schedules: any[];
  brands: any[];
  spend: { usd: number; pricedRuns: number; unpricedRuns: number };
  month: string;
  byProvider: any[];
  windows: any[];
  lastTick: string | null;
}): Raw {
  const spend = html`${stats([
    ["Spend", money(v.spend.usd), "mtd-spend"],
    ["Priced runs", v.spend.pricedRuns, "mtd-priced"],
    ["Unpriced runs", v.spend.unpricedRuns, "mtd-unpriced"],
  ])}${
    v.spend.unpricedRuns
      ? html`<p class="hint" data-testid="unpriced-note"> ${v.spend.unpricedRuns} runs are unpriced: the provider returned no usage block, so their cost is unknown. They are excluded from the total rather than counted as free. </p>`
      : null
  }${grid(
    ["Provider", "Spend", "Runs", "Unpriced"],
    v.byProvider.map(
      (p) =>
        html`<tr> <td class="mono">${p.provider}</td> <td class="mono">${money(p.usd, 4)}</td> <td>${p.runs}</td> <td>${p.unpriced}</td> </tr>`,
    ),
    "No runs this month.",
  )}`;
  const schedules = grid(
    ["Brand", "Cadence", "Next run", "Last run", "Budget", "State", ""],
    v.schedules.map(
      (s) =>
        html`<tr data-testid="schedule-row"> <td> ${v.brands.find((b) => b.id === s.brand_id)?.name ?? s.brand_id} </td> <td class="mono">${s.cadence} @ ${s.hour_utc}:00 UTC</td> <td class="mono" data-testid="next-run">${when(s.next_run_at)}</td> <td class="mono"> ${when(s.last_run_at)} ${s.last_window_label ?? ""} </td> <td class="mono"> ${money(s.monthly_budget_usd, 0)}/mo · ${s.budget_runs} runs </td> <td> ${
          s.enabled === 1
            ? badge("enabled", "ok", "schedule-enabled")
            : badge("paused", "", "schedule-disabled")
        }${
          s.last_error
            ? html`<span class="pill bad" title="${s.last_error}" >last run failed</span >`
            : null
        } </td> <td class="row-actions"> ${action(
          `/schedules/${s.id}/toggle`,
          s.enabled === 1 ? "Pause" : "Resume",
          "toggle-schedule",
        )}${action(`/schedules/${s.id}/run`, "Run now", "run-schedule-now")} </td> </tr>`,
    ),
    "No schedule yet. Nothing is being sampled on its own.",
    "no-schedules",
  );
  const form = html`<form method="post" action="/schedules" class="stack" data-testid="schedule-form" > ${field(
    "brand_id",
    "Brand",
    "schedule-brand",
    {
      choices: v.brands.map((b) => [b.id, b.name]),
    },
  )}${field("cadence", "Cadence", "schedule-cadence", {
    choices: CADENCES.map((c) => [c, c]),
  })}${field("monthly_budget_usd", "Monthly budget (USD)", "schedule-budget", {
    type: "number",
    value: "500",
    min: 10,
    max: 100000,
  })}${field("budget_runs", "Runs per round", "schedule-runs", {
    type: "number",
    value: "60",
    min: MIN_SAMPLES,
    max: 600,
  })}<button class="primary" type="submit" data-testid="create-schedule"> Create schedule </button> </form>`;
  const windows = html`<p class="hint"> A partial window lost at least one surface. It is never used as an experiment baseline. </p> ${grid(
    ["Window", "Status", "Runs", "Cost", "Gaps", "Finished"],
    v.windows.map(
      (w) =>
        html`<tr data-testid="window-row"> <td class="mono">${w.window_label}</td> <td> ${
          w.status === "partial"
            ? badge("partial", "bad", "window-partial")
            : badge("complete", "ok")
        } </td> <td>${w.actual_runs}/${w.planned_runs}</td> <td class="mono"> ${w.cost_known === 1 ? money(w.cost_usd, 4) : "partly unpriced"} </td> <td>${JSON.parse(w.gaps || "[]").length}</td> <td class="mono">${when(w.finished_at)}</td> </tr>`,
    ),
    "No windows recorded yet.",
  )}`;
  return html`${heading(
    "Schedules",
    "The product's value is a time series, and a time series with gaps is a worse time series. A schedule claims a lease before it runs, so two workers cannot sample the same window twice, and a round that fails leaves its window marked partial rather than pretending to be a baseline.",
  )}${section("Month to date", spend, {
    count: v.month,
    countId: "mtd-month",
  })}${section("Active schedules", schedules, {
    count: String(v.schedules.length),
    countId: "schedule-count",
  })}${section("Add a schedule", form)}${section("Window ledger", windows, {
    count: String(v.windows.length),
    countId: "window-count",
  })}`;
}
export function alertsView(v: {
  alerts: any[];
  channels: any[];
  attempts: any[];
}): Raw {
  const rows = v.alerts.map(
    (a) =>
      html`<tr data-testid="alert-row"> <td class="mono">${when(a.created_at)}</td> <td class="mono" data-testid="alert-kind">${a.kind}</td> <td>${badge(a.severity, a.severity === "critical" ? "bad" : "")}</td> <td class="mono">${a.window_label}</td> <td> ${
        a.link
          ? html`<a href="${a.link}" data-testid="alert-link" >${a.headline}</a >`
          : a.headline
      } <div class="hint">${a.detail}</div> </td> <td class="mono"> ${a.delivered_at ? when(a.delivered_at) : badge("queued")} </td> </tr>`,
  );
  return html`${heading(
    "Alerts",
    "Only two things reach this page: movement that survived the two-proportion test, the minimum effect and the Benjamini-Hochberg correction, and a critical contradiction two evaluators agreed on. Every body carries its sample size, because an alert is read fastest and questioned least.",
  )}${section(
    "Recent alerts",
    grid(
      ["When", "Kind", "Severity", "Window", "Headline", "Delivered"],
      rows,
      "No alerts. Nothing crossed the gates.",
      "no-alerts",
    ),
    { count: String(rows.length), countId: "alert-count" },
  )}${channelsView(v)}`;
}
export function channelsView(v: { channels: any[]; attempts: any[] }): Raw {
  const channels = grid(
    ["Kind", "Target", "Minimum severity", "Digest", "State", ""],
    v.channels.map(
      (c) =>
        html`<tr data-testid="channel-row"> <td class="mono">${c.kind}</td> <td class="mono">${c.target}</td> <td>${c.min_severity}</td> <td>${c.digest === 1 ? "yes" : "no"}</td> <td> ${
          c.state === "failing"
            ? badge("failing", "bad", "channel-failing")
            : badge("ok", "ok")
        } </td> <td class="row-actions"> ${action(
          `/channels/${c.id}/test`,
          "Send test",
          "test-channel",
        )}${action(`/channels/${c.id}/delete`, "Remove", "delete-channel")} </td> </tr>`,
    ),
    "No channels. Alerts are recorded and nobody is told.",
    "no-channels",
  );
  const form = html`<form method="post" action="/channels" class="stack" data-testid="channel-form" > ${field(
    "kind",
    "Channel",
    "channel-kind",
    {
      choices: [
        ["email", "Email"],
        ["slack", "Slack incoming webhook"],
        ["webhook", "Signed webhook"],
      ],
    },
  )}${field("target", "Address or URL", "channel-target")}${field(
    "min_severity",
    "Minimum severity",
    "channel-severity",
    {
      choices: ["low", "medium", "high", "critical"].map((x) => [x, x]),
      value: "high",
    },
  )}<button class="primary" type="submit" data-testid="create-channel"> Add channel </button> </form>`;
  const attempts = grid(
    ["When", "Kind", "Attempt", "Status", "Error"],
    v.attempts
      .slice(0, 30)
      .map(
        (t) =>
          html`<tr data-testid="attempt-row"> <td class="mono">${when(t.created_at)}</td> <td>${t.kind}</td> <td>${t.attempt}</td> <td> ${badge(
            t.status === "sent" ? "sent" : "failed",
            t.status === "sent" ? "ok" : "bad",
          )} </td> <td class="mono">${t.error || "—"}</td> </tr>`,
      ),
    "Nothing sent yet.",
  );
  return html`${section(
    "Delivery channels",
    html`<p class="hint"> A delivery route that has quietly stopped working looks exactly like a quiet week, so a channel that fails three times in a row is marked failing here rather than failing silently. </p> ${channels}${form}`,
    { count: String(v.channels.length), countId: "channel-count" },
  )}${section("Delivery attempts", attempts, {
    count: String(v.attempts.length),
  })}`;
}
export function snapshotView(v: { snapshot: any; citation: any | null }): Raw {
  const s = v.snapshot;
  const values: Array<[string, Raw]> = [
    ["URL", html`<a href="${s.url}" rel="nofollow noopener">${s.url}</a>`],
    [
      "Captured",
      html`<span data-testid="snapshot-date">${when(s.fetched_at)}</span>`,
    ],
    ["sha256", html`<span data-testid="snapshot-sha">${s.sha256}</span>`],
    ["HTTP status", html`${s.http_status ?? "—"}`],
    ["Bytes", html`${s.bytes}${s.truncated === 1 ? " (truncated)" : ""}`],
    [
      "Retention",
      html`Kept indefinitely while an open defect or a confirmed experiment refers to it, otherwise pruned after ${SNAPSHOT_RETENTION_DAYS} days.`,
    ],
  ];
  return html`<div class="snapshot-banner" data-testid="snapshot-banner"> This is a snapshot captured on <b>${when(s.fetched_at)}</b>. It is not the live page, and the live page may since have changed. That is the reason it is kept. </div> <h1>Snapshot ${s.sha256.slice(0, 12)}</h1> <div class="table-wrap"> <table> <tbody> ${values.map(
    ([label, value]) =>
      html`<tr> <th scope="row">${label}</th> <td class="mono">${value}</td> </tr>`,
  )} </tbody> </table> </div> ${section(
    "Captured content",
    html`<pre class="snapshot-body" data-testid="snapshot-body"> ${String(s.body).slice(0, 20000)}</pre >`,
  )}`;
}
export function portfolioView(v: {
  rows: Array<{
    brand: any;
    critical: number;
    defects: number;
    runs: number;
    lastWindow: string | null;
    partial: boolean;
  }>;
}): Raw {
  return html`${heading(
    "Portfolio",
    "Every brand in this workspace, ranked by open critical defects. The schema has been multi-brand since the first migration; this is the page that makes an agency able to use it.",
  )}${grid(
    [
      "Brand",
      "Critical",
      "All defects",
      "Runs in last window",
      "Last window",
      "",
    ],
    v.rows.map(
      (r) =>
        html`<tr data-testid="portfolio-row"> <td> <b>${r.brand.name}</b> <div class="hint mono">${r.brand.domain}</div> </td> <td class="mono ${r.critical > 0 ? "bad" : ""}" data-testid="portfolio-critical" > ${r.critical} </td> <td>${r.defects}</td> <td>${r.runs}</td> <td> ${r.lastWindow ?? "—"} ${r.partial ? badge("partial", "bad") : null} </td> <td> ${action(
          "/brands/switch",
          "Open",
          "open-brand",
          {
            brand_id: r.brand.id,
          },
        )} </td> </tr>`,
    ),
    "No brands.",
  )}`;
}
export function marketsView(v: {
  cluster: any;
  variants: any[];
  breakdown: any[];
  geos: string[];
  languages: string[];
}): Raw {
  return html`${heading(
    `Markets for "${v.cluster.label}"`,
    "Two markets are two populations. Rates are reported per market and never pooled, for the same reason intent families are never blended: an average across them describes nobody.",
  )}${section(
    "Sampled markets",
    table(
      ["Market", "Prompt"],
      v.variants.map(
        (x) =>
          html`<tr data-testid="variant-row"> <td class="mono">${marketLabel(x.geo, x.language)}</td> <td>${x.prompt}</td> </tr>`,
      ),
    ),
    { count: String(v.variants.length), countId: "variant-count" },
  )}${section(
    "Add markets",
    html`<form method="post" action="/clusters/${v.cluster.id}/markets" class="stack" data-testid="markets-form" > <fieldset> <legend>Markets</legend> ${MARKETS.map(
      (m) =>
        html`<label class="check" ><input type="checkbox" name="market" value="${m.geo}:${m.language}" ${v.geos.includes(m.geo) ? raw("checked") : ""} data-testid="market-${m.geo}">${m.label}</label >`,
    )} </fieldset> <button class="primary" type="submit" data-testid="save-markets"> Save markets </button> </form>`,
  )}${section(
    "Defect rate by market",
    html`<p class="hint">Shown separately, never combined.</p> ${grid(
      ["Market", "Runs", "Runs with a defect", "Rate"],
      v.breakdown.map(
        (b) =>
          html`<tr data-testid="market-row"> <td>${b.label}</td> <td>${b.runs}</td> <td>${b.defects}</td> <td class="mono"> ${
            b.runs >= MIN_SAMPLES
              ? pct(b.defects / b.runs)
              : `insufficient data (n=${b.runs})`
          } </td> </tr>`,
      ),
      "No runs in this window.",
    )}`,
  )}`;
}
export function indexView(v: {
  report: any;
  consent: boolean;
  tenantName: string;
}): Raw {
  const participation = html`<p> <b>${v.tenantName}</b> ${
    v.consent
      ? "is contributing to the index. You can revoke this at any time and the next report will exclude you."
      : "is not contributing. Participation is off by default."
  } </p> <p class="hint" data-testid="export-fields"> Exactly these fields leave your workspace: provider, model_version, predicate_class, verdict, industry_category, quarter. No brand name, cluster label, prompt or answer text ever crosses the boundary. </p> <form method="post" action="/index-consent"> <input type="hidden" name="consent" value="${v.consent ? "0" : "1"}"><button class="primary" type="submit" data-testid="toggle-consent"> ${v.consent ? "Stop contributing" : "Contribute to the index"} </button> </form>`;
  const rows = v.report.cells.map(
    (c: any) =>
      html`<tr data-testid="index-row"> <td>${c.provider}</td> <td>${c.modelVersion}</td> <td>${c.predicateClass}</td> <td>${c.industryCategory}</td> <td>${c.tenants}</td> <td class="mono"> ${
        c.suppressed
          ? badge(
              `suppressed, fewer than ${K_ANON} workspaces`,
              "",
              "index-suppressed",
            )
          : html`${pct(c.staleOrWrong.point)} (n=${c.staleOrWrong.n})`
      } </td> </tr>`,
  );
  return html`${heading(
    "AI Brand Accuracy Index",
    `Which models repeat stale or contradicted company facts, by category, over time. Built only from workspaces that opted in, and suppressed wherever a cell would rest on fewer than ${K_ANON} of them.`,
  )}${section("Your participation", participation)}${section(
    v.report.quarter,
    grid(
      [
        "Provider",
        "Model version",
        "Claim class",
        "Category",
        "Workspaces",
        "Stale or contradicted",
      ],
      rows,
      "No live runs from consenting workspaces yet.",
      "index-empty",
    ),
    {
      count: `${v.report.consentingTenants} participating workspaces`,
      countId: "index-participants",
    },
  )}${section(
    "Methodology",
    html`<ul class="rules"> ${v.report.methodology.map((text: string) => html`<li>${text}</li>`)} </ul>`,
  )}`;
}
function disclosure(title: string, body: Raw, tone: string, id: string): Raw {
  return html`<aside class="disclosure ${tone}" data-testid="${id}"> <h2>${title}</h2> ${body} </aside>`;
}
export function auditReportView(v: {
  report: any;
  findings: any;
  candidates: any[];
  surfaces: string[];
  notTested: string[];
}): Raw {
  const r = v.report,
    findings = v.findings;
  const simulated = Number(r.simulated_runs ?? 0),
    facts = Number(r.facts_read ?? 0);
  const allSimulated = simulated > 0 && simulated >= Number(r.sample_size ?? 0);
  const power = `${Math.round(Number(r.powered_for ?? 1) * 100)} points`;
  const defects = findings.defects ?? [],
    missed = findings.missed ?? [],
    families = findings.familySummaries ?? [];
  const simulation = simulated
    ? disclosure(
        allSimulated
          ? "No real assistant was asked for this report"
          : "Part of this sample did not come from a real assistant",
        html`<p> ${
          allSimulated
            ? html`All ${simulated} answers below were produced by a deterministic stand-in that this deployment runs when no provider API key is configured. Nothing here was said by ChatGPT, Claude, Gemini or Perplexity, and no number in this report is a measurement of what those assistants tell your buyers.`
            : html`${simulated} of the ${r.sample_size} answers below came from a deterministic stand-in rather than a real assistant, because a provider key was missing or its adapter failed mid-round.`
        } </p> <p class="hint"> The stand-in exists so the pipeline can be rehearsed end to end at no cost, and every such run is flagged in the database. It is not a forecast: it cannot tell you what a real model would say. </p>`,
        "danger",
        "audit-simulated-banner",
      )
    : null;
  const noFacts =
    facts === 0
      ? disclosure(
          "We could not read a checkable fact from your site, so accuracy was not tested",
          html`<p> An answer is only wrong relative to something. This audit reads your own published pages for statements it can check — a price, a fee, a founding year, a headquarters, a certification, an integration — and found none it could extract. Every defect count in this report therefore has an empty registry behind it. <b>Zero defects here means "not checked", not "nothing wrong".</b> </p> <p class="hint"> The absence and demand figures below are unaffected: whether you appear in an answer does not depend on the registry. See "what this did not test" for why your pages may have read as empty. </p>`,
          "warn",
          "audit-no-facts-banner",
        )
      : null;
  const sample = section(
    "What this sample was",
    html`${stats([
      ["Answers sampled", r.sample_size, "audit-sample"],
      [
        "Cost of the sample",
        r.cost_known === 1 ? money(r.cost_usd) : "partly unpriced",
        "audit-cost",
      ],
      ["Powered to detect", power, "audit-power"],
    ])} <p class="hint"> Surfaces: ${v.surfaces.join("; ") || "none recorded"}. ${
      simulated
        ? html`<b data-testid="audit-surface-sim" >A "sim-" model id means the stand-in, not that vendor's model.</b >`
        : null
    } </p>`,
  );
  const result =
    defects.length === 0 && missed.length === 0
      ? section(
          facts === 0
            ? "Nothing was checked, so nothing was found"
            : "We found no defect at this sample size",
          facts === 0
            ? html`<p data-testid="audit-empty-unchecked"> Across ${r.sample_size} sampled answers nothing was compared against anything, because no checkable fact was read from your site. This is an empty result, not a clean one. The fastest way to a real answer is to publish the facts that matter in plain text on a page we can read, or to approve a registry by hand once monitoring starts. </p>`
            : html`<p> That is the finding. Across ${r.sample_size} sampled answers nothing contradicted or outdated what your own pages say. At this sample size a difference of about <b>${power}</b> would have been detectable, so a smaller problem could still exist and this audit would not have seen it. </p>`,
          { id: "audit-nothing-found" },
        )
      : html`${section(
          "1. Answer defects",
          html`${
            facts === 0
              ? html`<p data-testid="audit-defects-unchecked"> No count is shown. Defects are found by comparing an answer with a fact you published, and no fact could be read from your site, so this section had nothing to test against. A zero here would have been an artefact of the empty registry rather than a finding about your answers. </p>`
              : null
          }${defects.map(
            (d: any) =>
              html`<article class="finding" data-testid="audit-defect"> <h3>${d.headline}</h3> <p class="mono">${d.measurementText}</p> <blockquote>${d.example}</blockquote> ${
                d.canonical
                  ? html`<p class="hint">Your own page says: ${d.canonical}</p>`
                  : null
              } </article>`,
          )}`,
          {
            count: facts === 0 ? "not checked" : String(defects.length),
            countId: "audit-defect-count",
          },
        )}${section(
          "2. Missed demand",
          missed.length
            ? html`${missed.map(
                (m: any) =>
                  html`<article class="finding" data-testid="audit-missed"> <h3>${m.label}</h3> <p class="mono">absent in ${m.absenceText}</p> </article>`,
              )}`
            : html`<p> No question cluster showed defensible absence at this sample size. </p>`,
          { count: String(missed.length) },
        )}`;
  const candidates = html`<p class="hint"> Candidates, not an approved registry. Nobody has confirmed these; they are what your own published pages state, read the same way we read a model's answer. </p> ${
    v.candidates.length
      ? null
      : html`<p class="hint" data-testid="audit-candidates-empty"> None. We look for statements of price, fees, availability, product status, integrations, feature support, headquarters, founding year, funding, employee count, leadership, partnerships, compliance and certification. Your pages either state none of those in a form a reader could check, or state them only in copy rendered after the page loads. </p>`
  }${table(
    ["Subject", "Predicate", "Value", "Source"],
    v.candidates
      .slice(0, 20)
      .map(
        (c) =>
          html`<tr data-testid="audit-candidate"> <td>${c.subject}</td> <td class="mono">${c.predicate}</td> <td>${c.object}</td> <td class="mono"> <a href="${c.sourceUrl}" rel="nofollow noopener" >${String(c.sourceUrl).slice(0, 48)}</a > </td> </tr>`,
      ),
  )}`;
  const conversion = html`<p> This workspace already holds the candidates, the question clusters and one window of runs. Creating an account attaches you to it and schedules a Monday question plan at 06:00 UTC, followed by automatic checking one hour later. Review or edit the questions in Weekly briefing. </p> <form method="post" action="/audit/${r.token}/start" class="stack" data-testid="convert-form" > <div> <label for="email">Work email</label ><input id="email" name="email" type="email" autocomplete="email" required data-testid="convert-email"> </div> <div> <label for="password">Choose a password</label ><input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" data-testid="convert-password"> </div> <label><input type="checkbox" name="weekly_email" value="yes"> Email me the Monday plan and results. I can turn this off anytime.</label><button class="primary" type="submit" data-testid="start-monitoring"> Start monitoring </button> </form>`;
  return html`<article class="audit"> <h1>Answer risk audit: ${r.brand_name || r.domain}</h1> ${simulation}${noFacts} <p class="lede"> Dated ${when(r.completed_at ?? r.created_at)}. We read ${r.domain}, took what it says about itself as the comparison, asked ${families.length} families of buyer question across ${v.surfaces.length} surfaces, and checked every answer and every citation. </p> ${sample}${result}${section(
    "By question family",
    table(
      ["Family", "Runs", "Defect rate"],
      families.map(
        (f: any) =>
          html`<tr> <td>${f.label}</td> <td class="mono">${f.runs}</td> <td class="mono">${f.defectRateText}</td> </tr>`,
      ),
    ),
  )}${section("Facts we read from your site", candidates, {
    count: String(v.candidates.length),
    countId: "audit-candidate-count",
  })}${section(
    "What this did not test",
    html`<ul class="rules" data-testid="audit-not-tested"> ${v.notTested.map((text) => html`<li>${text}</li>`)} </ul>`,
  )}${section("Start monitoring", conversion)} </article>`;
}
export function auditAdminView(v: { reports: any[] }): Raw {
  return html`${heading(
    "Audit requests",
    "Self-serve audits, newest first. Each ran the real pipeline in its own provisional workspace.",
  )}${grid(
    ["When", "Domain", "Status", "Sample", "Report"],
    v.reports.map(
      (r) =>
        html`<tr data-testid="audit-report-row"> <td>${when(r.created_at)}</td> <td>${r.domain}</td> <td> ${
          r.status === "failed"
            ? html`<span class="pill bad" title="${r.error ?? ""}" >failed</span >`
            : badge(r.status, r.status === "complete" ? "ok" : "")
        } </td> <td>${r.sample_size}</td> <td> ${
          r.status === "complete"
            ? html`<a href="/audit/${r.token}" data-testid="audit-report-link" >open</a >`
            : "—"
        } </td> </tr>`,
    ),
    "No audits requested.",
  )}`;
}
