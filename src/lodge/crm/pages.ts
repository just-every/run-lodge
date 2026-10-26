import { checkReplyRoute } from './route-check'
import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { isAdmin, requireAdmin } from '../core/access'
import type { State } from '../core/state'
import { actorFor, load, save, signedIn } from '../core/store'
import { businessZone, instantOf, times, toWall } from '../core/time'
import { Fault, requireThat, type Actor, type Data } from '../core/types'
import { esc, formBody, page, sameOrigin } from '../http/public'
import { crmApply, crmEnable, crmEnroll, crmPool, crmView } from './records'
import { optOutExists, publicOptOut, stopEnrollment } from './inbound'

type C = Context<{ Bindings: Bindings }>
const path = '/crm', title = 'Talent pools and follow-up'
const hidden = (name: string, value: unknown) => `<input type="hidden" name="${name}" value="${esc(value)}">`
const input = (label: string, name: string, value: unknown, type = 'text', attrs = 'required') => `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`
const area = (label: string, name: string, value: unknown, required = true) => `<label>${esc(label)}<textarea name="${name}" rows="5"${required ? ' required' : ''}>${esc(value)}</textarea></label>`
const select = (label: string, name: string, rows: Data[], value: unknown, labelOf: (r: Data) => string) => `<label>${esc(label)}<select name="${name}" aria-label="${esc(label)}" required><option value="">Choose ${esc(label.toLowerCase())}</option>${rows.map(r => `<option value="${esc(r.id)}"${r.id === value ? ' selected' : ''}>${esc(labelOf(r))}</option>`).join('')}</select></label>`
const facts = (rows: [string, unknown][]) => `<dl class="application-email-facts">${rows.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value ?? 'Not recorded')}</dd>`).join('')}</dl>`
const link = (values: Record<string, string>) => path + '?' + new URLSearchParams(values)
const statuses: Record<string, string> = { draft: 'Draft · sending off', queued: 'Enabled', active: 'Enabled', pending: 'Pending', sending: 'Handoff in progress', handed: 'Accepted by provider', delivered: 'Delivered', uncertain: 'Uncertain · human reconciliation required', failed: 'Failed', bounced: 'Bounced', stopped: 'Stopped', canceled: 'Canceled', completed: 'Completed', suppressed: 'Suppressed', withheld: 'Withheld' }
const statusOf = (value: unknown) => statuses[String(value)] ?? String(value ?? 'Not recorded')

export const crmPages = new Hono<{ Bindings: Bindings }>()
crmPages.use('*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('referrer-policy', 'same-origin') })
crmPages.onError(error => page(title, `<h1>${title}</h1><p role="alert">${esc(error instanceof Fault ? error.message : 'Please try again later.')}</p><p><a href="${path}">Talent pools</a> · <a href="/app">Back to workspace</a></p>`, error instanceof Fault ? error.status : 500))
async function staff(c: C) {
  const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
  requireThat(!a.agent && (isAdmin(a) || a.roles.includes('manager')), 'A human recruiter manages talent pools', 403)
  return { s, a }
}

function history(rows: Data[], when: (v?: string) => string) {
  const stamp = (r: Data) => r.receivedAt || r.finishedAt || r.at || r.createdAt || ''
  return rows.length ? [...rows].sort((a, b) => stamp(b).localeCompare(stamp(a))).map(r => `<article><h4>${esc(r.subject || r.kind || 'Prior interaction')}</h4>${facts([['Outcome', statusOf(r.status)], ['Reason', r.reason || 'None'], ...(r.providerMessageId ? [['Provider reference', r.providerMessageId] as [string, unknown]] : [])])}<p>Recorded: ${when(stamp(r))}${r.dueAt ? `<br>Due: ${when(r.dueAt)}` : ''}${r.claimedAt ? `<br>Claimed: ${when(r.claimedAt)}` : ''}${r.finishedAt ? `<br>Finished: ${when(r.finishedAt)}` : ''}</p>${r.body || r.text || r.content ? `<div class="sign-doc">${esc(r.body || r.text || (typeof r.content === 'string' ? r.content : r.content.text || r.content.body))}</div>` : ''}${r.note ? `<p>${esc(r.note)}</p>` : ''}</article>`).join('') : '<p>No prior interactions recorded.</p>'
}
function evidence(row?: Data) {
  return row ? `${facts([['Matched fields', (row.matchedFields ?? []).join(', ')]])}${Object.entries(row.evidence ?? {}).map(([field, value]) => `<p>${esc(field)}</p><div class="sign-doc">${esc(value)}</div>`).join('')}` : '<p>No matching evidence recorded for this selection.</p>'
}
function poolForm(v: Data, q: string, d: Data) {
  return `<details class="disclosure"${!v.pools.length || d.action === 'pool' ? ' open' : ''}><summary>Create a talent pool</summary><form method="post" action="${path}">${hidden('action', 'pool')}${hidden('query', q)}${input('Pool name', 'name', d.name)}${input('Selection reason', 'reason', d.reason)}<fieldset><legend>Select factual matches</legend>${v.matches.length ? v.matches.map((m: Data) => `<label><input type="checkbox" name="candidates" value="${esc(m.candidate)}"${(d.candidates ?? []).includes(m.candidate) ? ' checked' : ''}> ${esc(m.name)}</label><details><summary>Matching evidence for ${esc(m.name)}</summary>${evidence(m)}${facts([['Consent basis', m.permission?.basis], ['Consent expiry', m.permission?.retainUntil]])}</details>`).join('') : '<p>Search recorded skills, experience or location to find permitted candidates.</p>'}</fieldset><button>Create selected pool</button></form></details>`
}
function candidateForms(v: Data, a: Actor, pool: Data, candidate: Data, d: Data, zone: string) {
  const base = hidden('pool', pool.id) + hidden('candidate', candidate.id), applications = candidate.applications ?? []
  return `<details class="disclosure"${d.action === 'enroll' ? ' open' : ''}><summary>Prepare a nurture sequence for ${esc(candidate.name)}</summary><form action="${path}" method="post">${base}${hidden('action', 'enroll')}
${select('Source application', 'sourceApplication', applications, d.sourceApplication, r => `${r.title || v.jobs.find((j: Data) => j.id === r.vacancy)?.title || r.vacancy} · ${r.status} · ${r.language || 'Language not recorded'}`)}
${select('Target vacancy', 'vacancy', v.jobs, d.vacancy, r => r.title)}${select('Responsible owner', 'owner', v.members.map((m: Data) => ({ ...m, id: m.email })), d.owner ?? a.email, r => mName(r))}
${input(`First due time · ${zone}`, 'dueAt', d.dueAt, 'datetime-local')}${input('Hours between steps', 'cadenceHours', d.cadenceHours, 'number', 'required min="1" step="1"')}${input('Source application language code', 'language', d.language)}
<p>Write the complete personalized text in the recorded source application language. Fill every value; placeholders are not accepted. The saved draft opens an exact preview before you enable sending.</p>
${[0, 1, 2].map(i => `<details${i === 0 ? ' open' : ''}><summary>Message ${i + 1}${i ? ' · optional' : ''}</summary>${input(`Message ${i + 1} subject`, `subject${i}`, d.steps?.[i]?.subject, 'text', i ? '' : 'required')}${area(`Message ${i + 1} body`, `body${i}`, d.steps?.[i]?.body, !i)}${area(`Message ${i + 1} footer in this language`, `footer${i}`, d.steps?.[i]?.footer, !i)}</details>`).join('')}<button>Prepare exact sequence preview</button></form></details>
<details class="disclosure"${d.action === 'apply' ? ' open' : ''}><summary>Create an application for ${esc(candidate.name)}</summary><form action="${path}" method="post">${base}${hidden('action', 'apply')}${select('Target vacancy', 'vacancy', v.jobs, d.vacancy, r => r.title)}${input('Application reason', 'reason', d.reason)}<label><input type="checkbox" name="confirmed" value="yes" required> I explicitly approve creating this candidate’s application with source Talent pool.</label><button>Create approved application</button></form></details>`
}
const mName = (m: Data) => m.name ? `${m.name} · ${m.email}` : m.email

function enrollmentCard(r: Data, v: Data, a: Actor, when: (v?: string) => string, open: boolean) {
  const task = v.tasks.find((t: Data) => t.id === r.task)
  return `<details class="disclosure"${open ? ' open' : ''}><summary>${esc(r.candidateName)} · ${esc(statusOf(r.status))}</summary><p><a href="/app?candidate=${encodeURIComponent(r.candidate)}">Open candidate</a></p>
${facts([['Target vacancy', v.jobs.find((j: Data) => j.id === r.targetVacancy)?.title ?? r.targetVacancy ?? r.vacancy], ['Current eligibility', r.eligibility?.eligible ? 'Eligible' : r.eligibility?.reason || 'Not eligible'], ['Consent expiry', r.consentExpiry], ['Responsible owner', task?.owner ?? r.owner], ['Task status', task?.status ?? 'Not recorded'], ['Task due date', task?.due], ['Stop reason', r.stopReason || r.reason || 'None']])}<p>Next due: ${when(r.nextDueAt || r.dueAt)}${task ? `<br><a href="/app?task=${encodeURIComponent(task.id)}">Open follow-up task</a>` : ''}</p>
<details><summary>Why this candidate was selected</summary>${evidence(v.pools.find((p: Data) => p.id === r.pool)?.selections?.find((m: Data) => m.candidate === r.candidate))}</details>
<section aria-label="Exact sequence preview"><h3>Exact sequence preview</h3>${facts([['To', r.to], ['Sender', r.senderFrom || 'Sender review required'], ['Reply to', r.replyAddress], ['Recorded language', r.language], ['Hours between steps', r.cadenceHours]])}${(r.steps ?? []).map((step: Data, i: number) => `<h4>Message ${i + 1}</h4><p>Subject</p><div class="sign-doc">${esc(step.subject)}</div><p>Body</p><div class="sign-doc">${esc(step.body)}</div><p>Footer</p><div class="sign-doc">${esc(step.footer)}</div>`).join('')}</section>
${r.status === 'draft' && isAdmin(a) ? `<form action="${path}" method="post">${hidden('action', 'enable')}${hidden('id', r.id)}${hidden('previewEpoch', v.transport?.epoch)}<label><input type="checkbox" name="reviewed" value="yes" required> I, ${esc(a.name)}, reviewed this exact sequence, language, sender and reply-to.</label><label><input type="checkbox" name="enabled" value="yes" required> Enable this reviewed sequence</label><button>Enable reviewed sequence</button></form>` : ''}
<details><summary>Prior interactions and replies</summary>${history(r.priorInteractions ?? [], when)}</details><details><summary>Recorded sending outcomes</summary><p>Accepted by provider records handoff. Delivered requires a separate delivery confirmation.</p>${history(r.outcomes ?? [], when)}</details>
${!['stopped', 'completed', 'canceled'].includes(r.status) ? `<details><summary>Stop this sequence</summary><form action="${path}" method="post">${hidden('action', 'stop')}${hidden('id', r.id)}${input('Stop reason', 'reason', '')}<button>Stop sequence</button></form></details>` : ''}</details>`
}

async function screen(c: C, s: State, a: Actor, d: Data = {}, error?: string, status = 200) {
  const q = String(d.query ?? c.req.query('q') ?? ''), v = await crmView(s, a, q || undefined), zone = businessZone(s.find('business', 'main'))
  const when = (value?: string) => value ? esc(times(zone).stamped(value)) : 'Not recorded'
  const pool = v.pools.find((p: Data) => p.id === (d.pool ?? c.req.query('pool'))), candidate = v.candidates.find((p: Data) => p.id === (d.candidate ?? c.req.query('candidate')) && pool?.candidates.includes(p.id))
  return page(title, `<h1>${title}</h1><details class="disclosure"><summary>Verify native reply routing</summary><p>Sending needs a verification email received by this installation at the exact monitored reply address. This check contacts no candidate.</p><form method="post" action="/crm/reply-route/check"><button>Send route verification email</button></form><p>Route: ${esc(v.replyRoute?.status ?? "Not verified")}</p></details><p><a href="/app">Back to workspace</a> · <a href="/application-emails/settings">Email sender settings</a></p>${error ? `<p role="alert">${esc(error)}</p>` : c.req.query('saved') ? '<p role="status">Saved</p>' : ''}
<details class="disclosure"><summary>How candidate follow-up works</summary><p>Factual matches are suggestions for human selection. Creating a pool or sequence never advances a candidate. Sending starts off and needs your review of the saved exact preview. Replies, opt-out, withdrawal, expired consent and an accepted offer stop stale outreach. Imported history needs current nurture consent.</p><p>Email transport: ${v.transportReady ? 'Ready for provider handoff' : 'Unavailable'}. Sender and monitored reply settings need review before sending.</p></details>
<details class="disclosure"${q || !v.pools.length ? ' open' : ''}><summary>Find factual matches${q ? ` · ${esc(q)}` : ''}</summary><form action="${path}" method="get">${input('Search recorded candidate facts', 'q', q, 'search', 'required minlength="2" maxlength="200"')}<button>Find factual matches</button></form>${q ? `<p>${v.matches.length} permitted factual matches. Choose candidates explicitly below.</p>` : ''}</details>${poolForm(v, q, d)}
<h2>Talent pools</h2>${v.pools.length ? v.pools.map((p: Data) => `<p><a href="${esc(link({ pool: p.id }))}">${esc(p.name)}</a><br><span class="meta">${p.candidates.length} selected · ${esc(p.query)}</span></p>`).join('') : '<p>No talent pools yet.</p>'}
${pool ? `<h2>${esc(pool.name)}</h2><form action="${path}" method="get">${hidden('pool', pool.id)}${select('Candidate', 'candidate', v.candidates.filter((p: Data) => pool.candidates.includes(p.id)), candidate?.id, r => r.name)}<button>Review selected candidate</button></form>` : ''}
${pool && candidate ? `<h3>${esc(candidate.name)}</h3><p><a href="/app?candidate=${encodeURIComponent(candidate.id)}">Open candidate</a></p>${facts([['Current eligibility', candidate.eligibility?.eligible ? 'Eligible for nurture' : candidate.eligibility?.reason || 'Not eligible'], ['Consent expiry', candidate.consentExpiry], ['Consent basis', candidate.consent?.basis]])}<details><summary>Factual selection evidence</summary>${evidence(pool.selections?.find((m: Data) => m.candidate === candidate.id))}</details><details><summary>Prior interactions</summary>${history(candidate.priorInteractions ?? [], when)}</details>${candidateForms(v, a, pool, candidate, d, zone)}` : ''}
<h2>Sequences and owned follow-up tasks</h2>${v.enrollments.length ? v.enrollments.map((r: Data) => enrollmentCard(r, v, a, when, r.id === (d.id || c.req.query('enrollment')))).join('') : '<p>No sequences prepared.</p>'}`, status)
}

crmPages.get(path, async c => { const { s, a } = await staff(c); return screen(c, s, a) })
crmPages.post(path, async c => {
  await sameOrigin(c)
  const { s, a } = await staff(c), form = await formBody(c)
  const value = (key: string) => { const v = form.get(key); return typeof v === 'string' ? v : '' }
  const d: Data = Object.fromEntries(['action', 'pool', 'candidate', 'sourceApplication', 'vacancy', 'owner', 'dueAt', 'cadenceHours', 'language', 'name', 'query', 'reason', 'id', 'previewEpoch'].map(key => [key, value(key)]))
  d.candidates = form.getAll('candidates').filter((id): id is string => typeof id === 'string')
  d.steps = [0, 1, 2].map(i => ({ subject: value(`subject${i}`), body: value(`body${i}`), footer: value(`footer${i}`) }))
  let destination = path + '?saved=1'
  try {
    if (d.action === 'pool') { const pool = await crmPool(s, a, d); destination = link({ pool: pool.id, saved: '1' }) }
    else if (d.action === 'enroll') {
      requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.dueAt), 'Enter the first due date and time in the business time zone')
      const zone = businessZone(s.find('business', 'main')), dueAt = instantOf(d.dueAt, zone)
      requireThat(new Date(toWall(Date.parse(dueAt), zone)).toISOString().slice(0, 16) === d.dueAt, 'Choose a valid local date and time')
      const r = await crmEnroll(s, a, { ...d, dueAt, cadenceHours: Number(d.cadenceHours), steps: d.steps.filter((step: Data) => step.subject || step.body || step.footer), reviewed: false, enabled: false, replyAddress: c.env.CRM_REPLY_ADDRESS ?? s.find('application-email-transport', 'main')?.replyTo, origin: c.env.AUTH_ORIGIN })
      destination = link({ enrollment: r.id, saved: '1' })
    } else if (d.action === 'enable') {
      requireThat(form.get('reviewed') === 'yes' && form.get('enabled') === 'yes', 'Review the exact preview and explicitly enable this sequence')
      await crmEnable(s, a, { id: d.id, reviewed: true, enabled: true, previewEpoch: d.previewEpoch, replyAddress: c.env.CRM_REPLY_ADDRESS ?? s.find('application-email-transport', 'main')?.replyTo }); destination = link({ enrollment: d.id, saved: '1' })
    } else if (d.action === 'apply') {
      requireThat(form.get('confirmed') === 'yes', 'Explicitly approve creating this application')
      await crmApply(s, a, { ...d, confirmed: true, source: 'Talent pool' }); destination = link({ pool: d.pool, candidate: d.candidate, saved: '1' })
    } else { requireThat(d.action === 'stop', 'Choose a talent pool action'); await stopEnrollment(s, a, { id: d.id, reason: d.reason }); destination = link({ enrollment: d.id, saved: '1' }) }
    await save(c.env.DB, s, a)
  } catch (error) { if (!(error instanceof Fault)) throw error; return screen(c, s, a, d, error.message, error.status) }
  return c.redirect(destination, 303)
})

crmPages.get('/crm/opt-out/:token', async c => {
  const s = await load(c.env.DB), token = c.req.param('token')
  requireThat(optOutExists(s, token), 'This preference link is unavailable', 404)
  return page('Candidate email preferences', `<h1>Candidate email preferences</h1><p>Stop emails about future openings from this employer.</p><form action="${esc('/crm/opt-out/' + encodeURIComponent(token))}" method="post"><label><input type="checkbox" name="confirm" value="yes" required> Stop future-opening emails</label><button>Stop future-opening emails</button></form>`)
})
crmPages.post('/crm/opt-out/:token', async c => {
  await sameOrigin(c)
  const form = await formBody(c), s = await load(c.env.DB)
  requireThat(form.get('confirm') === 'yes', 'Confirm your preference to stop future-opening emails')
  await publicOptOut(s, c.req.param('token'))
  await save(c.env.DB, s, null)
  return page('Email preference recorded', '<h1>Email preference recorded</h1><p>Future-opening emails have been stopped. Your preference has been recorded.</p>')
})

crmPages.post('/crm/reply-route/check', async c => { await sameOrigin(c); const { a } = await staff(c); await checkReplyRoute(c.env, a); return c.redirect('/crm?route=checking', 303) })
