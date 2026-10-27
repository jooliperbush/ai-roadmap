export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const KEY_STORAGE = "placeguard.apiKey";

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(key: string) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* private mode: the key just is not remembered */
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${getApiKey()}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    throw new Error(`${res.status}: ${detail}`);
  }
  return body as T;
}

export async function uploadFile(file: File, kind: "video" | "image"): Promise<string> {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", file);
  const out = await call<{ upload_id: string }>("/api/v1/uploads", { method: "POST", body: form });
  return out.upload_id;
}

export async function createJob(body: unknown): Promise<string> {
  const out = await call<{ job_id: string }>("/api/v1/audit/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return out.job_id;
}

export type TimelinePoint = {
  t: number;
  prominence: number;
  visible_fraction: number;
  sharpness_ratio: number;
  clear: boolean;
};

export type Flag = { category: string; source: string; t: number; term?: string; evidence: string };

export type Report = {
  video: { title: string | null; source: string; duration_seconds: number; views: number | null; sample_fps: number };
  metrics: {
    total_screen_time: number;
    clear_view_time: number;
    average_prominence: number;
    brand_safety_score: boolean | null;
  };
  emv: {
    value: number | null;
    currency: string;
    views: number | null;
    base_cpm: number;
    prominence_multiplier: number;
    formula: string;
    note?: string;
  };
  compliance: { passed: boolean | null; checks: { check: string; required: unknown; actual: unknown; passed: boolean | null }[] };
  appearances: { start: number; end: number; screen_time: number; clear_view_time: number; average_prominence: number; peak_prominence: number }[];
  safety: { passed: boolean | null; window_seconds: number; transcript_available: boolean; llm_reviewed: boolean; flags: Flag[]; notes: string[] };
  timeline: TimelinePoint[];
};

export type Job = {
  job_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  stage: string | null;
  progress: number;
  created_at: string;
  request: { brand: { name: string } };
  result: Report | null;
  error: string | null;
};

export const getJob = (id: string) => call<Job>(`/api/v1/audit/jobs/${encodeURIComponent(id)}`);
