/**
 * Per-brand roles.
 *
 * An agency analyst may edit one client's workspace and only read another's. The user-level
 * role stays the default; a per-brand row overrides it downward or upward for that brand only.
 */

import type { DB } from '../index.js';
import { id, nowIso } from '../index.js';
import type { Row } from './index.js';

export function setBrandRole(db: DB, tenantId: string, userId: string, brandId: string, role: string): void {
  db.prepare(
    `INSERT INTO user_brand_roles (id, tenant_id, user_id, brand_id, role, created_at)
     VALUES (@id, @tenant_id, @user_id, @brand_id, @role, @created_at)
     ON CONFLICT(tenant_id, user_id, brand_id) DO UPDATE SET role = excluded.role`,
  ).run({ id: id('ubr'), tenant_id: tenantId, user_id: userId, brand_id: brandId, role, created_at: nowIso() });
}

export function brandRolesFor(db: DB, tenantId: string, userId: string): Row[] {
  return db
    .prepare('SELECT * FROM user_brand_roles WHERE tenant_id = ? AND user_id = ?')
    .all(tenantId, userId) as Row[];
}

export function brandRole(db: DB, tenantId: string, userId: string, brandId: string): string | null {
  const row = db
    .prepare('SELECT role FROM user_brand_roles WHERE tenant_id = ? AND user_id = ? AND brand_id = ?')
    .get(tenantId, userId, brandId) as Row | undefined;
  return row?.role ?? null;
}

export function rolesForBrand(db: DB, tenantId: string, brandId: string): Row[] {
  return db
    .prepare(
      `SELECT ubr.*, u.email FROM user_brand_roles ubr JOIN users u ON u.id = ubr.user_id
        WHERE ubr.tenant_id = ? AND ubr.brand_id = ?`,
    )
    .all(tenantId, brandId) as Row[];
}
