/**
 * Who may change what.
 *
 * `Auth.role` used to be read into the session and never checked, which meant a viewer could
 * spend the workspace's sampling budget. Every non-GET route now declares a minimum role in
 * one table, and a boot assertion fails if a route is registered without one, so a new
 * mutating route cannot be added without someone making a decision about it.
 */

export type Role = 'viewer' | 'editor' | 'owner';

export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export function rankOf(role: string): number {
  return ROLE_RANK[(role as Role)] ?? -1;
}

export function allows(role: string, minimum: Role): boolean {
  return rankOf(role) >= ROLE_RANK[minimum];
}

/**
 * Minimum role per mutating route, keyed `METHOD path` exactly as Fastify registers it.
 * Routes reachable before a session exists are listed in PUBLIC_ROUTES instead.
 */
export const ROUTE_ROLES: Record<string, Role> = {
  'POST /logout': 'viewer',
  'POST /demand/import': 'editor',
  'POST /truth': 'editor',
  'POST /truth/:id/approve': 'owner',
  'POST /sampling/run': 'editor',
  'POST /actions': 'editor',
  'POST /actions/:id/transition': 'editor',
  'POST /experiments/:id/analyze': 'editor',
  'POST /entities/:id/classify': 'editor',
  'POST /clusters/:id/markets': 'editor',
  'POST /citations/:id/recheck': 'editor',
  'POST /schedules': 'owner',
  'POST /schedules/:id/toggle': 'owner',
  'POST /schedules/:id/run': 'editor',
  'POST /channels': 'owner',
  'POST /channels/:id/delete': 'owner',
  'POST /channels/:id/test': 'owner',
  'POST /alerts/:id/read': 'viewer',
  'POST /brands/switch': 'viewer',
  'POST /brands': 'owner',
  'POST /brands/:id/roles': 'owner',
  'POST /index-consent': 'owner',
  'POST /api/actions': 'editor',
  'POST /api/actions/:id/transition': 'editor',
  'POST /api/runs/sample': 'editor',
};

/** Reachable without a session. Each is rate limited; none of them reads workspace data. */
export const PUBLIC_ROUTES = new Set(['POST /login', 'POST /audit-request', 'POST /audit/:token/start']);

/** Routes exempt from CSRF because no session cookie exists yet when they are called. */
export const CSRF_EXEMPT = PUBLIC_ROUTES;

export function routeKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}
