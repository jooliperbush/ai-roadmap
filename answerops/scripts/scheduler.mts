/**
 * Standalone scheduler, for when the loop should not share a process with the web server.
 *
 * The lease makes this safe to run alongside the in-process one: whichever claims a schedule
 * first runs it, and the other moves on.
 */
import { openDb } from '../src/db/index.js';
import { tick, runDigests } from '../src/services/scheduler.js';
import { defaultTransports } from '../src/services/delivery.js';
import { HttpFetcher } from '../src/domain/fetcher.js';
import { systemClock } from '../src/domain/clock.js';
import { VANAR_AFTER, VANAR_BEFORE } from '../seed/simulation.js';

const db = openDb(process.env.MISCITED_DB ?? 'data/miscited.sqlite');
const transports = defaultTransports();
const fetcher = process.env.MISCITED_NO_FETCH === '1' ? null : new HttpFetcher();

const once = process.argv.includes('--once');
const digests = process.argv.includes('--digests');

async function run(): Promise<void> {
  if (digests) {
    const out = await runDigests(db, transports, systemClock);
    console.log(`digests: ${out.sent} sent across ${out.tenants} workspaces`);
    return;
  }
  const result = await tick(db, {
    clock: systemClock,
    owner: `cli-${process.pid}`,
    beliefsFor: (w) => (w === 'baseline' ? VANAR_BEFORE : VANAR_AFTER),
    fetcher,
    transports,
  });
  console.log(
    `claimed=${result.claimed} ran=${result.ran} failed=${result.failed} ` +
    `alerts=${result.alertsCreated} delivered=${result.delivered} windows=${result.windows.join(',') || 'none'}` +
    (result.errors.length ? ` errors=${result.errors.join('; ')}` : ''),
  );
}

await run();
if (!once && !digests) {
  setInterval(() => void run(), Number(process.env.MISCITED_TICK_MS ?? 60_000));
} else {
  process.exit(0);
}
