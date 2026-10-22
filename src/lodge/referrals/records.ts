import type { State } from '../core/state'
import { canSeeContact, requireAdmin } from '../core/access'
import { money, now, oneOf, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'
import { candidateFields, retentionUntil, startApplication } from '../records/candidates'
import { storeOriginal } from '../records/documents'
import { ensureSource, sourceCredit } from '../records/sources'
import { answers } from '../records/questions'
import { evaluate } from '../records/rules'
import { creditedEmployee, employee, eligibleJobs, referralJob, referringMember, staffReferral } from './access'

export const REFERRAL_SOURCE = 'Employee referral'
export const REFERRAL_PROGRESS = ['received', 'in progress', 'closed', 'hired'] as const
export function referralAlerts(s: State, a: Actor, b: Data) {
  const me = employee(s, a)
  requireThat(typeof b.enabled === 'boolean', 'Choose whether to receive job alerts')
  const pref = s.put('referral-pref', me.email, { employee: me.email, enabled: b.enabled, at: now() })
  syncReferralAlerts(s, true)
  s.audit(a, 'referral-alert-preference', 'member:' + me.email, { enabled: b.enabled })
  return pref
}
/**
 * Called after writes that can publish a job. Each employee/job is raised once, only after explicit opt-in. A job that
 * is newly eligible also queues its email (CRM-010); the jobs already open when the employee opts in (`existing`) are
 * listed in the portal but not mailed.
 */
export function syncReferralAlerts(s: State, existing = false) {
  const jobs = eligibleJobs(s)
  for (const pref of s.scan('referral-pref').filter(p => p.enabled)) {
    if (!referringMember(s.find('member', pref.employee))) continue
    for (const { v } of jobs) {
      const id = pref.employee + ':' + v.id
      if (s.find('referral-job-alert', id)) continue
      s.put('referral-job-alert', id, { to: pref.employee, vacancy: v.id, at: now() })
      if (!existing) s.put('referral-email', 'job:' + id, { kind: 'job', to: pref.employee, vacancy: v.id, emailState: 'queued', at: now() })
    }
  }
}
export async function referralSubmit(s: State, a: Actor, b: Data) {
  const me = employee(s, a), { vacancy, listing } = referralJob(s, b.vacancy)
  requireThat(b.confirmed === true, 'Confirm the candidate permitted this referral and resume sharing')
  requireThat(b.resume, 'A resume is required')
  const fields = candidateFields(b)
  requireThat(fields.email, 'Candidate email is required')
  const answered = answers(s, vacancy, b.answers ?? {}, listing.post)
  const files = [await storeOriginal(s, b.resume)]
  for (const answer of answered) if (answer.type === 'file') {
    const file = await storeOriginal(s, answer.value as any)
    files.push(file); answer.value = { document: file.id, name: file.name }
  }
  const row = s.put('referral', uid(), { employee: me.email, vacancy: vacancy.id, post: listing.post?.id ?? null, ...fields, consentNote: text(b.consentNote, 'Candidate permission statement', 1000), confirmed: true, retainUntil: retentionUntil(s), submittedAt: now(), files, answers: answered, outcome: 'Under review', progress: null, milestones: [], decisions: [] })
  s.audit(a, 'referral-submitted', 'referral:' + row.id)
  return { id: row.id, status: 'submitted' }
}
export function referralReview(s: State, a: Actor, b: Data) {
  const r = staffReferral(s, a, b.id), v = s.get('vacancy', r.vacancy)
  requireThat(r.outcome === 'Under review', 'This referral already has an ownership decision', 409)
  const reason = text(b.reason, 'Reconciliation reason', 1000), outcome = oneOf(b.outcome, ['accepted', 'duplicate', 'declined'] as const, 'Referral decision')
  let candidate: Data | null = null, app: Data | null = null
  if (outcome !== 'declined') {
    if (b.candidate) {
      candidate = s.find('candidate', b.candidate) ?? null
      requireThat(candidate && !candidate.deleted && !candidate.mergedInto && canSeeContact(s, a, candidate), 'Candidate not found', 404)
    } else {
      requireThat(outcome === 'accepted', 'Select the existing candidate for duplicate reconciliation')
      candidate = s.put('candidate', uid(), { ...candidateFields(r), source: REFERRAL_SOURCE, consent: { basis: 'referral', talentPool: false, recordedBy: r.employee, at: r.submittedAt, note: r.consentNote }, retainUntil: retentionUntil(s), createdAt: now() })
    }
    app = s.scan('application').find(x => x.candidate === candidate!.id && x.vacancy === v.id && x.status === 'active') ?? null
    if (!app) {
      ensureSource(s, REFERRAL_SOURCE, 'referral')
      app = startApplication(s, a, candidate, v, REFERRAL_SOURCE, { referral: r.id, answers: r.answers, ...(r.post ? { post: r.post } : {}), customValues: b.customValues ?? {}, credit: { kind: 'employee', who: r.employee, by: a.email, at: now(), automatic: true } })
      for (const f of r.files) s.put('document', f.id, { ...f, candidate: candidate.id, application: app.id, kind: f.id === r.files[0].id ? 'resume' : 'other', restricted: false, source: REFERRAL_SOURCE })
      evaluate(s, app, 'Employee referral')
    }
    // Existing applications keep their own source, answers and credit. A person may explicitly change credit.
    if (b.creditEmployee === true) app = sourceCredit(s, a, { application: app.id, kind: 'employee', who: r.employee, reason: text(b.creditReason, 'Credit change reason', 1000) })
  }
  const decision = { outcome, reason, by: a.email, at: now() }
  const row = s.put('referral', r.id, { ...r, outcome, recruiterOwner: a.email, candidate: candidate?.id ?? null, application: app?.id ?? null, decisions: [...r.decisions, decision] })
  s.audit(a, 'referral-reconciled', 'referral:' + r.id, { outcome, application: app?.id ?? null, reason })
  return row
}
export function referralProgress(s: State, a: Actor, b: Data) {
  const r = staffReferral(s, a, b.id), progress = oneOf(b.progress, REFERRAL_PROGRESS, 'Employee-visible progress')
  const app = r.application ? s.get('application', r.application) : null
  requireThat(progress !== 'hired' || app?.status === 'hired', 'Share hired only after the application records a hire', 409)
  requireThat(progress !== 'closed' || r.outcome === 'declined' || (!!app && app.status !== 'active'), 'Share closed only after the application is closed or the referral is declined', 409)
  requireThat(progress !== 'in progress' || app?.status === 'active', 'Reconcile this referral to an active application before sharing in progress', 409)
  const row = s.put('referral', r.id, { ...r, progress, sharedAt: now(), sharedBy: a.email })
  if (s.find('referral-pref', r.employee)?.enabled === true) s.put('referral-email', `progress:${r.id}:${row.sharedAt}`, { kind: 'progress', to: r.employee, vacancy: r.vacancy, referral: r.id, emailState: 'queued', at: now() })
  s.audit(a, 'referral-progress-shared', 'referral:' + r.id, { progress })
  return row
}
export function referralBonus(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const r = staffReferral(s, a, b.id)
  requireThat(creditedEmployee(s, r) === r.employee, 'A bonus milestone requires a hire currently credited to this employee', 409)
  requireThat(b.approved === true, 'Confirm the employer approved this bonus milestone')
  const milestone = { id: uid(), label: text(b.label, 'Approved bonus milestone', 200), amountCents: money(b.amountCents, 'Approved USD bonus (cents)'), status: oneOf(b.status, ['approved', 'due', 'paid'] as const, 'Employer-recorded bonus state'), approved: true, employee: r.employee, by: scope(a), at: now() }
  const row = s.put('referral', r.id, { ...r, milestones: [...r.milestones, milestone] })
  s.audit(a, 'referral-bonus-recorded', 'referral:' + r.id, { milestone: milestone.id, amountCents: milestone.amountCents, status: milestone.status })
  return row
}
