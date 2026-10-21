import { mergeRule } from '../records/sources'
import type { State } from '../core/state'
import { isAgency, requireAdmin, requireManages } from '../core/access'
import { Fault, requireThat, scope, type Actor, type Data } from '../core/types'

const absent = () => new Fault(404, 'Agency record not found')
export function agencyFor(s: State, a: Actor) {
  const agency = s.all('agency').find(x => x.email === scope(a))
  if (!isAgency(a) || a.agent || !agency?.active) throw absent()
  return s.get('agency', agency.id)
}
export const grantId = (agency: string, vacancy: string) => agency + ':' + vacancy
export function invited(s: State, agency: Data, vacancy: unknown) {
  const grant = typeof vacancy === 'string' ? s.find('agency-job', grantId(agency.id, vacancy)) : null
  return grant?.active ? grant : null
}
export function staffJob(s: State, a: Actor, id: unknown) {
  requireAdmin(a)
  const v = s.find('vacancy', id)
  if (!v) throw absent()
  requireManages(a, v)
  return v
}
export function staffSubmission(s: State, a: Actor, id: unknown) {
  const submission = s.find('agency-submission', id)
  if (!submission) throw absent()
  staffJob(s, a, submission.vacancy)
  return submission
}
export function ownSubmission(s: State, a: Actor, id: unknown) {
  const agency = agencyFor(s, a), submission = s.find('agency-submission', id)
  if (!submission || submission.agency !== agency.id || !invited(s, agency, submission.vacancy)) throw absent()
  return submission
}
export function agencyFile(s: State, a: Actor, id: string) {
  const submission = s.all('agency-submission').find(x => x.files.some((f: Data) => f.id === id))
  if (!submission) throw absent()
  const allowed = isAgency(a) ? ownSubmission(s, a, submission.id) : staffSubmission(s, a, submission.id)
  const file = allowed.files.find((f: Data) => f.id === id)
  // Acceptance can restrict an original later. Restricted metadata or bytes never re-enter the agency door.
  const document = s.find('document', id)
  requireThat(file && (!isAgency(a) || !document?.restricted), 'Agency record not found', 404)
  return file
}
export function creditedHire(s: State, submission: Data) {
  const app = s.find('application', submission.application), agency = s.find('agency', submission.agency)
  if (!app || !agency || app.status !== 'hired') return false
  const from = mergeRule(s) === 'first-touch' ? s.all('application').filter(x => x.candidate === app.candidate && x.status !== 'spam').sort((x, y) => x.submittedAt.localeCompare(y.submittedAt))[0] ?? app : app
  return from.credit?.kind === 'agency' && from.credit.who === agency.name
}
