/**
 * Static enforcement of tenant isolation.
 *
 * Multi-tenant leaks are not caught reliably by feature tests, because a leak looks like a
 * feature working. This inspects the repository source directly: every statement that reads
 * or writes a tenant-scoped table must carry a tenant_id predicate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_DIR = join(process.cwd(), 'src', 'db', 'repo');

const TENANT_SCOPED = [
  'brands', 'entities', 'entity_relationships', 'demand_signals', 'intent_clusters',
  'prompt_variants', 'truth_sources', 'canonical_claims', 'model_runs', 'observed_claims',
  'citations', 'actions', 'action_transitions', 'experiments', 'business_outcomes',
  'crawler_events', 'alerts', 'audit_log',
];

function statements(sql: string): string[] {
  // Split the file into individual SQL strings passed to db.prepare(...).
  const out: string[] = [];
  const re = /prepare\(\s*(`|')([\s\S]*?)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push(m[2]);
  return out;
}

describe('repository tenant scoping', () => {
  const files = readdirSync(REPO_DIR).filter((f) => f.endsWith('.ts'));

  it('has repository files to inspect', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const source = readFileSync(join(REPO_DIR, file), 'utf8');
    const stmts = statements(source);

    it(`${file}: every tenant-scoped statement carries a tenant_id predicate`, () => {
      const offenders: string[] = [];
      for (const stmt of stmts) {
        const lower = stmt.toLowerCase();
        const touches = TENANT_SCOPED.some((t) => new RegExp(`\\b(from|join|into|update)\\s+${t}\\b`).test(lower));
        if (!touches) continue;
        const scoped = /tenant_id\s*=/.test(lower) || /tenant_id/.test(lower);
        if (!scoped) offenders.push(stmt.replace(/\s+/g, ' ').slice(0, 120));
      }
      expect(offenders, `unscoped statements in ${file}`).toEqual([]);
    });

    it(`${file}: every SELECT and UPDATE on a tenant-scoped table filters on tenant_id`, () => {
      const offenders: string[] = [];
      for (const stmt of stmts) {
        const lower = stmt.toLowerCase().replace(/\s+/g, ' ');
        if (!/^\s*(select|update|delete)/.test(lower)) continue;
        const touches = TENANT_SCOPED.some((t) => new RegExp(`\\b(from|join|update)\\s+${t}\\b`).test(lower));
        if (!touches) continue;
        if (!/(where|and)[^;]*tenant_id\s*=/.test(lower)) offenders.push(lower.slice(0, 140));
      }
      expect(offenders, `unfiltered reads in ${file}`).toEqual([]);
    });
  }
});
