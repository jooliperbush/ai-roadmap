/**
 * SQL dialect seam.
 *
 * The repository is written to port to Postgres, and the one place it did not was
 * `GROUP_CONCAT`. That has already been removed from the dashboard rollup in favour of an
 * in-memory grouping, which was the right fix: the comma delimiter was a correctness smell,
 * safe only because cluster ids happen to contain no commas today.
 *
 * What remains lives here, so the port is a matter of choosing a dialect rather than auditing
 * every statement. The separator is the ASCII unit separator, which cannot appear in a label.
 */

export const UNIT_SEP = '\u001F';

export type DialectName = 'sqlite' | 'postgres';

export interface Dialect {
  name: DialectName;
  /** aggregate distinct values of `column` into one delimited string */
  groupConcat(column: string): string;
  /** current-timestamp expression */
  now(): string;
  /** case-insensitive LIKE */
  ilike(column: string, param: string): string;
  /** parse a delimited aggregate back into a list */
  split(value: unknown): string[];
}

export const sqliteDialect: Dialect = {
  name: 'sqlite',
  groupConcat: (column) => `GROUP_CONCAT(DISTINCT ${column}, char(31))`,
  now: () => "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  ilike: (column, param) => `LOWER(${column}) LIKE LOWER(${param})`,
  split: (value) => String(value ?? '').split(UNIT_SEP).filter(Boolean),
};

export const postgresDialect: Dialect = {
  name: 'postgres',
  groupConcat: (column) => `string_agg(DISTINCT ${column}, chr(31))`,
  now: () => 'now()',
  ilike: (column, param) => `${column} ILIKE ${param}`,
  split: (value) => String(value ?? '').split(UNIT_SEP).filter(Boolean),
};

export function dialectFor(name: DialectName): Dialect {
  return name === 'postgres' ? postgresDialect : sqliteDialect;
}

/** Chosen by DATABASE_URL: a postgres:// URL selects the postgres dialect. */
export function activeDialect(): Dialect {
  return /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '') ? postgresDialect : sqliteDialect;
}
