import { openDb } from './db/index.js';
import { buildServer } from './server.js';
import { VANAR_AFTER, VANAR_BEFORE } from '../seed/simulation.js';
import { ensureSeed } from './seed.js';

const port = Number(process.env.PORT ?? 4300);
const dbPath = process.env.ANSWEROPS_DB ?? 'data/answerops.sqlite';

const db = openDb(dbPath);
const seeded = await ensureSeed(db);

const app = buildServer({
  db,
  beliefsFor: (windowLabel) => (windowLabel === 'baseline' ? VANAR_BEFORE : VANAR_AFTER),
  demoHint: seeded ? `Demo workspace: ${seeded.email} / ${seeded.password}` : null,
  logger: process.env.LOG === '1',
});

await app.listen({ port, host: '0.0.0.0' });
console.log(`AnswerOps listening on http://localhost:${port}`);
