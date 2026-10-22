import type { State } from '../core/state'
import { canSeeApplication, canSeeContact, isAgency, managesVacancy } from '../core/access'
import { Fault, scope, type Actor, type Data } from '../core/types'
import { listings } from '../records/posts'
import { mergeRule } from '../records/sources'

const absent = () => new Fault(404, 'Referral not found')
/** An active human member of the employer (not an agent or an agency) may use the referral portal. */
export const referringMember = (me: Data | undefined) => !!me?.active && !me.agent && !me.roles?.includes('agency') && (!!me.owner || !!me.roles?.length)
export function employee(s: State, a: Actor) {
  const me = s.find('member', scope(a))
  if (a.agent || isAgency(a) || !me || !referringMember(me)) throw absent()
  return me
}
export function eligibleJobs(s: State) {
  s.scan('vacancy')
  return [...listings(s, 'careers'), ...listings(s, 'embed'), ...listings(s, 'api')].filter((x, i, all) => !x.v.confidential && !x.v.internalOnly && all.findIndex(y => y.id === x.id) === i).sort((a, b) => (a.post?.language === 'es' ? 1 : 0) - (b.post?.language === 'es' ? 1 : 0))
}
export function referralJob(s: State, id: unknown) {
  const listing = eligibleJobs(s).find(x => x.v.id === id)
  if (!listing) throw absent()
  return { vacancy: s.get('vacancy', listing.v.id), listing }
}
export function staffSeesReferral(s: State, a: Actor, r: Data) {
  if (a.agent || isAgency(a)) return false
  const v = s.find('vacancy', r.vacancy), app = r.application && s.find('application', r.application)
  const candidate = r.candidate && s.find('candidate', r.candidate)
  return !!v && managesVacancy(a, v) && (!r.application || !!app && canSeeApplication(s, a, app)) && (!candidate || candidate.mergedInto || canSeeContact(s, a, candidate))
}
export function staffReferral(s: State, a: Actor, id: unknown) {
  const r = s.find('referral', id)
  if (!r || !staffSeesReferral(s, a, r)) throw absent()
  return r
}
export function ownReferral(s: State, a: Actor, id: unknown) {
  const me = employee(s, a), r = s.find('referral', id)
  if (!r || r.employee !== me.email) throw absent()
  return r
}
export function referralFile(s: State, a: Actor, id: string) {
  const row = s.all('referral').find(r => r.files.some((f: Data) => f.id === id))
  if (!row) throw absent()
  if (!staffSeesReferral(s, a, row)) ownReferral(s, a, row.id)
  const file = row.files.find((f: Data) => f.id === id)
  if (!file || s.find('document', id)?.restricted) throw absent()
  return file
}
/** Resolve through the application after a candidate merge; never trust a stale candidate link. */
export function creditedEmployee(s: State, r: Data) {
  const app = s.find('application', r.application)
  if (!app || app.status !== 'hired') return null
  const from = mergeRule(s) === 'first-touch' ? s.scan('application').filter(x => x.candidate === app.candidate && x.status !== 'spam').sort((x, y) => x.submittedAt.localeCompare(y.submittedAt))[0] ?? app : app
  return from.credit?.kind === 'employee' ? from.credit.who : null
}
