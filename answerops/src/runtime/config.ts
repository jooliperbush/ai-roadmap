export interface RuntimeConfig {
  port: number;
  dbPath: string;
  scheduler: boolean;
  tickMs: number;
  fetchMode: 'off' | 'demo' | 'http';
  logger: boolean;
}
const integer = (name: string, value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
};
export function runtimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  return {
    port: integer('PORT', env.PORT, 4300, 0, 65535),
    dbPath: env.MISCITED_DB ?? (env.RAILWAY_ENVIRONMENT ? '/data/miscited.sqlite' : 'data/miscited.sqlite'),
    scheduler: env.MISCITED_NO_SCHEDULER !== '1',
    tickMs: integer('MISCITED_TICK_MS', env.MISCITED_TICK_MS, 60_000, 1, 2_147_483_647),
    fetchMode: env.MISCITED_NO_FETCH === '1' ? 'off' : env.MISCITED_DEMO_FETCH === '1' ? 'demo' : 'http',
    logger: env.LOG === '1',
  };
}
