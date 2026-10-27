"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TimelinePoint } from "@/lib/api";

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** One bar per sampled frame where the product was detected: height = share of screen, colour = clear or not. */
export function Timeline({ points, duration, sampleFps }: { points: TimelinePoint[]; duration: number; sampleFps: number }) {
  const step = 1 / sampleFps;
  // Fill undetected samples with empty slots so gaps read as gaps, not as a squeezed axis.
  const byT = new Map(points.map((p) => [p.t.toFixed(2), p]));
  const data = Array.from({ length: Math.max(1, Math.ceil(duration * sampleFps)) }, (_, i) => {
    const t = i * step;
    const p = byT.get(t.toFixed(2)) ?? points.find((q) => Math.abs(q.t - t) < step / 2);
    return { t, prominence: p?.prominence ?? 0, point: p };
  });

  return (
    <figure>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--accent)" }} /> Clear view
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--neutral-mark)" }} />{" "}
          Obstructed or out of focus
        </span>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <BarChart data={data} barCategoryGap={1} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="t"
              tickFormatter={fmtTime}
              stroke="var(--text-secondary)"
              tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              unit="%"
              stroke="var(--text-secondary)"
              tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--line)", opacity: 0.5 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !row) return null;
                const p = row.point;
                return (
                  <div className="rounded-md border border-line bg-raised px-3 py-2 text-xs shadow-sm">
                    <div className="font-medium text-ink">{fmtTime(row.t)}</div>
                    {p ? (
                      <div className="mt-1 space-y-0.5 text-muted">
                        <div>Screen share: {p.prominence.toFixed(1)}%</div>
                        <div>Visible: {Math.round(p.visible_fraction * 100)}%</div>
                        <div>Sharpness: {p.sharpness_ratio.toFixed(2)}× reference</div>
                        <div className="text-ink">{p.clear ? "Clear view" : "Not a clear view"}</div>
                      </div>
                    ) : (
                      <div className="mt-1 text-muted">Product not detected</div>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey="prominence" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.t} fill={d.point?.clear ? "var(--accent)" : "var(--neutral-mark)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-muted">
        Share of the screen occupied by the visible product, per sampled frame ({sampleFps} per second).
      </figcaption>
    </figure>
  );
}
