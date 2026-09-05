import Database from 'better-sqlite3';
import { trafficScorecard } from '../src/services/traffic.js';
const path =
  process.env.MISCITED_DB ??
  (process.env.RAILWAY_ENVIRONMENT ? '/data/miscited.sqlite' : 'data/miscited.sqlite');
const since = process.argv[2] ?? new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
const db = new Database(path, { readonly: true, fileMustExist: true });
try {
  console.log(JSON.stringify(trafficScorecard(db, since), null, 2));
} finally {
  db.close();
}
