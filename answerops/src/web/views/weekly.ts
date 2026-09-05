import { html, raw, type Raw } from '../html.js';
import type { Row } from '../../db/repo/index.js';
import type { WeeklyQuestion } from '../../services/weekly.js';
const when = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
    new Date(value),
  ) + ' UTC';
export function weeklyView(v: {
  schedule: Row | undefined;
  questions: WeeklyQuestion[];
  jobs: Row[];
  messages: Row[];
  emailReady: boolean;
  email: string;
}): Raw {
  const s = v.schedule;
  return html`<div class="weekly-page"><h1>Your weekly answer check</h1><p class="lede">Every Monday: see the questions, let us check them, then review what needs attention.</p>
 <section class="panel"><h2>Plan → check → report</h2><p>Monday at <strong>06:00 UTC</strong>, your question plan appears here. One hour later, we ask the selected live providers automatically. You can edit or skip during that hour. No weekly approval required.</p><p>Up to 10 questions, five answer samples per question. Questions stay the same unless you edit them. Review your <a href="/truth">recorded facts</a> before relying on comparisons.</p><p>${v.emailReady ? 'Email delivery is configured. Opt in below to receive the plan and report.' : 'Email delivery is not configured yet. Plans and results are available here; email cannot be sent until the operator connects a verified sender.'}</p></section>
 ${
   s
     ? html`<section class="panel"><h2>Next check</h2><p data-testid="weekly-next">${s.enabled ? 'Active' : 'Paused'} · Next plan or check: ${when(s.next_run_at)}</p><p>Maximum ${s.budget_runs} answer samples per round; $${s.monthly_budget_usd} monthly model-spend budget, estimated before each round. This is not a subscription price. Budget limits or provider failures may reduce coverage.</p>
 <form method="post" action="/schedules/${s.id}/toggle"><button>${s.enabled ? 'Pause monitoring' : 'Resume monitoring'}</button></form>
 <form method="post" action="/weekly/${s.id}/skip"><button>Skip this week</button></form>
 <form method="post" action="/weekly/${s.id}/settings" class="stack"><label for="weekly-questions"><strong>Questions to ask</strong> · one per line, up to 10</label><textarea id="weekly-questions" name="questions" rows="12" maxlength="3010" required data-testid="weekly-questions">${v.questions.map((q) => q.prompt).join('\n')}</textarea><p>Saving updates a pending plan too. Once a check starts, changes apply next week. The original plan email is a snapshot; this page always has the latest questions.</p><label><input type="checkbox" name="email_enabled" value="yes" ${s.weekly_email ? raw('checked') : raw('')}> Send the plan and report to my account email (${v.email})</label><button class="primary" data-testid="weekly-save">Save weekly settings</button></form></section>`
     : html`<form method="post" action="/weekly/enable"><button class="primary" data-testid="weekly-enable">Enable weekly monitoring</button></form><p>Existing daily schedules are separate. Review <a href="/schedules">Schedules</a> to pause any you no longer need.</p>`
 }
 <section><h2>Plans and briefings</h2>${
   v.jobs.length
     ? v.jobs.map((j) => {
         const r = JSON.parse(j.result);
         const questions = JSON.parse(j.questions) as WeeklyQuestion[];
         return html`<article class="panel" data-testid="weekly-job"><h3>${j.week} · ${j.status}${j.status === 'complete' && !r.complete ? ' (incomplete coverage)' : ''}</h3><p>Planned start: ${when(j.execute_at)}</p><details><summary>${questions.length} planned questions</summary><ol>${questions.map((q) => html`<li>${q.prompt}</li>`)}</ol></details>${r.error ? html`<p class="hint">${r.error}</p>` : null}${r.samples !== undefined ? html`<p><strong>${r.samples}/${r.planned ?? 0} live answers completed.</strong> ${(r.issues ?? []).length} potential issue groups. ${(r.registryGaps ?? []).length} registry gaps need review.</p><p>${r.comparison}</p>${(r.issues ?? []).map((x: any) => html`<section><h4>${x.change}: ${x.headline}</h4><p>Answer: ${x.answer}</p><p>Recorded fact: ${x.fact ?? 'Needs review'}</p><p>${x.measurement}</p><p>${x.next}</p><a href="${x.link}">Inspect evidence</a></section>`)}${r.notObserved?.length ? html`<p>Not observed again: ${r.notObserved.join('; ')}. This does not prove a correction worked.</p>` : null}<p>${r.note}</p>${r.gaps?.length ? html`<details><summary>Missing coverage</summary><ul>${r.gaps.map((g: any) => html`<li>${g.provider}: ${g.reason}</li>`)}</ul></details>` : null}` : null}</article>`;
       })
     : html`<p>No Monday plan yet. Your first plan appears at the scheduled time.</p>`
 }</section>
 <section><h2>Email delivery status</h2>${v.messages.length ? html`<ul>${v.messages.map((m) => html`<li>${m.kind}: ${m.status} · ${m.attempts} attempts${m.error ? ' · ' + m.error : ''}${m.status === 'failed' ? html`<form method="post" action="/weekly/messages/${m.id}/retry"><button>Retry email delivery</button></form>` : null}</li>`)}</ul>` : html`<p>No emails queued. Email is optional; every briefing remains in the app.</p>`}</section></div>`;
}
