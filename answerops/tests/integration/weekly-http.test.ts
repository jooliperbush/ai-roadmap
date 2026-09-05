import { it, expect } from 'vitest';
import { makeHarness, postForm, get, login } from './helpers.js';
import * as sched from '../../src/db/repo/unattended.js';
it('weekly edits are tenant-scoped, owner-only, CSRF-protected and validated', async () => {
  const h = await makeHarness();
  try {
    await postForm(h.app, '/weekly/enable', h.cookie, {});
    const s = sched.listSchedules(h.db, h.info.tenantId).find((s) => s.weekly_briefing === 1)!;
    expect(s).toBeTruthy();
    const settings = '/weekly/' + s.id + '/settings';
    const other = await postForm(h.app, settings, h.otherCookie, { questions: 'Do not change this?' });
    expect(other.statusCode).not.toBe(200);
    expect(sched.getSchedule(h.db, h.info.tenantId, s.id)?.weekly_questions).toBe(s.weekly_questions);
    const viewer = await login(h.app, 'analyst@vanar.example', 'miscited-viewer');
    expect((await postForm(h.app, settings, viewer, { questions: 'Blocked?' })).statusCode).toBe(403);
    const noCsrf = await h.app.inject({
      method: 'POST',
      url: settings,
      headers: { cookie: h.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'questions=Blocked',
    });
    expect(noCsrf.statusCode).toBe(403);
    await postForm(h.app, settings, h.cookie, { questions: Array(11).fill('Too many?').join('\n') });
    expect(sched.getSchedule(h.db, h.info.tenantId, s.id)?.weekly_questions).toBe(s.weekly_questions);
    await postForm(h.app, settings, h.cookie, { questions: 'What does Vanar cost?', email_enabled: 'yes' });
    expect(sched.getSchedule(h.db, h.info.tenantId, s.id)?.weekly_email).toBe('ops@vanar.example');
    expect((await get(h.app, '/weekly', h.cookie)).body).toContain('What does Vanar cost?');
  } finally {
    await h.app.close();
    h.db.close();
  }
});
