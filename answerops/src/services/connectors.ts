/**
 * Connectors: the distance between "we found it" and "it shipped".
 *
 * Two rules hold everywhere in this file. A connector that fails leaves the action where it
 * was, with the error recorded, because an action that says `shipped` when nothing shipped
 * poisons the experiment attached to it. And nothing here ever publishes: a CMS connector
 * creates a draft, and the publisher correction packet is a document a person sends. The
 * moment this system posts something itself it becomes a spam vector and the trust that is
 * the actual product is gone.
 */

import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import { id, nowIso } from '../db/index.js';
import type { Row } from '../db/repo/index.js';
import { ActionType } from '../domain/priority.js';

export interface ShipContext {
  brandName: string;
  brandDomain: string;
  defectStatement: string;
  canonicalClaim: string;
  evidenceIds: string[];
  experimentId: string | null;
  body: string;
  path: string;
}

export interface ShipOutcome {
  ok: boolean;
  externalRef?: string;
  url?: string;
  error?: string;
}

export interface Connector {
  key: string;
  /** which action types this connector can carry */
  handles: ActionType[];
  ship(action: Row, ctx: ShipContext, cfg: Row): Promise<ShipOutcome>;
}

export function prBody(ctx: ShipContext): string {
  return [
    `## What this corrects`,
    '',
    `An AI answer about ${ctx.brandName} stated:`,
    '',
    `> ${ctx.defectStatement}`,
    '',
    `The approved canonical fact is:`,
    '',
    `> ${ctx.canonicalClaim}`,
    '',
    `## Evidence`,
    '',
    ...ctx.evidenceIds.map((e) => `- \`${e}\``),
    '',
    ctx.experimentId
      ? `## Measurement\n\nThis change is tracked as experiment \`${ctx.experimentId}\`. It moves to *shipped* when this PR merges, and to *crawled* when the relevant bot class fetches the page.`
      : '## Measurement\n\nNo experiment is attached to this action yet.',
    '',
    '---',
    'Opened by Miscited. Nothing here is published automatically; this is a pull request for a human to review.',
  ].join('\n');
}

// ---------------------------------------------------------------------- GitHub

export class GithubConnector implements Connector {
  key = 'github';
  handles: ActionType[] = ['update_owned_page', 'create_comparison_page', 'create_evidence_page', 'fix_fact_inconsistency', 'update_structured_data', 'open_github_pr'];

  constructor(private fetchImpl: typeof fetch = fetch) {}

  async ship(action: Row, ctx: ShipContext, cfg: Row): Promise<ShipOutcome> {
    const [owner, repoName] = String(cfg.target).split('/');
    if (!owner || !repoName) return { ok: false, error: 'connector target must be owner/repo' };
    const branch = `miscited/${action.id}`;
    const api = `https://api.github.com/repos/${owner}/${repoName}`;
    const headers = {
      authorization: `Bearer ${cfg.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    };

    try {
      const headRes = await this.fetchImpl(`${api}/git/ref/heads/main`, { headers });
      if (!headRes.ok) return { ok: false, error: `could not read main (${headRes.status})` };
      const head = (await headRes.json()) as any;
      const sha = head?.object?.sha;
      if (!sha) return { ok: false, error: 'main has no head sha' };

      const branchRes = await this.fetchImpl(`${api}/git/refs`, {
        method: 'POST', headers,
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      });
      if (!branchRes.ok && branchRes.status !== 422) {
        return { ok: false, error: `could not create branch (${branchRes.status})` };
      }

      const putRes = await this.fetchImpl(`${api}/contents/${encodeURIComponent(ctx.path)}`, {
        method: 'PUT', headers,
        body: JSON.stringify({
          message: `Correct ${ctx.path}: ${action.title}`,
          content: Buffer.from(ctx.body, 'utf8').toString('base64'),
          branch,
        }),
      });
      if (!putRes.ok) return { ok: false, error: `could not commit (${putRes.status})` };

      const prRes = await this.fetchImpl(`${api}/pulls`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: action.title, head: branch, base: 'main', body: prBody(ctx) }),
      });
      if (!prRes.ok) return { ok: false, error: `could not open PR (${prRes.status})` };
      const pr = (await prRes.json()) as any;
      return { ok: true, externalRef: String(pr.number), url: pr.html_url };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : 'github call failed' };
    }
  }
}

// -------------------------------------------------------------------- CMS drafts

export class WebflowConnector implements Connector {
  key = 'webflow';
  handles: ActionType[] = ['create_cms_draft', 'update_owned_page', 'create_evidence_page', 'create_comparison_page'];
  constructor(private fetchImpl: typeof fetch = fetch) {}

  async ship(action: Row, ctx: ShipContext, cfg: Row): Promise<ShipOutcome> {
    try {
      const res = await this.fetchImpl(`https://api.webflow.com/v2/collections/${cfg.target}/items`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
        // isDraft, always. There is no code path in this file that publishes.
        body: JSON.stringify({ isDraft: true, fieldData: { name: action.title, body: ctx.body } }),
      });
      if (!res.ok) return { ok: false, error: `webflow ${res.status}` };
      const item = (await res.json()) as any;
      return { ok: true, externalRef: item?.id ?? '', url: item?.previewUrl ?? '' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : 'webflow call failed' };
    }
  }
}

export class WordpressConnector implements Connector {
  key = 'wordpress';
  handles: ActionType[] = ['create_cms_draft', 'update_owned_page', 'create_evidence_page', 'create_comparison_page'];
  constructor(private fetchImpl: typeof fetch = fetch) {}

  async ship(action: Row, ctx: ShipContext, cfg: Row): Promise<ShipOutcome> {
    try {
      const res = await this.fetchImpl(`${String(cfg.target).replace(/\/$/, '')}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ title: action.title, content: ctx.body, status: 'draft' }),
      });
      if (!res.ok) return { ok: false, error: `wordpress ${res.status}` };
      const post = (await res.json()) as any;
      return { ok: true, externalRef: String(post?.id ?? ''), url: post?.link ?? '' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : 'wordpress call failed' };
    }
  }
}

/** Records the call and never leaves the process. The default in tests and the demo. */
export class RecordingConnector implements Connector {
  key: string;
  handles: ActionType[];
  calls: Array<{ action: Row; ctx: ShipContext }> = [];
  constructor(key: string, handles: ActionType[], private failWith: string | null = null) {
    this.key = key;
    this.handles = handles;
  }
  async ship(action: Row, ctx: ShipContext): Promise<ShipOutcome> {
    this.calls.push({ action, ctx });
    if (this.failWith) return { ok: false, error: this.failWith };
    return { ok: true, externalRef: `rec-${this.calls.length}`, url: `https://example.invalid/${action.id}` };
  }
}

// -------------------------------------------------------------- structured data

export const SCHEMA_TYPES = ['Organization', 'Product', 'SoftwareApplication', 'FAQPage', 'Article'] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

const REQUIRED_FIELDS: Record<SchemaType, string[]> = {
  Organization: ['name', 'url'],
  Product: ['name'],
  SoftwareApplication: ['name', 'applicationCategory'],
  FAQPage: ['mainEntity'],
  Article: ['headline'],
};

export interface JsonLdResult {
  valid: boolean;
  missing: string[];
  jsonLd: Record<string, unknown>;
  diff: Array<{ side: 'added' | 'removed' | 'changed'; field: string; from?: unknown; to?: unknown }>;
}

/**
 * Build a JSON-LD patch and diff it against whatever the page currently declares. Validation
 * is against the required fields for the declared type — enough to fail loudly on a patch that
 * would not produce a rich result, not a full schema.org implementation.
 */
export function buildJsonLd(type: SchemaType, fields: Record<string, unknown>, current: Record<string, unknown> | null): JsonLdResult {
  const jsonLd = { '@context': 'https://schema.org', '@type': type, ...fields };
  const missing = (REQUIRED_FIELDS[type] ?? []).filter((f) => fields[f] === undefined || fields[f] === '');
  const diff: JsonLdResult['diff'] = [];
  const cur = current ?? {};
  for (const [k, v] of Object.entries(jsonLd)) {
    if (!(k in cur)) diff.push({ side: 'added', field: k, to: v });
    else if (JSON.stringify(cur[k]) !== JSON.stringify(v)) diff.push({ side: 'changed', field: k, from: cur[k], to: v });
  }
  for (const k of Object.keys(cur)) if (!(k in jsonLd)) diff.push({ side: 'removed', field: k, from: cur[k] });
  return { valid: missing.length === 0, missing, jsonLd, diff };
}

// ------------------------------------------------------------ correction packet

export interface CorrectionPacket {
  publisher: string;
  subject: string;
  html: string;
}

/**
 * A document, addressed to a named publisher, for a human to send. There is deliberately no
 * transport for this anywhere in the codebase, and a test asserts that.
 */
export function correctionPacket(input: {
  publisher: string;
  publisherUrl: string;
  brandName: string;
  wrongStatement: string;
  canonicalClaim: string;
  sources: Array<{ url: string; title: string }>;
  snapshots: Array<{ url: string; sha256: string; fetchedAt: string }>;
}): CorrectionPacket {
  const rows = input.sources.map((s) => `<li><a href="${esc(s.url)}">${esc(s.title || s.url)}</a></li>`).join('');
  const snaps = input.snapshots
    .map((s) => `<li><code>${esc(s.sha256.slice(0, 12))}</code> — ${esc(s.url)} captured ${esc(s.fetchedAt.slice(0, 10))}</li>`)
    .join('');
  return {
    publisher: input.publisher,
    subject: `Correction request: ${input.brandName}`,
    html: `<article>
  <h1>Correction request for ${esc(input.publisher)}</h1>
  <p>Regarding <a href="${esc(input.publisherUrl)}">${esc(input.publisherUrl)}</a>.</p>
  <h2>What the page states</h2>
  <blockquote>${esc(input.wrongStatement)}</blockquote>
  <h2>The current fact</h2>
  <blockquote>${esc(input.canonicalClaim)}</blockquote>
  <h2>Sources</h2>
  <ul>${rows}</ul>
  <h2>Evidence retained</h2>
  <ul>${snaps}</ul>
  <p>Prepared by Miscited on behalf of ${esc(input.brandName)}. This document was not sent automatically.</p>
</article>`,
  };
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------- repository

export function createConnectorConfig(db: DB, tenantId: string, c: Row): Row {
  const row = {
    id: id('cnx'), tenant_id: tenantId, kind: c.kind, target: c.target,
    token: c.token ?? '', enabled: c.enabled ?? 1, created_at: nowIso(),
  };
  db.prepare(
    'INSERT INTO connector_configs (id, tenant_id, kind, target, token, enabled, created_at) VALUES (@id, @tenant_id, @kind, @target, @token, @enabled, @created_at)',
  ).run(row);
  return row;
}

export function listConnectorConfigs(db: DB, tenantId: string): Row[] {
  return db.prepare('SELECT * FROM connector_configs WHERE tenant_id = ? ORDER BY created_at').all(tenantId) as Row[];
}

export function getConnectorConfig(db: DB, tenantId: string, kind: string): Row | undefined {
  return db
    .prepare('SELECT * FROM connector_configs WHERE tenant_id = ? AND kind = ? AND enabled = 1')
    .get(tenantId, kind) as Row | undefined;
}

/**
 * Run a connector for an action. On failure the action stays exactly where it was; the error
 * is written to the row and surfaced in the UI. There is no path from a failed call to
 * `shipped`, and `tests/unit/connectors.test.ts` asserts it.
 */
export async function shipAction(
  db: DB,
  tenantId: string,
  actionId: string,
  connector: Connector,
  ctx: ShipContext,
  cfg: Row,
): Promise<ShipOutcome> {
  const action = repo.getAction(db, tenantId, actionId);
  if (!action) throw new Error('action not found');
  const outcome = await connector.ship(action, ctx, cfg);
  if (!outcome.ok) {
    repo.setActionConnector(db, tenantId, actionId, {
      connector: connector.key,
      external_ref: null,
      external_url: null,
      last_error: outcome.error ?? 'connector failed',
    });
    repo.audit(db, tenantId, 'system', 'connector_failed', 'action', actionId, `${connector.key}: ${outcome.error}`);
    return outcome;
  }
  repo.setActionConnector(db, tenantId, actionId, {
    connector: connector.key,
    external_ref: outcome.externalRef ?? null,
    external_url: outcome.url ?? null,
    last_error: null,
  });
  repo.audit(db, tenantId, 'system', 'connector_opened', 'action', actionId, `${connector.key} ref=${outcome.externalRef}`);
  return outcome;
}
