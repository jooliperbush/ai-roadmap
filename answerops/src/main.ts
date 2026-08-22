import { openDb } from './db/index.js';
import { buildServer } from './server.js';
import { VANAR_AFTER, VANAR_BEFORE, DEMO_PAGES, DEMO_AUDIT_BELIEFS } from '../seed/simulation.js';
import { ensureSeed } from './seed.js';
import { Scheduler, runDigests } from './services/scheduler.js';
import { defaultTransports } from './services/delivery.js';
import { HttpFetcher, StubFetcher } from './domain/fetcher.js';
import { systemClock } from './domain/clock.js';

const port = Number(process.env.PORT ?? 4300);
const dbPath = process.env.MISCITED_DB ?? (process.env.RAILWAY_ENVIRONMENT ? '/data/miscited.sqlite' : 'data/miscited.sqlite');

const db = openDb(dbPath);
const seeded = await ensureSeed(db);

// Cited pages are fetched by us, not by the model. Set MISCITED_NO_FETCH=1 to run entirely
// offline, in which case every citation whose provider did not supply a snapshot is recorded
// as unreachable with `blocked` as the stated reason.
// MISCITED_DEMO_FETCH serves the stand-in upstream's own cited pages from memory, so the
// evidence and re-check flows work in a demo and in the end-to-end suite without any request
// leaving the machine. It is never the production path.
const fetcher =
  process.env.MISCITED_NO_FETCH === '1'
    ? null
    : process.env.MISCITED_DEMO_FETCH === '1'
      ? new StubFetcher(DEMO_PAGES)
      : new HttpFetcher();
const transports = defaultTransports();

const app = buildServer({
  db,
  // The self-serve audit samples a domain nobody has onboarded, so it draws from the fixture
  // company's belief profile rather than the seeded workspace's.
  beliefsFor: (windowLabel) =>
    windowLabel === 'audit' ? DEMO_AUDIT_BELIEFS : windowLabel === 'baseline' ? VANAR_BEFORE : VANAR_AFTER,
  demoHint: seeded ? `Demo workspace: ${seeded.email} / ${seeded.password}` : null,
  logger: process.env.LOG === '1',
  clock: systemClock,
  transports,
  fetcher,
});

/**
 * The loop, in the web process.
 *
 * One process today, so this is the simplest thing that works, and it is safe with more than
 * one because a schedule is claimed with a lease before it runs. Set MISCITED_NO_SCHEDULER=1
 * to run the console without it.
 */
const scheduler = new Scheduler(
  db,
  {
    clock: systemClock,
    owner: `web-${process.pid}`,
    beliefsFor: (w) => (w === 'baseline' ? VANAR_BEFORE : VANAR_AFTER),
    fetcher,
    transports,
  },
  Number(process.env.MISCITED_TICK_MS ?? 60_000),
);
if (process.env.MISCITED_NO_SCHEDULER !== '1') scheduler.start();

// Weekly digests run on their own timer so a sampling failure never eats the digest.
if (process.env.MISCITED_NO_SCHEDULER !== '1') {
  const digestTimer = setInterval(() => {
    const now = new Date();
    if (now.getUTCDay() === 1 && now.getUTCHours() === 8) void runDigests(db, transports, systemClock);
  }, 3600_000);
  digestTimer.unref();
}

await app.listen({ port, host: '0.0.0.0' });
console.log(`Miscited listening on http://localhost:${port}`);
console.log(
  `scheduler ${process.env.MISCITED_NO_SCHEDULER === '1' ? 'off' : 'on'}, ` +
  `citation fetching ${fetcher ? 'on' : 'off'}, db ${dbPath}`,
);
