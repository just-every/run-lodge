import { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { actorFor, load, save, signedIn } from '../core/store'
import { Fault, requireThat, type Data } from '../core/types'
import { esc, formBody, page, sameOrigin } from '../http/public'
import { analysisScope } from '../analysis/scope'
import { CADENCE } from './calendar'
import { cancelReport, enableReport, openReport, ownedReports, reportAdmin, reportAttempts, reportPreview } from './schedules'

export const weeklyPages = new Hono<{ Bindings: Bindings }>()
const json = (path: string) => path.startsWith('/api/')
weeklyPages.use('*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('referrer-policy', 'same-origin') })
weeklyPages.onError((error, c) => {
  const fault = error instanceof Fault ? error : new Fault(503, 'Weekly reports are unavailable; no new delivery was enabled')
  return json(c.req.path) ? Response.json({ error: fault.message }, { status: fault.status }) : page('Weekly reports', `<h1>Weekly reports</h1><p role="alert">${esc(fault.message)}</p><a href="/reports/weekly">Weekly report settings</a>`, fault.status)
})
const hidden = (name: string, value: unknown) => `<input type="hidden" name="${name}" value="${esc(value)}">`
function document(jobs: { id: string; title: string }[], rows: Data[], draft?: Awaited<ReturnType<typeof reportPreview>>) {
  const preview = draft?.preview
  return page('Weekly source and funnel reports', `<h1>Weekly source and funnel reports</h1><p><a href="/analysis">Recruiting analysis</a> · <a href="/application-emails/settings">Installation sender settings</a></p><p>${esc(CADENCE)}</p><p>Sending starts off. A current human admin reviews exact native recipients and the authenticated installation sender. Each recipient gets a separately scoped aggregate. Private candidate evidence stays behind sign-in. Slack remains unavailable until its installation and destination are authorized.</p>
${draft ? `<section aria-label="Review weekly report"><h2>Review weekly report</h2><dl class="application-email-facts"><dt>Recipients</dt><dd>${esc(preview!.recipients.join(', '))}</dd><dt>Business time zone</dt><dd>${esc(preview!.zone)}</dd><dt>First due instant</dt><dd>${esc(preview!.dueAt)}</dd><dt>Sender</dt><dd>${esc(preview!.from)}</dd><dt>Monitored reply address</dt><dd>${esc(preview!.replyTo)}</dd></dl><p>Each sample is recomputed when due and when opened. It is not retained in the schedule.</p>${draft.samples.map(sample => `<h3>${esc(sample.recipient)}</h3><pre class="sign-doc">${esc(JSON.stringify(sample.report, null, 2))}</pre>`).join('')}<form method="post" action="/reports/weekly">${preview!.jobs.map((id: string) => hidden('jobs', id)).join('')}${preview!.recipients.map((email: string) => hidden('recipients', email)).join('')}${hidden('firstDate', preview!.firstDate)}${hidden('clock', preview!.clock)}${hidden('reviewKey', draft.reviewKey)}<label><input type="checkbox" name="reviewed" value="yes" required> I reviewed the recipients, exact cadence, metrics and sender</label><label><input type="checkbox" name="enabled" value="yes" required> Enable weekly email reports</label><button type="submit">Enable reviewed weekly report</button></form></section>` : ''}
<h2>Prepare a weekly report</h2><form method="post" action="/reports/weekly/preview"><fieldset><legend>Jobs</legend>${jobs.map(job => `<label><input type="checkbox" name="jobs" value="${esc(job.id)}"> ${esc(job.title)}</label>`).join('')}</fieldset><label>Native recipient email addresses, separated by commas<input name="recipientText" required maxlength="4096" value="${esc(preview?.recipients.join(', ') ?? '')}"></label><label>First delivery date<input type="date" name="firstDate" required value="${esc(preview?.firstDate ?? '')}"></label><label>Local delivery time<input type="time" name="clock" required value="${esc(preview?.clock ?? '09:00')}"></label><button type="submit">Preview weekly report</button></form>
<h2>Reviewed schedules and outcomes</h2><p>Provider acceptance does not prove delivery. Failed, withheld and uncertain recipients are suspended, including later periods, until a new schedule is reviewed. An uncertain occurrence is never automatically retried. Cancellation stops future requests but cannot recall a request already made.</p>${rows.length ? rows.map(row => `<section><h3>Weekly at ${esc(row.clock)} in ${esc(row.zone)}</h3><p>${esc(row.status)} · Next date: ${esc(row.nextDate)}</p><p>Recipients: ${esc(row.recipients.join(', '))}</p>${row.enabled ? `<form method="post" action="/reports/weekly/${esc(row.id)}/cancel"><button type="submit">Cancel weekly report</button></form>` : ''}<ul>${row.attempts.map((attempt: Data) => `<li>${esc(attempt.date)} · ${esc(attempt.recipient)} · ${esc(attempt.status === 'handed' ? 'Accepted by the provider; delivery unconfirmed' : attempt.status)}<p>${esc(attempt.reason)}</p></li>`).join('')}</ul></section>`).join('') : '<p>No weekly report is enabled.</p>'}`)
}
for (const prefix of ['/reports/weekly', '/api/lodge/reports/weekly']) {
  weeklyPages.get(prefix, async c => {
    const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
    reportAdmin(a)
    const rows = ownedReports(s, a).map(row => ({ ...row, attempts: reportAttempts(s, row) }))
    return json(c.req.path) ? Response.json({ schedules: rows }) : document((await analysisScope(s, a, c.env)).jobs, rows)
  })
  for (const previewing of [true, false]) weeklyPages.post(prefix + (previewing ? '/preview' : ''), async c => {
    await sameOrigin(c)
    const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
    reportAdmin(a)
    requireThat(Number(c.req.header('content-length') ?? 0) <= 16384, 'Report request is too large', 413)
    let body: Data
    if (json(c.req.path)) {
      try { body = await c.req.json() } catch { throw new Fault(400, 'Send a report object') }
    } else {
      const form = await formBody(c)
      body = { ...Object.fromEntries(form.entries()), jobs: form.getAll('jobs'), recipients: form.has('recipientText') ? String(form.get('recipientText')).split(',').map(x => x.trim().toLowerCase()).filter(Boolean) : form.getAll('recipients'), reviewed: form.get('reviewed') === 'yes', enabled: form.get('enabled') === 'yes' }
    }
    requireThat(body && typeof body === 'object' && !Array.isArray(body) && JSON.stringify(body).length <= 16384, 'Send a bounded report object')
    requireThat(Object.keys(body).every(key => ['jobs', 'recipients', 'firstDate', 'clock', 'channel', 'reviewKey', 'reviewed', 'enabled', 'recipientText'].includes(key)), 'Unknown report fields are refused')
    if (previewing) {
      const draft = await reportPreview(c.env, s, a, body)
      return json(c.req.path) ? Response.json(draft) : document((await analysisScope(s, a, c.env)).jobs, ownedReports(s, a).map(row => ({ ...row, attempts: reportAttempts(s, row) })), draft)
    }
    const schedule = await enableReport(c.env, s, a, body)
    await save(c.env.DB, s, a)
    return json(c.req.path) ? Response.json({ schedule }, { status: 201 }) : c.redirect('/reports/weekly', 303)
  })
  weeklyPages.post(prefix + '/:id/cancel', async c => {
    await sameOrigin(c)
    const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
    cancelReport(s, a, c.req.param('id')!)
    await save(c.env.DB, s, a)
    return json(c.req.path) ? Response.json({ canceled: true }) : c.redirect('/reports/weekly', 303)
  })
  weeklyPages.get(prefix + '/open/:id', async c => {
    const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
    const report = await openReport(c.env, s, a, c.req.param('id')!)
    return json(c.req.path) || c.req.query('download') === '1' ? Response.json(report, { headers: { 'cache-control': 'no-store', ...(c.req.query('download') === '1' ? { 'content-disposition': 'attachment; filename="weekly-report.json"' } : {}) } }) : page('Private weekly report', `<h1>Private weekly report</h1><p>Recomputed with current author and recipient access. Candidate evidence is excluded.</p><pre class="sign-doc">${esc(JSON.stringify(report, null, 2))}</pre><a href="?download=1">Download current report</a>`)
  })
}
