import type { State } from '../core/state'
import { can, canSeeApplication, canSeeContact, managesVacancy, isAdmin, requireAdmin, requireApplication, requireCan, requireCandidate, requireManages } from '../core/access'
import { email, instant, integer, list, now, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { activeApplicationTransport } from '../communications/transport'
import { scopedMatches } from './matches'
import { apply } from '../records/candidates'
import { task } from '../records/tasks'
import { approvedNow, versionOf } from '../records/approvals'
import { businessDue } from '../reminders/timing'
import { nurtureAuthority, nurtureConsent, nurtureEligibility, nurtureInteractions } from './eligibility'

const human = (a: Actor) => requireThat(!a.agent && (isAdmin(a) || a.roles.includes('manager')), 'A human recruiter with current contact access manages CRM work', 403)
const contact = (s: State, a: Actor, id: unknown) => {
  const person = requireCandidate(s, a, id)
  requireThat(canSeeContact(s, a, person), 'Candidate not found', 404)
  return person
}
const visible = (s: State, a: Actor, r: Data) => {
  const p = s.find('candidate', r.candidate), app = s.find('application', r.sourceApplication), job = s.find('vacancy', r.targetVacancy)
  return !!p && !!app && !!job && canSeeContact(s, a, p) && canSeeApplication(s, a, app) && managesVacancy(a, job) && can(s, a, job, 'contact')
}
function poolRecord(s: State, a: Actor, id: unknown) {
  const pool = s.find('crm-pool', id)
  requireThat(pool && (pool.candidates ?? []).every((id: string) => { const p = s.find('candidate', id); return p && canSeeContact(s, a, p) }), 'Pool not found', 404)
  return pool
}
function selection(s: State, a: Actor, b: Data) {
  const pool = poolRecord(s, a, b.pool), person = contact(s, a, b.candidate)
  requireThat(pool.candidates.includes(person.id), 'Select a candidate in this pool', 409)
  requireThat(!nurtureConsent(s, person), nurtureConsent(s, person) ?? 'Current consent is required', 409)
  s.scan('candidate'); s.scan('application'); s.scan('document'); s.scan('resume-extraction')
  const match = scopedMatches(s, a, pool.query).find(m => m.candidate === person.id)
  requireThat(match, 'The candidate no longer matches this pool’s factual query', 409)
  const job = s.get('vacancy', b.vacancy)
  requireManages(a, job); requireCan(s, a, job, 'contact')
  return { pool, person, match, job }
}

export function crmPool(s: State, a: Actor, b: Data) {
  human(a)
  const current = b.id ? poolRecord(s, a, b.id) : null
  const query = text(b.query, 'Factual match query', 200), name = text(b.name, 'Pool name', 160), reason = text(b.reason, 'Human selection reason', 1000)
  s.scan('candidate'); s.scan('application'); s.scan('document'); s.scan('resume-extraction')
  const matches = scopedMatches(s, a, query), ids = [...new Set(list(b.candidates, 'Selected candidates', 500, v => text(v, 'Candidate id')))]
  requireThat(ids.length, 'Select at least one evidenced candidate')
  ids.forEach(id => {
    const person = contact(s, a, id), match = matches.find(m => m.candidate === id)
    requireThat(match && !nurtureConsent(s, person), 'Select only factual matches with current native talent pool consent', 409)
  })
  const record = s.put('crm-pool', current?.id ?? uid(), { name, query, candidates: ids, by: a.email, at: now() })
  for (const id of ids) s.audit(a, 'crm-pool-selected', 'candidate:' + id, { pool: record.id, reason })
  return record
}

export async function crmEnroll(s: State, a: Actor, b: Data) {
  human(a)
  const { pool, person, match, job } = selection(s, a, b), app = requireApplication(s, a, b.sourceApplication)
  requireThat(app.candidate === person.id, 'Choose this candidate’s source application')
  s.scan('approval')
  requireThat(!job.imported && job.status === 'open' && await approvedNow(s, 'vacancy', job), 'Choose a currently published approved native opening', 409)
  const owner = email(b.owner, 'Responsible owner'), language = text(b.language, 'Sequence language', 30)
  requireThat(nurtureAuthority(s, owner, job, app) && nurtureAuthority(s, a.email, job, app), 'Owner and reviewer need current source and target contact access', 409)
  requireThat(language === (app.language ?? 'en'), 'Use the recorded application language', 409)
  const enrollmentId = uid()
  const replyURL = new URL('/crm/reply/' + enrollmentId, text(b.origin, 'Configured installation origin', 2000)).href
  const optOutToken = uid().replaceAll('-', '') + uid().replaceAll('-', ''), optOutURL = new URL('/crm/opt-out/' + optOutToken, text(b.origin, 'Configured installation origin', 2000)).href
  const steps = list(b.steps, 'Exact sequence', 5, value => {
    const v = value as Data
    const subject = text(v?.subject, 'Exact subject', 200), body = text(v?.body, 'Exact message', 10000), footer = text(v?.footer, 'Employer identification and opt-out footer', 4000)
    requireThat(!/[\r\n]/.test(subject) && !/[{}]/.test(subject + body + footer), 'Use complete reviewed text with a single-line subject and no merge fields')
    return { subject, body, footer: footer + '\n' + optOutURL + '\n' + replyURL }
  })
  requireThat(steps.length, 'Prepare at least one exact message')
  const dueAt = instant(b.dueAt, 'First contact time'), cadenceHours = integer(b.cadenceHours, 'Minimum hours between contacts', 1, 720)
  requireThat(Date.parse(dueAt) > Date.now(), 'First contact time must be in the future')
  requireThat(!s.scan('crm-enrollment').some(r => r.candidate === person.id && ['active', 'draft'].includes(r.status)), 'Stop the current sequence before preparing another', 409)
  const replyAddress = email(b.replyAddress, 'Configured monitored CRM reply address'), transport = activeApplicationTransport(s)
  requireThat(!transport || transport.replyTo === replyAddress, 'The configured CRM reply address must match the reviewed monitored sender', 409)
  const followup = task(s, a, { candidate: person.id, owner, kind: 'follow-up', due: dueAt.slice(0, 10), note: 'Review nurture follow-up for ' + job.title })
  const record = s.put('crm-enrollment', enrollmentId, { pool: pool.id, candidate: person.id, sourceApplication: app.id, application: app.id, sourceVacancy: app.vacancy, vacancy: job.id, targetVacancy: job.id, targetVersion: await versionOf(s, 'vacancy', job), selection: match, owner, task: followup.id, language, steps, to: person.email, replyAddress, replyURL, optOutToken, optOutURL, senderFrom: transport?.from ?? null, dueAt, cadenceHours, startHour: 9, endHour: 17, weekdays: [1, 2, 3, 4, 5], step: 0, by: a.email, at: now(), reviewed: false, enabled: false, status: 'draft', transportEpoch: transport?.epoch ?? null })
  s.audit(a, 'crm-sequence-prepared', 'application:' + app.id, { enrollment: record.id, owner, task: followup.id, targetVacancy: job.id })
  return record
}

export async function crmEnable(s: State, a: Actor, b: Data) {
  human(a); requireAdmin(a)
  const current = s.find('crm-enrollment', b.id)
  requireThat(current && visible(s, a, current), 'Sequence not found', 404)
  requireThat(current.status === 'draft', 'Only the exact prepared draft may be enabled', 409)
  requireThat(b.reviewed === true && b.enabled === true, 'Review every exact message, sender and application language and explicitly enable this sequence')
  requireThat(Date.parse(current.dueAt) > Date.now(), 'Prepare a new future schedule; retrospective sequences cannot be enabled', 409)
  const transport = activeApplicationTransport(s)
  requireThat(transport, 'Review and enable the installation sender before activation', 409)
  requireThat(current.transportEpoch === transport.epoch, 'The installation sender changed after preparation; prepare the sequence again', 409)
  requireThat(!b.previewEpoch || b.previewEpoch === transport.epoch, 'The sender changed after preview; reload the complete sequence', 409)
  requireThat(email(b.replyAddress, 'Configured monitored CRM reply address') === current.replyAddress && transport.replyTo === current.replyAddress, 'Review the current monitored installation reply address', 409)
  const route = s.find('crm-reply-route', 'main')
  requireThat(route?.status === 'verified' && route.address === current.replyAddress && route.epoch === transport.epoch, 'Verify an email through the current native reply route before enabling nurture', 409)
  const r: Data = { ...current, by: a.email, at: now(), reviewed: true, enabled: true, transportEpoch: transport.epoch, status: 'active', nextDueAt: businessDue(s, current, Date.parse(current.dueAt)) }
  const eligible = await nurtureEligibility(s, r)
  requireThat(eligible.transport, eligible.reason, 409)
  const record = s.put('crm-enrollment', current.id, r)
  s.audit(a, 'crm-sequence-reviewed-enabled', 'application:' + r.application, { enrollment: record.id, language: r.language, transportEpoch: transport.epoch, owner: r.owner })
  return record
}

export async function crmApply(s: State, a: Actor, b: Data) {
  human(a); requireThat(b.confirmed === true, 'Explicitly confirm creating this application')
  const { pool, person, match, job } = selection(s, a, b)
  s.scan('approval')
  requireThat(!job.imported && job.status === 'open' && await approvedNow(s, 'vacancy', job), 'Choose a currently published approved native opening', 409)
  const application = apply(s, a, { candidate: person.id, vacancy: job.id, source: 'Talent pool', customValues: b.customValues ?? {} })
  s.audit(a, 'crm-application-selected', 'application:' + application.id, { pool: pool.id, candidate: person.id, evidence: match.evidence, reason: text(b.reason, 'Human application selection reason', 1000) })
  return application
}

export async function crmView(s: State, a: Actor, q?: unknown): Promise<Data> {
  human(a)
  const apps = s.all('application').filter(app => canSeeApplication(s, a, app)), allowed = new Set(apps.map(app => app.id))
  const candidates = s.all('candidate').filter(p => !p.deleted && !p.mergedInto && canSeeContact(s, a, p)).map((p): Data => {
    const reason = nurtureConsent(s, p)
    return { ...p, consentExpiry: p.retainUntil, eligibility: { eligible: !reason, reason: reason ?? 'Current native talent pool consent and email preference permit rediscovery' }, priorInteractions: nurtureInteractions(s, p.id, allowed, a), applications: apps.filter(app => app.candidate === p.id).map(app => ({ id: app.id, vacancy: app.vacancy, title: s.find('vacancy', app.vacancy)?.title, status: app.status, language: app.language ?? 'en' })) }
  })
  const visibleIds = new Set(candidates.map(p => p.id)), enrollments = []
  for (const r of s.all('crm-enrollment').filter(r => visible(s, a, r))) {
    const eligibility = await nurtureEligibility(s, r), person = s.get('candidate', r.candidate)
    enrollments.push({ ...r, candidateName: person.name, consentExpiry: person.retainUntil, eligibility: { eligible: !!eligibility.transport, reason: eligibility.reason }, priorInteractions: nurtureInteractions(s, person.id, allowed, a), outcomes: s.all('application-email').filter(m => m.enrollment === r.id) })
  }
  const pools = s.all('crm-pool').filter(p => p.by === a.email || (isAdmin(a) && p.candidates.every((id: string) => visibleIds.has(id)))).map((p): Data => {
    const candidates = p.candidates.filter((id: string) => visibleIds.has(id) && !nurtureConsent(s, s.get('candidate', id)))
    return { ...p, candidates, selections: scopedMatches(s, a, p.query).filter(m => candidates.includes(m.candidate)) }
  }).filter(p => p.candidates.length || p.by === a.email)
  const matches = typeof q === 'string' && q.trim().length >= 2 ? scopedMatches(s, a, q).filter(m => visibleIds.has(m.candidate) && !nurtureConsent(s, s.get('candidate', m.candidate))) : []
  const transport = activeApplicationTransport(s)
  return { pools, enrollments, candidates, matches, tasks: s.all('task').filter(t => visibleIds.has(t.candidate) && (!t.application || allowed.has(t.application))), jobs: s.all('vacancy').filter(j => !j.imported && managesVacancy(a, j) && can(s, a, j, 'contact')), members: s.all('member').filter(m => m.active && !m.agent), replyRoute: s.find('crm-reply-route', 'main'), transportReady: !!transport, transport: transport ? { from: transport.from, replyTo: transport.replyTo, epoch: transport.epoch } : null }
}
