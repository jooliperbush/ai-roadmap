import type { DB } from '../index.js';
import type { Statement } from 'better-sqlite3';

/** Cache SQL plans per connection; weak ownership cannot keep closed workspaces alive. */
class StatementPool {
  private readonly plans = new Map<string, Statement>();
  constructor(private readonly db: DB) {}
  prepare(sql: string): Statement {
    let statement = this.plans.get(sql);
    if (statement) this.plans.delete(sql);
    else statement = this.db.prepare(sql);
    this.plans.set(sql, statement);
    if (this.plans.size > 128) this.plans.delete(this.plans.keys().next().value!);
    return statement;
  }
}
const connections = new WeakMap<DB, StatementPool>();
export function statements(db: DB): StatementPool {
  let pool = connections.get(db);
  if (!pool) {
    pool = new StatementPool(db);
    connections.set(db, pool);
  }
  return pool;
}

/** Authentication supplies tenant identity. Caller-provided payload fields cannot replace it. */
export function tenantRecord<T extends Record<string, unknown>>(
  tenantId: string,
  fields: T,
): T & { tenant_id: string } {
  return Object.assign({}, fields, { tenant_id: tenantId });
}

/** Nested callers receive a SQLite savepoint, so batch writes remain all-or-nothing. */
export function atomic<T>(db: DB, operation: () => T): T {
  return db.transaction(operation)();
}

export function groupRows<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  return rows.reduce((groups, row) => {
    const value = key(row);
    const previous = groups.get(value);
    if (previous) previous.push(row);
    else groups.set(value, [row]);
    return groups;
  }, new Map<string, T[]>());
}
