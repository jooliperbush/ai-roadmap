"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createJob, getApiKey, setApiKey, uploadFile } from "@/lib/api";

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export default function NewAudit() {
  const router = useRouter();
  const [apiKey, setKey] = useState("");
  const [mode, setMode] = useState<"youtube" | "upload">("youtube");
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [refs, setRefs] = useState<File[]>([]);
  const [brand, setBrand] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [views, setViews] = useState("");
  const [cpm, setCpm] = useState("20");
  const [minClear, setMinClear] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setKey(getApiKey()), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (refs.length < 1 || refs.length > 5) return setError("Add between 1 and 5 reference images.");
    if (mode === "upload" && !video) return setError("Choose an MP4 to upload.");
    setApiKey(apiKey.trim());
    try {
      setBusy("Uploading reference images…");
      const referenceIds = await Promise.all(refs.map((f) => uploadFile(f, "image")));
      let source: object = { type: "youtube", url };
      if (mode === "upload" && video) {
        setBusy("Uploading video…");
        source = { type: "upload", upload_id: await uploadFile(video, "video") };
      }
      setBusy("Starting audit…");
      const jobId = await createJob({
        source,
        brand: { name: brand, reference_image_ids: referenceIds, competitors: list(competitors) },
        valuation: { views: views ? Number(views) : null, base_cpm: Number(cpm) },
        requirements: { min_clear_view_time: minClear ? Number(minClear) : null },
      });
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New placement audit</h1>
        <p className="mt-1 text-sm text-muted">
          Measures how long the product was really on screen, how clearly, in what context, and what that exposure is
          worth.
        </p>
      </div>

      <section className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <span className="label">Video</span>
        <div className="flex gap-2 text-sm">
          {(["youtube", "upload"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md border px-3 py-1.5 ${mode === m ? "border-accent text-ink" : "border-line text-muted"}`}
            >
              {m === "youtube" ? "YouTube link" : "Upload MP4"}
            </button>
          ))}
        </div>
        {mode === "youtube" ? (
          <input
            className="field"
            type="url"
            required
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        ) : (
          <input
            className="field"
            type="file"
            accept="video/mp4"
            required
            onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
          />
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <div>
          <label className="label" htmlFor="brand">
            Brand
          </label>
          <input id="brand" className="field" required value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="refs">
            Reference images (1–5)
          </label>
          <input
            id="refs"
            className="field"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            required
            onChange={(e) => setRefs(Array.from(e.target.files ?? []).slice(0, 5))}
          />
          <p className="mt-1 text-xs text-muted">
            Tight crops of the logo or packaging as it appears on the product. Plain, untextured marks match poorly.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="competitors">
            Competitors to flag (comma separated)
          </label>
          <input
            id="competitors"
            className="field"
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
          />
        </div>
      </section>

      <section className="grid gap-3 rounded-lg border border-line bg-raised p-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="views">
            Views
          </label>
          <input
            id="views"
            className="field"
            type="number"
            min={0}
            placeholder="YouTube count"
            value={views}
            onChange={(e) => setViews(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="cpm">
            Base CPM (USD)
          </label>
          <input
            id="cpm"
            className="field"
            type="number"
            min={0.01}
            step="0.01"
            required
            value={cpm}
            onChange={(e) => setCpm(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="minClear">
            Contract min. clear view (s)
          </label>
          <input
            id="minClear"
            className="field"
            type="number"
            min={0}
            placeholder="optional"
            value={minClear}
            onChange={(e) => setMinClear(e.target.value)}
          />
        </div>
      </section>

      <section className="rounded-lg border border-line bg-raised p-4">
        <label className="label" htmlFor="key">
          API key
        </label>
        <input
          id="key"
          className="field font-mono"
          type="password"
          required
          value={apiKey}
          onChange={(e) => setKey(e.target.value)}
        />
      </section>

      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!!busy}
        className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ?? "Run audit"}
      </button>
    </form>
  );
}
