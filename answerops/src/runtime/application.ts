import { openDb } from '../db/index.js';
import { buildServer } from '../server.js';
import { ensureSeed } from '../seed.js';
import { Scheduler, runDigests } from '../services/scheduler.js';
import { defaultTransports } from '../services/delivery.js';
import { HttpFetcher, StubFetcher } from '../domain/fetcher.js';
import { systemClock } from '../domain/clock.js';
import { VANAR_AFTER, VANAR_BEFORE, DEMO_PAGES, DEMO_AUDIT_BELIEFS } from '../../seed/simulation.js';
import { BackgroundTasks } from './tasks.js';
import type { RuntimeConfig } from './config.js';

/** All process resources have one owner and a deterministic shutdown order. */
export async function createApplication(config: RuntimeConfig) {
  const db = openDb(config.dbPath);
  try {
    const seed = await ensureSeed(db);
    const fetcher =
      config.fetchMode === 'off'
        ? null
        : config.fetchMode === 'demo'
          ? new StubFetcher(DEMO_PAGES)
          : new HttpFetcher();
    const transports = defaultTransports();
    const beliefsFor = (window: string) =>
      window === 'audit' ? DEMO_AUDIT_BELIEFS : window === 'baseline' ? VANAR_BEFORE : VANAR_AFTER;
    const app = buildServer({
      db,
      fetcher,
      transports,
      beliefsFor,
      clock: systemClock,
      logger: config.logger,
      demoHint: seed ? `Demo workspace: ${seed.email} / ${seed.password}` : null,
    });
    const scheduler = new Scheduler(
      db,
      { clock: systemClock, owner: `web-${process.pid}`, beliefsFor, fetcher, transports },
      config.tickMs,
    );
    const tasks = new BackgroundTasks();
    let digestTimer: NodeJS.Timeout | undefined;
    if (config.scheduler) {
      scheduler.start();
      digestTimer = setInterval(() => {
        const now = new Date();
        if (now.getUTCDay() === 1 && now.getUTCHours() === 8) {
          void tasks
            .track(runDigests(db, transports, systemClock))
            .catch((error) => app.log.error({ err: error }, 'digest failed'));
        }
      }, 3_600_000);
      digestTimer.unref();
    }
    let closing: Promise<void> | undefined;
    return {
      app,
      db,
      scheduler,
      close(): Promise<void> {
        return (closing ??= (async () => {
          if (digestTimer) clearInterval(digestTimer);
          await scheduler.shutdown();
          await app.close();
          await tasks.drain();
          db.close();
        })());
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
