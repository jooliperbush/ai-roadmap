export interface RuntimeConfig {
  port: number;
  dbPath: string;
  scheduler: boolean;
  tickMs: number;
  fetchMode: 'off' | 'demo' | 'http';
  logger: boolean;
  /** NODE_ENV=production: nothing is seeded, and the demo passwords published in this repository stop working. */
  production: boolean;
  /** The login page names the demo account outside production, or when MISCITED_SHOW_DEMO_HINT=1. */
  showDemoHint: boolean;
  /** MISCITED_DEMO_PASSWORD: the demo owner's password in production. Without it that login is locked. */
  demoPassword: string | null;
}
const integer = (name: string, value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
};
const password = (name: string, value: string | undefined) => {
  if (value && value.length < 12) throw new Error(`${name} must be at least 12 characters`);
  return value || null;
};
export function runtimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  return {
    port: integer('PORT', env.PORT, 4300, 0, 65535),
    dbPath: env.MISCITED_DB ?? (env.RAILWAY_ENVIRONMENT ? '/data/miscited.sqlite' : 'data/miscited.sqlite'),
    scheduler: env.MISCITED_NO_SCHEDULER !== '1',
    tickMs: integer('MISCITED_TICK_MS', env.MISCITED_TICK_MS, 60_000, 1, 2_147_483_647),
    fetchMode: env.MISCITED_NO_FETCH === '1' ? 'off' : env.MISCITED_DEMO_FETCH === '1' ? 'demo' : 'http',
    logger: env.LOG === '1',
    production: env.NODE_ENV === 'production',
    showDemoHint: env.NODE_ENV !== 'production' || env.MISCITED_SHOW_DEMO_HINT === '1',
    demoPassword: password('MISCITED_DEMO_PASSWORD', env.MISCITED_DEMO_PASSWORD),
  };
}
