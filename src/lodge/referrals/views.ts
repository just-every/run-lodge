import type { State } from '../core/state'
import type { Bindings } from '../../auth.server'
import type { Actor, Data } from '../core/types'
import { mailReady } from '../esign/mail'
import { isAgency } from '../core/access'
import { jobForm } from '../records/questions'
import { creditedEmployee, employee, eligibleJobs, staffSeesReferral } from './access'

const fileView = (s: State, r: Data) => r.files.filter((f: Data) => !s.find('document', f.id)?.restricted).map((f: Data) => ({ id: f.id, name: f.name, mediaType: f.mediaType, bytes: f.size }))
/** Only frozen input and deliberately shared coarse progress, never canonical records. */
export function referralsView(s: State, a: Actor, env: Bindings) {
  const me = employee(s, a), listings = eligibleJobs(s), unique = listings.filter((l, i) => listings.findIndex(x => x.v.id === l.v.id) === i)
  const jobs = unique.map(l => ({ id: l.v.id, title: l.title, description: l.description, location: l.v.location, questions: jobForm(s, l.v, l.post) }))
  const enabled = s.find('referral-pref', me.email)?.enabled === true
  const alerts = enabled ? s.all('referral-job-alert').filter(x => x.to === me.email && jobs.some(j => j.id === x.vacancy)).map(x => ({ id: x.id, vacancy: x.vacancy, title: jobs.find(j => j.id === x.vacancy)!.title, at: x.at })) : []
  const submissions = s.all('referral').filter(r => r.employee === me.email).map(r => ({ id: r.id, vacancy: r.vacancy, name: r.name, email: r.email, phone: r.phone, consentNote: r.consentNote, submittedAt: r.submittedAt, status: r.progress ?? 'submitted', sharedAt: r.sharedAt ?? null, files: fileView(s, r), milestones: r.milestones.map((m: Data) => ({ id: m.id, label: m.label, amountCents: m.amountCents, status: m.status })) }))
  return { enabled, jobs, alerts, submissions, emailAvailable: mailReady(env) }
}
export function employerReferrals(s: State, a: Actor) {
  if (a.agent || isAgency(a)) return []
  return s.all('referral').filter(r => staffSeesReferral(s, a, r)).map(r => ({ ...r, files: fileView(s, r), creditedHire: creditedEmployee(s, r) === r.employee }))
}
