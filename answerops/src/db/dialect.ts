/** SQL rendering policy. Identifiers are supplied by repository code, never user input. */
export const UNIT_SEP = '\u001F';
export type DialectName = 'sqlite' | 'postgres';
export interface Dialect {
  name: DialectName;
  groupConcat(column: string): string;
  now(): string;
  ilike(column: string, param: string): string;
  split(value: unknown): string[];
}
const split = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(UNIT_SEP)
    .filter((part) => part.length > 0);
};
export const sqliteDialect: Dialect = {
  name: 'sqlite',
  // SQLite forbids DISTINCT with a second aggregate argument. Append a sentinel per
  // value, remove only sentinel+comma boundaries, and retain commas inside labels.
  groupConcat: (column) =>
    `rtrim(replace(GROUP_CONCAT(DISTINCT ${column} || char(31)), char(31) || ',', char(31)), char(31))`,
  now: () => "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  ilike: (column, param) => `LOWER(${column}) LIKE LOWER(${param})`,
  split,
};
export const postgresDialect: Dialect = {
  name: 'postgres',
  groupConcat: (column) => `string_agg(DISTINCT ${column}, chr(31))`,
  now: () => 'now()',
  ilike: (column, param) => `${column} ILIKE ${param}`,
  split,
};
export function dialectFor(name: DialectName): Dialect {
  return { sqlite: sqliteDialect, postgres: postgresDialect }[name] ?? sqliteDialect;
}
export function activeDialect(): Dialect {
  const protocol = (process.env.DATABASE_URL ?? '').split('://')[0];
  return dialectFor(protocol === 'postgres' || protocol === 'postgresql' ? 'postgres' : 'sqlite');
}
