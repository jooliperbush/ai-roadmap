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
import { statements } from '../db/repo/statements.js';
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
  const intro = `## What this corrects\n\nAn AI answer about ${ctx.brandName} stated:\n\n> ${ctx.defectStatement}\n\nThe approved canonical fact is:\n\n> ${ctx.canonicalClaim}\n\n## Evidence\n`;
  const evidence = ctx.evidenceIds.reduce((text, id) => `${text}\n- \`${id}\``, '');
  const measurement = ctx.experimentId
    ? `This change is tracked as experiment \`${ctx.experimentId}\`. It moves to *shipped* when this PR merges, and to *crawled* when the relevant bot class fetches the page.`
    : 'No experiment is attached to this action yet.';
  return (
    intro +
    evidence +
    '\n\n## Measurement\n\n' +
    measurement +
    '\n\n---\nOpened by Miscited. Nothing here is published automatically; this is a pull request for a human to review.'
  );
}

// ---------------------------------------------------------------------- GitHub

class ConnectorHttp {
  constructor(
    private fetchImpl: typeof fetch,
    private token: string,
  ) {}
  async request(url: string, operation: string, body?: unknown, tolerate?: number): Promise<Response> {
    const response = await this.fetchImpl(url, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
    });
    if (!response.ok && response.status !== tolerate) throw new Error(`${operation} (${response.status})`);
    return response;
  }
}

function connectorFailure(error: unknown, fallback: string): ShipOutcome {
  return { ok: false, error: error instanceof Error ? error.message.slice(0, 160) : fallback };
}

export class GithubConnector implements Connector {
  key = 'github';
  handles: ActionType[] = [
    'update_owned_page',
    'create_comparison_page',
    'create_evidence_page',
    'fix_fact_inconsistency',
    'update_structured_data',
    'open_github_pr',
  ];
  constructor(private fetchImpl: typeof fetch = fetch) {}
  async ship(action: Row, ctx: ShipContext, cfg: Row): Promise<ShipOutcome> {
    const [owner, name] = String(cfg.target).split('/');
    if (!owner || !name) return { ok: false, error: 'connector target must be owner/repo' };
    const api = `https://api.github.com/repos/${owner}/${name}`;
    const branch = `miscited/${action.id}`;
    const http = new ConnectorHttp(this.fetchImpl, cfg.token);
    try {
      const head = (await (
        await http.request(`${api}/git/ref/heads/main`, 'could not read main')
      ).json()) as any;
      if (!head?.object?.sha) return { ok: false, error: 'main has no head sha' };
      await http.request(
        `${api}/git/refs`,
        'could not create branch',
        { ref: `refs/heads/${branch}`, sha: head.object.sha },
        422,
      );
      const commit = await this.fetchImpl(`${api}/contents/${encodeURIComponent(ctx.path)}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${cfg.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: `Correct ${ctx.path}: ${action.title}`,
          content: Buffer.from(ctx.body, 'utf8').toString('base64'),
          branch,
        }),
      });
      if (!commit.ok) return { ok: false, error: `could not commit (${commit.status})` };
      const pull = (await (
        await http.request(`${api}/pulls`, 'could not open PR', {
          title: action.title,
          head: branch,
          base: 'main',
          body: prBody(ctx),
        })
      ).json()) as any;
      return { ok: true, externalRef: String(pull.number), url: pull.html_url };
    } catch (error) {
      return connectorFailure(error, 'github call failed');
    }
  }
}

const CMS_ACTIONS: ActionType[] = [
  'create_cms_draft',
  'update_owned_page',
  'create_evidence_page',
  'create_comparison_page',
];
async function cmsDraft(
  fetchImpl: typeof fetch,
  kind: string,
  url: string,
  token: string,
  body: unknown,
): Promise<ShipOutcome> {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, error: `${kind} ${response.status}` };
    const draft = (await response.json()) as any;
    return {
      ok: true,
      externalRef: kind === 'wordpress' ? String(draft?.id ?? '') : (draft?.id ?? ''),
      url: kind === 'wordpress' ? (draft?.link ?? '') : (draft?.previewUrl ?? ''),
    };
  } catch (error) {
    return connectorFailure(error, `${kind} call failed`);
  }
}

export class WebflowConnector implements Connector {
  key = 'webflow';
  handles = [...CMS_ACTIONS];
  constructor(private fetchImpl: typeof fetch = fetch) {}
  ship(action: Row, ctx: ShipContext, cfg: Row): Promise<ShipOutcome> {
    return cmsDraft(
      this.fetchImpl,
      this.key,
      `https://api.webflow.com/v2/collections/${cfg.target}/items`,
      cfg.token,
      { isDraft: true, fieldData: { name: action.title, body: ctx.body } },
    );
  }
}

export class WordpressConnector implements Connector {
  key = 'wordpress';
  handles = [...CMS_ACTIONS];
  constructor(private fetchImpl: typeof fetch = fetch) {}
  ship(action: Row, ctx: ShipContext, cfg: Row): Promise<ShipOutcome> {
    return cmsDraft(
      this.fetchImpl,
      this.key,
      `${String(cfg.target).replace(/\/$/, '')}/wp-json/wp/v2/posts`,
      cfg.token,
      { title: action.title, content: ctx.body, status: 'draft' },
    );
  }
}

/** Records the call and never leaves the process. The default in tests and the demo. */
export class RecordingConnector implements Connector {
  calls: Array<{ action: Row; ctx: ShipContext }> = [];
  constructor(
    public key: string,
    public handles: ActionType[],
    private failWith: string | null = null,
  ) {}
  async ship(action: Row, ctx: ShipContext): Promise<ShipOutcome> {
    const count = this.calls.push({ action, ctx });
    return this.failWith
      ? { ok: false, error: this.failWith }
      : { ok: true, externalRef: `rec-${count}`, url: `https://example.invalid/${action.id}` };
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
export function buildJsonLd(
  type: SchemaType,
  fields: Record<string, unknown>,
  current: Record<string, unknown> | null,
): JsonLdResult {
  const jsonLd: Record<string, unknown> = { '@context': 'https://schema.org', '@type': type, ...fields };
  const previous = current ?? {};
  const missing = (REQUIRED_FIELDS[type] ?? []).filter(
    (field) => fields[field] === undefined || fields[field] === '',
  );
  const diff: JsonLdResult['diff'] = [];
  for (const field of new Set([...Object.keys(jsonLd), ...Object.keys(previous)])) {
    if (!(field in previous)) diff.push({ side: 'added', field, to: jsonLd[field] });
    else if (!(field in jsonLd)) diff.push({ side: 'removed', field, from: previous[field] });
    else if (JSON.stringify(previous[field]) !== JSON.stringify(jsonLd[field]))
      diff.push({ side: 'changed', field, from: previous[field], to: jsonLd[field] });
  }
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
  const sources = input.sources.reduce(
    (markup, source) =>
      markup + `<li><a href="${esc(source.url)}">${esc(source.title || source.url)}</a></li>`,
    '',
  );
  const captures = input.snapshots.reduce(
    (markup, capture) =>
      markup +
      `<li><code>${esc(capture.sha256.slice(0, 12))}</code> — ${esc(capture.url)} captured ${esc(capture.fetchedAt.slice(0, 10))}</li>`,
    '',
  );
  const sections = [
    ['What the page states', `<blockquote>${esc(input.wrongStatement)}</blockquote>`],
    ['The current fact', `<blockquote>${esc(input.canonicalClaim)}</blockquote>`],
    ['Sources', `<ul>${sources}</ul>`],
    ['Evidence retained', `<ul>${captures}</ul>`],
  ];
  const body = sections.map(([title, content]) => `  <h2>${title}</h2>\n  ${content}`).join('\n');
  return {
    publisher: input.publisher,
    subject: `Correction request: ${input.brandName}`,
    html: `<article>\n  <h1>Correction request for ${esc(input.publisher)}</h1>\n  <p>Regarding <a href="${esc(input.publisherUrl)}">${esc(input.publisherUrl)}</a>.</p>\n${body}\n  <p>Prepared by Miscited on behalf of ${esc(input.brandName)}. This document was not sent automatically.</p>\n</article>`,
  };
}

function esc(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(value).replace(/[&<>"]/g, (character) => entities[character]);
}

// ------------------------------------------------------------------- repository

export function createConnectorConfig(db: DB, tenantId: string, config: Row): Row {
  const record = {
    id: id('cnx'),
    tenant_id: tenantId,
    kind: config.kind,
    target: config.target,
    token: config.token ?? '',
    enabled: config.enabled ?? 1,
    created_at: nowIso(),
  };
  const columns = Object.keys(record);
  statements(db)
    .prepare(
      `INSERT INTO connector_configs (${columns.join(', ')}) VALUES (${columns.map((column) => `@${column}`).join(', ')})`,
    )
    .run(record);
  return record;
}

export function listConnectorConfigs(db: DB, tenantId: string): Row[] {
  return statements(db)
    .prepare('SELECT * FROM connector_configs WHERE tenant_id = @tenantId ORDER BY created_at')
    .all({ tenantId }) as Row[];
}

export function getConnectorConfig(db: DB, tenantId: string, kind: string): Row | undefined {
  return statements(db)
    .prepare('SELECT * FROM connector_configs WHERE tenant_id = @tenantId AND kind = @kind AND enabled = 1')
    .get({ tenantId, kind }) as Row | undefined;
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
  let outcome: ShipOutcome;
  try {
    outcome = await connector.ship(action, ctx, cfg);
  } catch (error) {
    outcome = connectorFailure(error, 'connector failed');
  }
  db.transaction(() => {
    repo.setActionConnector(db, tenantId, actionId, {
      connector: connector.key,
      external_ref: outcome.ok ? (outcome.externalRef ?? null) : null,
      external_url: outcome.ok ? (outcome.url ?? null) : null,
      last_error: outcome.ok ? null : (outcome.error ?? 'connector failed'),
    });
    repo.audit(
      db,
      tenantId,
      'system',
      outcome.ok ? 'connector_opened' : 'connector_failed',
      'action',
      actionId,
      outcome.ok ? `${connector.key} ref=${outcome.externalRef}` : `${connector.key}: ${outcome.error}`,
    );
  })();
  return outcome;
}
