import type { State } from '../core/state'
import { isAdmin, managesVacancy } from '../core/access'
import type { Actor, Data } from '../core/types'
import { listings } from '../records/posts'
import { agencyFor, creditedHire, invited } from './access'

const fileView = (s: State, files: Data[]) => files.filter(f => !s.find('document', f.id)?.restricted).map(f => ({ id: f.id, name: f.name, mediaType: f.mediaType, bytes: f.size }))
const feesView = (sub: Data) => sub.fees.map((f: Data) => ({ id: f.id, label: f.label, amountCents: f.amountCents, status: f.status }))
/** Whitelist, never a spread of the canonical person, application, or employer records. */
export function portal(s: State, a: Actor) {
  const agency = agencyFor(s, a)
  const jobs = listings(s, 'api').filter(x => !x.v.confidential && invited(s, agency, x.v.id)).map(x => ({ id: x.v.id, title: x.title, location: x.v.location, description: x.description, compensation: x.v.compensation, feeTerms: invited(s, agency, x.v.id)!.feeTerms }))
  const submissions = s.all('agency-submission').filter(x => x.agency === agency.id).flatMap((sub): Data[] => {
    if (!invited(s, agency, sub.vacancy)) return creditedHire(s, sub) ? [{ id: sub.id, feesOnly: true, fees: feesView(sub) }] : []
    return [{ id: sub.id, vacancy: sub.vacancy, submittedAt: sub.submittedAt, name: sub.name, email: sub.email, phone: sub.phone, summary: sub.summary, consentNote: sub.consentNote, outcome: sub.outcome, progress: sub.progress, feedback: sub.feedback, interviews: sub.interviews, files: fileView(s, sub.files), fees: creditedHire(s, sub) ? feesView(sub) : [] }]
  })
  return { actor: { email: a.email, name: a.name, owner: false, roles: ['agency'], agent: false }, agencyPortal: { name: agency.name, timeZone: s.find('business', 'main')?.timeZone ?? 'UTC', jobs, submissions } }
}
export function employerAgencies(s: State, a: Actor) {
  if (!isAdmin(a) || a.agent) return []
  const jobs = s.all('vacancy').filter(v => managesVacancy(a, v)).map(v => v.id)
  return s.all('agency').map(agency => ({ ...agency, jobs: s.all('agency-job').filter(j => j.agency === agency.id && jobs.includes(j.vacancy)), submissions: s.all('agency-submission').filter(sub => sub.agency === agency.id && jobs.includes(sub.vacancy)).map(sub => ({ ...sub, files: fileView(s, sub.files) })) }))
}
