"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Timeline } from "@/components/Timeline";
import { getJob, type Job, type Report } from "@/lib/api";

const money = (v: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
const secs = (s: number) => `${s.toFixed(1)}s`;
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function Verdict({ value, pass = "Pass", fail = "Fail" }: { value: boolean | null; pass?: string; fail?: string }) {
  if (value === null)
    return (
      <span className="inline-flex items-center gap-1 text-warning">
        <span aria-hidden>◌</span> Not evaluated
      </span>
    );
  return value ? (
    <span className="inline-flex items-center gap-1 text-good">
      <span aria-hidden>✓</span> {pass}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-critical">
      <span aria-hidden>✕</span> {fail}
    </span>
  );
}

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-raised p-4">
      <div className="label">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{children}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const j = await getJob(id);
        if (stop) return;
        setJob(j);
        if (j.status === "queued" || j.status === "processing") timer = setTimeout(poll, 2000);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (error) return <p className="text-critical">Could not load job: {error}</p>;
  if (!job) return <p className="text-muted">Loading…</p>;

  if (job.status === "failed")
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Audit failed</h1>
        <p className="font-mono text-sm text-critical">{job.error}</p>
        <Link href="/" className="text-sm text-accent underline">
          Start another audit
        </Link>
      </div>
    );

  if (job.status !== "completed" || !job.result)
    return (
      <div className="mx-auto max-w-md space-y-3 py-12 text-center">
        <h1 className="text-lg font-semibold">Auditing {job.request.brand.name}…</h1>
        <div className="h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
        <p className="text-sm text-muted">
          {job.status === "queued" ? "Waiting for a worker" : `Stage: ${job.stage ?? "starting"}`} ·{" "}
          {Math.round(job.progress * 100)}%
        </p>
      </div>
    );

  return <Results job={job} r={job.result} />;
}

function Results({ job, r }: { job: Job; r: Report }) {
  const m = r.metrics;
  return (
    <div className="space-y-8">
      <div>
        <div className="text-xs text-muted">{job.job_id}</div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {job.request.brand.name} in {r.video.title ?? "uploaded video"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {secs(r.video.duration_seconds)} video
          {r.video.views != null && ` · ${r.video.views.toLocaleString()} views`} · compliance{" "}
          <Verdict value={r.compliance.passed} />
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Equivalent media value" hint={`×${r.emv.prominence_multiplier} prominence · $${r.emv.base_cpm} CPM`}>
          {r.emv.value != null ? money(r.emv.value, r.emv.currency) : "—"}
        </Stat>
        <Stat label="Clear view time" hint={`of ${secs(m.total_screen_time)} on screen`}>
          {secs(m.clear_view_time)}
        </Stat>
        <Stat label="Average prominence" hint="share of the screen while visible">
          {m.average_prominence.toFixed(1)}%
        </Stat>
        <Stat label="Brand safety" hint={`±${r.safety.window_seconds}s around each appearance`}>
          <span className="text-xl">
            <Verdict value={m.brand_safety_score} />
          </span>
        </Stat>
      </div>
      {r.emv.note && <p className="text-sm text-warning">{r.emv.note}</p>}

      <section className="rounded-lg border border-line bg-raised p-4">
        <h2 className="mb-3 font-medium">Exposure timeline</h2>
        <Timeline points={r.timeline} duration={r.video.duration_seconds} sampleFps={r.video.sample_fps} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-medium">Appearances</h2>
          {r.appearances.length === 0 ? (
            <p className="text-sm text-muted">The product was not detected in this video.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">When</th>
                  <th className="py-1 text-right font-medium">On screen</th>
                  <th className="py-1 text-right font-medium">Clear</th>
                  <th className="py-1 text-right font-medium">Avg. share</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {r.appearances.map((a) => (
                  <tr key={a.start} className="border-t border-line">
                    <td className="py-1.5">
                      {fmtTime(a.start)}–{fmtTime(a.end)}
                    </td>
                    <td className="py-1.5 text-right">{secs(a.screen_time)}</td>
                    <td className="py-1.5 text-right">{secs(a.clear_view_time)}</td>
                    <td className="py-1.5 text-right">{a.average_prominence.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-medium">Context & safety</h2>
          {r.safety.flags.length === 0 ? (
            <p className="text-sm text-muted">
              {r.safety.passed === null ? "No safety checks could run for this video." : "No flags raised."}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {r.safety.flags.map((f, i) => (
                <li key={i} className="rounded-md border border-line p-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-critical">
                      <span aria-hidden>✕ </span>
                      {f.category.replaceAll("_", " ")}
                    </span>
                    <span className="text-muted">
                      {fmtTime(f.t)} · {f.source}
                    </span>
                  </div>
                  <div className="mt-1 text-muted">“{f.evidence}”</div>
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-3 space-y-0.5 text-xs text-muted">
            <li>Transcript: {r.safety.transcript_available ? "checked" : "not available"}</li>
            <li>Scene review (LLM): {r.safety.llm_reviewed ? "done" : "not run"}</li>
            {r.safety.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      </div>

      {r.compliance.checks.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Compliance checks</h2>
          <ul className="space-y-1 text-sm">
            {r.compliance.checks.map((c) => (
              <li key={c.check} className="flex justify-between border-t border-line py-1.5">
                <span>
                  {c.check.replaceAll("_", " ")}{" "}
                  <span className="text-muted">
                    (required {String(c.required)}, actual {c.actual == null ? "not evaluated" : String(c.actual)})
                  </span>
                </span>
                <Verdict value={c.passed} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted">EMV = {r.emv.formula}</p>
    </div>
  );
}
