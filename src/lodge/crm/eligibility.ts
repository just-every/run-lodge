import type { State } from '../core/state'
import { can, canSeeApplication, canSeeContact, isAdmin, managesVacancy } from '../core/access'
import { canonical, Fault, type Actor, type Data } from '../core/types'
import { memberActor } from '../notify/describe'
import { activeApplicationTransport } from '../communications/transport'
import { captureRead, contactDigest } from '../records/capture'
import { approvedNow, versionOf } from '../records/approvals'

/** Import metadata is history; only a recorded native choice can permit nurture. */
export function nurtureConsent(s: State, person: Data, at = Date.now()): string | null {
  if (person.deleted || person.mergedInto) return 'Candidate record is closed'
  if (person.consent?.talentPool !== true) return 'Current talent pool consent is required'
  if (!person.retainUntil || person.retainUntil < new Date(at).toISOString().slice(0, 10)) return 'Talent pool consent has expired'
  if (!person.email || (person.contactPreference && person.contactPreference.preference !== 'email')) return 'Current contact preference does not permit email'
  const nativeChoice = s.scan('audit').some(r => r.record === 'candidate:' + person.id && ((r.action === 'candidate-preferences-changed' && r.talentPool === true) || (r.action === 'candidate-corrected' && r.talentPool === true)))
  if ((person.imported || person.consent.basis === 'imported' || person.consent.recordedBy === 'import') && !nativeChoice) return 'Imported history needs a recorded native talent pool consent choice'
  if (!nativeChoice && (!person.consent.at || !person.consent.recordedBy)) return 'Recorded native talent pool consent is required'
  return null
}

export function nurtureAuthority(s: State, address: string, job: Data, app: Data, admin = false) {
  const who = memberActor(s, s.find('member', address)), source = s.find('vacancy', app.vacancy), person = s.find('candidate', app.candidate)
  return who && (!admin || isAdmin(who)) && source && person && managesVacancy(who, job) && can(s, who, job, 'contact') && (!admin || can(s, who, job, 'settings')) && can(s, who, source, 'contact') && canSeeApplication(s, who, app) && canSeeContact(s, who, person) ? who : null
}

export function nurtureInteractions(s: State, candidate: string, allowed?: Set<string>, actor?: Actor) {
  const apps = new Set(s.scan('application').filter(a => a.candidate === candidate && (!allowed || allowed.has(a.id))).map(a => a.id))
  const captures = s.scan('capture-mail').filter(m => m.candidate === candidate).filter(m => {
    if (!actor) return false
    try { captureRead(s, actor, m.id); return true } catch (error) { if (error instanceof Fault && error.status === 404) return false; throw error }
  })
  return [
    ...s.scan('application-email').filter(m => apps.has(m.application)).map(m => ({ kind: 'application-email', ...m })),
    ...s.scan('message').filter(m => apps.has(m.application)).map(m => ({ kind: 'message', ...m })),
    ...s.scan('imported-message').filter(m => apps.has(m.application)).map(m => ({ kind: 'imported-message', ...m })),
    ...captures.map(m => ({ kind: 'capture-mail', id: m.id, subject: m.subject, body: m.body, receivedAt: m.receivedAt })),
    ...s.scan('crm-reply').filter(m => m.candidate === candidate && apps.has(m.application)).map(m => ({ kind: 'crm-reply', ...m })),
  ]
}

/** Current permission and candidate interactions are fenced before every provider claim. */
export async function nurtureEligibility(s: State, r: Data, at = Date.now()): Promise<Data> {
  const stop = (reason: string, status = 'stopped') => ({ status, reason })
  if (!['draft', 'active', 'completed'].includes(r.status)) return stop(r.reason ?? 'Sequence has stopped')
  const app = s.find('application', r.sourceApplication), person = s.find('candidate', r.candidate), job = s.find('vacancy', r.targetVacancy)
  if (!app || app.candidate !== r.candidate || !person || !job || !s.find('vacancy', app.vacancy)) return stop('Source history or target opening is no longer available')
  const reason = nurtureConsent(s, person, at)
  if (reason) return stop(reason)
  if (!r.reviewed || !r.enabled || r.language !== (app.language ?? 'en') || r.to !== person.email) return stop('Exact language, recipient or reviewed sequence changed')
  if (!nurtureAuthority(s, r.by, job, app, true) || !nurtureAuthority(s, r.owner, job, app)) return stop('Current reviewer or owner contact access was revoked')
  s.scan('approval')
  if (job.imported || job.status !== 'open' || !(await approvedNow(s, 'vacancy', job)) || (r.targetVersion && r.targetVersion !== await versionOf(s, 'vacancy', job))) return stop('Target opening is no longer published with the reviewed approved terms')
  const apps = s.scan('application').filter(a => a.candidate === person.id), ids = new Set(apps.map(a => a.id))
  if (apps.some(a => a.status === 'hired') || s.scan('offer').some(o => ids.has(o.application) && o.status === 'accepted')) return stop('An offer was accepted or a hire was recorded')
  if (apps.some(a => (a.candidateWithdrawnAt && a.candidateWithdrawnAt >= r.at) || (a.status === 'withdrawn' && a.closedAt >= r.at))) return stop('Candidate withdrew after enrollment')
  if (apps.some(a => (a.candidateAccount?.requests ?? []).some((q: Data) => q.answeredAt >= r.at))) return stop('Candidate replied after enrollment')
  const digest = await contactDigest(s, person.email)
  if (s.find('capture-erased', digest) || s.find('application-email-suppression', digest)) return stop('Candidate contact is suppressed', 'suppressed')
  if (s.scan('capture-mail').some(m => (m.candidate === person.id || (m.contactDigests ?? []).includes(digest)) && (m.receivedAt >= r.at || m.resolvedAt >= r.at))) return stop('A candidate interaction was received after enrollment')
  if (s.scan('crm-reply').some(m => m.candidate === person.id && m.receivedAt >= r.at)) return stop('Candidate replied after enrollment')
  if (s.scan('message').some(m => ids.has(m.application) && (m.downloads ?? []).some((d: Data) => d.at >= r.at))) return stop('Human outreach continued after enrollment')
  const transport = activeApplicationTransport(s)
  if (!transport || transport.epoch !== r.transportEpoch || !nurtureAuthority(s, transport.by, job, app, true)) return stop('Installation sending is off or requires fresh human review', 'withheld')
  const route = s.find('crm-reply-route', 'main')
  if (route?.status !== 'verified' || route.epoch !== transport.epoch || route.address !== r.replyAddress) return stop('Native reply routing requires verification', 'withheld')
  return { transport, app, person, job, reason: 'Current talent pool consent, email preference, exact language and human review permit outreach' }
}

export const nurtureMessage = (r: Data, step: Data) => ({ to: r.to, subject: step.subject, text: step.body + '\n\n' + step.footer, missing: [] })
export const sameNurtureMessage = (r: Data, step: Data, content: Data) => canonical(nurtureMessage(r, step)) === canonical(content)
