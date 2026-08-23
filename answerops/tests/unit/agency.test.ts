/**
 * Markets, dialect portability, connectors and the index boundary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fanout, assertNoGeoBlending, GeoBlendingError, marketLabel, MARKETS, LOCALISED_PREFIX } from '../../src/domain/geo.js';
import { sqliteDialect, postgresDialect, dialectFor, UNIT_SEP } from '../../src/db/dialect.js';
import { buildJsonLd, correctionPacket, prBody, RecordingConnector, SCHEMA_TYPES } from '../../src/services/connectors.js';
import { predicateClass, quarterOf, EXPORT_FIELDS, K_ANON } from '../../src/services/index-report.js';

describe('market fan-out', () => {
  it('defaults to one market when none are declared', () => {
    expect(fanout({ prompt: 'is it legit', geos: [], languages: [] })).toEqual([
      { prompt: 'is it legit', geo: 'US', language: 'en' },
    ]);
  });

  it('pairs each geo with the language actually spoken there', () => {
    const out = fanout({ prompt: 'fees', geos: ['US', 'DE', 'FR'], languages: ['en', 'de', 'fr'] });
    expect(out.map((v) => `${v.geo}/${v.language}`)).toEqual(['US/en', 'DE/de', 'FR/fr']);
  });

  it('localises the prompt so a market is actually sampled in its language', () => {
    const out = fanout({ prompt: 'what are the fees', geos: ['DE'], languages: ['de'] });
    expect(out[0].prompt.startsWith(LOCALISED_PREFIX.de)).toBe(true);
  });

  it('respects a variant cap, taking the markets in declared order', () => {
    const out = fanout({ prompt: 'x', geos: ['US', 'GB', 'DE'], languages: ['en'] }, 2);
    expect(out).toHaveLength(2);
    expect(out[0].geo).toBe('US');
  });

  it('labels every market it knows', () => {
    for (const m of MARKETS) expect(marketLabel(m.geo, m.language)).toBe(m.label);
    expect(marketLabel('ZZ', 'zz')).toBe('ZZ, zz');
  });
});

describe('markets are never pooled', () => {
  it('allows one market and refuses two, the same way intent families work', () => {
    expect(() => assertNoGeoBlending(['US', 'US'])).not.toThrow();
    expect(() => assertNoGeoBlending(['US', 'DE'])).toThrow(GeoBlendingError);
  });

  it('names the markets it refused to average', () => {
    try {
      assertNoGeoBlending(['US', 'DE', 'JP']);
      throw new Error('should have refused');
    } catch (err) {
      expect((err as Error).message).toMatch(/US, DE, JP/);
    }
  });
});

describe('dialect portability', () => {
  it('aggregates with a separator no label can contain', () => {
    expect(sqliteDialect.groupConcat('x')).toContain('char(31)');
    expect(postgresDialect.groupConcat('x')).toContain('chr(31)');
    expect(UNIT_SEP.charCodeAt(0)).toBe(31);
  });

  it('round-trips a value containing a comma, which the old delimiter could not', () => {
    const labels = ['best L1, ranked', 'fees'];
    expect(sqliteDialect.split(labels.join(UNIT_SEP))).toEqual(labels);
  });

  it('selects a dialect by name', () => {
    expect(dialectFor('postgres').name).toBe('postgres');
    expect(dialectFor('sqlite').name).toBe('sqlite');
  });

  it('has no comma-joined aggregate left in any repository statement', () => {
    // Scans the SQL actually passed to db.prepare, not the prose around it, so the note
    // explaining why the old rollup was removed does not count as the thing it describes.
    const offenders: string[] = [];
    for (const file of readdirSync('src/db/repo').filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join('src/db/repo', file), 'utf8');
      for (const m of source.matchAll(/prepare\(\s*(`|')([\s\S]*?)\1\s*\)/g)) {
        if (/GROUP_CONCAT|string_agg/i.test(m[2])) offenders.push(`${file}: ${m[2].replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(offenders, 'the rollup moved in-memory, which removed the comma hazard and the N+1 together').toEqual([]);
  });
});

describe('connectors', () => {
  it('puts the defect, the evidence and the experiment in the PR body', () => {
    const body = prBody({
      brandName: 'Northwind', brandDomain: 'northwind.com',
      defectStatement: 'Northwind was acquired by Contoso in 2021.',
      canonicalClaim: 'Northwind is independent.',
      evidenceIds: ['obs_1', 'obs_2'], experimentId: 'exp_9', body: '', path: 'about.md',
    });
    expect(body).toContain('Northwind was acquired by Contoso in 2021.');
    expect(body).toContain('obs_1');
    expect(body).toContain('exp_9');
    expect(body).toMatch(/not published automatically|for a human to review/i);
  });

  it('validates a JSON-LD patch against the declared type and diffs it', () => {
    const ok = buildJsonLd('Organization', { name: 'Northwind', url: 'https://northwind.com' }, { name: 'Old' });
    expect(ok.valid).toBe(true);
    expect(ok.diff).toContainEqual(expect.objectContaining({ side: 'changed', field: 'name' }));

    const bad = buildJsonLd('Organization', { name: 'Northwind' }, null);
    expect(bad.valid).toBe(false);
    expect(bad.missing).toContain('url');
  });

  it('covers every declared schema type', () => {
    for (const type of SCHEMA_TYPES) {
      expect(() => buildJsonLd(type, { name: 'x', headline: 'x', applicationCategory: 'x', mainEntity: [] }, null)).not.toThrow();
    }
  });

  it('builds a correction packet carrying the snapshots', () => {
    const packet = correctionPacket({
      publisher: 'Example Post', publisherUrl: 'https://example.com/a', brandName: 'Northwind',
      wrongStatement: 'Acquired in 2021.', canonicalClaim: 'Independent since founding.',
      sources: [{ url: 'https://northwind.com/about', title: 'About' }],
      snapshots: [{ url: 'https://example.com/a', sha256: 'abc123def456789', fetchedAt: '2026-08-01T00:00:00Z' }],
    });
    expect(packet.html).toContain('Acquired in 2021.');
    expect(packet.html).toContain('abc123def456');
    expect(packet.html).toMatch(/not sent automatically/);
  });

  it('escapes markup in a packet rather than embedding it', () => {
    const packet = correctionPacket({
      publisher: '<script>x</script>', publisherUrl: 'https://e.com', brandName: 'N',
      wrongStatement: '<img onerror=1>', canonicalClaim: 'c', sources: [], snapshots: [],
    });
    expect(packet.html).not.toContain('<script>');
    expect(packet.html).toContain('&lt;script&gt;');
  });

  it('has no outbound transport for a correction packet anywhere in the codebase', () => {
    const source = readFileSync('src/services/connectors.ts', 'utf8');
    const packetSection = source.slice(source.indexOf('correctionPacket'));
    expect(/fetch\(|sendMail|smtp|resend/i.test(packetSection),
      'the moment this system sends a correction itself it becomes a spam vector').toBe(false);
  });

  it('records a call without leaving the process', async () => {
    const connector = new RecordingConnector('rec', ['update_owned_page']);
    const out = await connector.ship({ id: 'act_1', title: 't' } as any, {} as any);
    expect(out.ok).toBe(true);
    expect(connector.calls).toHaveLength(1);
  });

  it('reports failure rather than a false success', async () => {
    const connector = new RecordingConnector('rec', ['update_owned_page'], 'permission denied');
    const out = await connector.ship({ id: 'act_1', title: 't' } as any, {} as any);
    expect(out.ok).toBe(false);
    expect(out.externalRef).toBeUndefined();
  });
});

describe('the index boundary', () => {
  it('exports six fields and none of them is free text', () => {
    expect([...EXPORT_FIELDS].sort()).toEqual(
      ['industry_category', 'model_version', 'predicate_class', 'provider', 'quarter', 'verdict'],
    );
    for (const f of EXPORT_FIELDS) {
      expect(['brand', 'label', 'answer', 'statement', 'prompt', 'url']).not.toContain(f);
    }
  });

  it('groups predicates into classes so a rare one cannot fingerprint a participant', () => {
    expect(predicateClass('acquired_by')).toBe('corporate');
    expect(predicateClass('token_supply')).toBe('product');
    expect(predicateClass('something_new')).toBe('other');
  });

  it('names quarters', () => {
    expect(quarterOf(new Date('2026-02-10T00:00:00Z'))).toBe('2026-Q1');
    expect(quarterOf(new Date('2026-11-10T00:00:00Z'))).toBe('2026-Q4');
  });

  it('sets k at five, not at one', () => {
    expect(K_ANON).toBeGreaterThanOrEqual(5);
  });
});
