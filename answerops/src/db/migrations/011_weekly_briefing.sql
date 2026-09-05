ALTER TABLE schedules ADD COLUMN weekly_briefing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN weekly_questions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE schedules ADD COLUMN weekly_email TEXT NOT NULL DEFAULT '';
CREATE TABLE weekly_jobs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 schedule_id TEXT NOT NULL REFERENCES schedules(id), brand_id TEXT NOT NULL REFERENCES brands(id),
 week TEXT NOT NULL, window_label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned',
 questions TEXT NOT NULL, providers TEXT NOT NULL, execute_at TEXT NOT NULL,
 created_at TEXT NOT NULL, finished_at TEXT, result TEXT NOT NULL DEFAULT '{}',
 UNIQUE(schedule_id,week)
);
CREATE TABLE weekly_messages (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 job_id TEXT NOT NULL REFERENCES weekly_jobs(id), kind TEXT NOT NULL,
 target TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', lease_until TEXT,
 UNIQUE(job_id,kind)
);

CREATE UNIQUE INDEX schedules_one_weekly_briefing ON schedules(tenant_id,brand_id) WHERE weekly_briefing=1;
