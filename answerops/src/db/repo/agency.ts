import type { DB } from '../index.js';
import { id, nowIso } from '../index.js';
import { statements } from './statements.js';

export interface BrandRoleRow {
  id: string;
  tenant_id: string;
  user_id: string;
  brand_id: string;
  role: string;
  created_at: string;
}
export function setBrandRole(db: DB, tenantId: string, userId: string, brandId: string, role: string): void {
  const record: BrandRoleRow = {
    id: id('ubr'),
    tenant_id: tenantId,
    user_id: userId,
    brand_id: brandId,
    role,
    created_at: nowIso(),
  };
  statements(db)
    .prepare(
      'INSERT INTO user_brand_roles (id, tenant_id, user_id, brand_id, role, created_at) VALUES (@id, @tenant_id, @user_id, @brand_id, @role, @created_at) ON CONFLICT(tenant_id, user_id, brand_id) DO UPDATE SET role = excluded.role',
    )
    .run(record);
}
export function brandRolesFor(db: DB, tenantId: string, userId: string): BrandRoleRow[] {
  return statements(db)
    .prepare('SELECT * FROM user_brand_roles WHERE tenant_id = ? AND user_id = ?')
    .all(tenantId, userId) as BrandRoleRow[];
}
export function brandRole(db: DB, tenantId: string, userId: string, brandId: string): string | null {
  const record = statements(db)
    .prepare('SELECT role FROM user_brand_roles WHERE tenant_id = ? AND user_id = ? AND brand_id = ?')
    .get(tenantId, userId, brandId) as Pick<BrandRoleRow, 'role'> | undefined;
  return record ? record.role : null;
}
export function rolesForBrand(
  db: DB,
  tenantId: string,
  brandId: string,
): Array<BrandRoleRow & { email: string }> {
  return statements(db)
    .prepare(
      'SELECT ubr.*, u.email FROM user_brand_roles ubr JOIN users u ON u.id = ubr.user_id WHERE ubr.tenant_id = ? AND ubr.brand_id = ?',
    )
    .all(tenantId, brandId) as Array<BrandRoleRow & { email: string }>;
}
