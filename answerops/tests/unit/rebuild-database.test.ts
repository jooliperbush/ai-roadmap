import { createHash } from 'node:crypto';
import { describe, test, expect } from 'vitest';
import { hashPassword, verifyPassword, openDb } from '../../src/db/index.js';

describe('replacement persistence and credentials', () => {
  test('legacy accounts remain able to sign in', () => {
    const salt = 'legacy-account-salt';
    const hash = createHash('sha256').update(`${salt}:old-password`).digest('hex');
    expect(verifyPassword('old-password', hash, salt)).toBe(true);
    expect(verifyPassword('wrong-password', hash, salt)).toBe(false);
  });
  test('new passwords use a versioned memory-hard digest', () => {
    const result = hashPassword('new-password');
    expect(result.hash).toMatch(/^scrypt\$16384\$8\$1\$[a-f0-9]{128}$/);
    expect(verifyPassword('new-password', result.hash, result.salt)).toBe(true);
    expect(verifyPassword('wrong-password', result.hash, result.salt)).toBe(false);
  });
  test('malformed password records fail closed without throwing', () => {
    expect(verifyPassword('x', 'scrypt$bad', 'salt')).toBe(false);
    expect(verifyPassword('x', 'scrypt$999999999$8$1$ff', 'salt')).toBe(false);
  });
  test('initial schema is ready for legacy data', () => {
    const db = openDb(':memory:');
    try {
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n,
      ).toBeGreaterThanOrEqual(8);
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observed_claims'").get(),
      ).toBeDefined();
    } finally {
      db.close();
    }
  });
});

test('a failed schema migration rolls back its DDL as well as its ledger entry', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { migrate } = await import('../../src/db/index.js');
  const db = new Database(':memory:');
  const execute = db.exec.bind(db);
  db.exec = ((sql: string) => {
    const result = execute(sql);
    if (sql.includes('CREATE TABLE IF NOT EXISTS tenants')) throw new Error('interrupted migration');
    return result;
  }) as typeof db.exec;
  try {
    expect(() => migrate(db)).toThrow('interrupted migration');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'tenants'").get()).toBeUndefined();
    expect((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(0);
    db.exec = execute;
    migrate(db);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'tenants'").get()).toBeDefined();
  } finally {
    db.close();
  }
});
