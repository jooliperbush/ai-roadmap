import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export type DB = Database.Database;
const migrations = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const passwordFormat = 'scrypt$16384$8$1$';

/** Opens the existing schema without changing the meaning of released migrations. */
export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Schema change and ledger entry commit together; a failed migration is retryable. */
export function migrate(db: DB): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const lookup = db.prepare('SELECT 1 FROM schema_migrations WHERE filename = ?');
  const record = db.prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)');
  for (const filename of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    db.transaction(() => {
      if (lookup.get(filename)) return;
      db.exec(readFileSync(join(migrations, filename), 'utf8'));
      record.run(filename, nowIso());
    }).immediate();
  }
}

const identifier = (value: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('Invalid SQL identifier');
  return `"${value}"`;
};

export function addColumnIfMissing(db: DB, table: string, column: string, ddl: string): void {
  const columns = db.pragma(`table_info(${identifier(table)})`) as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column))
    db.exec(`ALTER TABLE ${identifier(table)} ADD COLUMN ${identifier(column)} ${ddl}`);
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}
export function nowIso(): string {
  return new Date().toISOString();
}

export function hashPassword(
  password: string,
  salt = randomBytes(16).toString('hex'),
): { hash: string; salt: string } {
  const digest = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { hash: passwordFormat + digest.toString('hex'), salt };
}

/** Legacy SHA-256 records remain readable; all newly stored passwords use scrypt. */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  let actual: Buffer;
  let expected: Buffer;
  if (/^[a-f0-9]{64}$/.test(hash)) {
    actual = createHash('sha256').update(`${salt}:${password}`).digest();
    expected = Buffer.from(hash, 'hex');
  } else if (hash.startsWith(passwordFormat) && /^[a-f0-9]{128}$/.test(hash.slice(passwordFormat.length))) {
    actual = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    expected = Buffer.from(hash.slice(passwordFormat.length), 'hex');
  } else return false;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
