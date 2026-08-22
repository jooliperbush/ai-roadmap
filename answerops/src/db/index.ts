import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  // The scheduler shares this file with the request handlers. Without a busy timeout a writer
  // that arrives mid-round fails immediately instead of waiting the few milliseconds it takes.
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/**
 * Versioned migrations. 001 and 002 are idempotent and predate this table, so an existing
 * database re-runs them exactly once and records them; everything from 003 onward may contain
 * ALTER TABLE, which is not idempotent and must run once and only once.
 */
export function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (db.prepare('SELECT filename FROM schema_migrations').all() as Array<{ filename: string }>).map((r) => r.filename),
  );
  const dir = join(here, 'migrations');
  const record = db.prepare('INSERT OR IGNORE INTO schema_migrations (filename, applied_at) VALUES (?, ?)');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    db.exec(readFileSync(join(dir, file), 'utf8'));
    record.run(file, nowIso());
  }
}

/** SQLite has no ADD COLUMN IF NOT EXISTS, and a migration that has already run must not throw. */
export function addColumnIfMissing(db: DB, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(`${s}:${password}`).digest('hex');
  return { hash, salt: s };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  return hashPassword(password, salt).hash === hash;
}

export function jsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
