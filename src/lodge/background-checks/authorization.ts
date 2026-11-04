import type { State } from '../core/state'
import { canSeeApplication, isAdmin, requireAdmin, requireApplication } from '../core/access'
import { canonical, now, oneOf, requireThat, sha256, text, type Actor, type Data } from '../core/types'
import { conditionalOffer, fairChancePlace } from '../records/fair-chance'

export const currentAuthorization = (r: Data): Data => r.versions.at(-1)
export const authorizationState = (r: Data, version: number) => r.history.filter((e: Data) => e.version === version).at(-1)?.action ?? 'unanswered'

/** Local evidence is never a provider permission, even after affirmative agreement. */
export function authorizationReader(s: State, a: Actor, app: Data) {
  return !a.agent && isAdmin(a) && canSeeApplication(s, a, app)
}

export async function requireAuthorizationSequence(s: State, app: Data) {
  const job = s.get('vacancy', app.vacancy)
  if (fairChancePlace(s, job)) {
    s.scan('offer')
    requireThat(await conditionalOffer(s, app.id), 'Record an approved conditional offer first for this fair-chance place', 409)
  }
}

export async function reviewAuthorization(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(!a.agent, 'Only a human owner or hiring admin may review background-check wording', 403)
  const app = requireApplication(s, a, b.application), candidate = s.get('candidate', app.candidate)
  requireThat(app.status === 'active' && !app.imported && !candidate.deleted && !candidate.mergedInto && s.get('vacancy', app.vacancy).status !== 'closed', 'Use an active native application', 409)
  requireThat(typeof candidate.email === 'string' && !!candidate.email, 'A native candidate email is required', 409)
  await requireAuthorizationSequence(s, app)
  const record = s.find('background-authorization', app.id), previous = record && currentAuthorization(record)
  requireThat(b.version === (previous?.version ?? 0), 'The wording changed; reload before reviewing', 409)
  requireThat(b.reviewed === true, 'Confirm employer review of this exact disclosure and authorization')
  const language = text(b.language, 'Reviewed application language', 35)
  requireThat(language === (app.language ?? 'en'), 'Review wording in the exact application language; no fallback is used', 409)
  const version = (previous?.version ?? 0) + 1
  const next = { version, disclosureVersion: version, authorizationVersion: version,
    disclosure: text(b.disclosure, 'Employer disclosure', 16000), authorization: text(b.authorization, 'Employer authorization', 16000),
    purpose: text(b.purpose, 'Purpose', 2000), checkScope: text(b.checkScope, 'Intended check scope', 2000), language,
    legalReview: text(b.legalReview, 'Employer legal review record', 4000), retentionReview: text(b.retentionReview, 'Retention review record', 4000),
    candidateIdentity: { candidate: candidate.id, email: candidate.email, name: candidate.name },
    reviewedBy: a.id, reviewedAt: now() }
  s.put('background-authorization', app.id, { application: app.id, candidate: app.candidate, versions: [...(record?.versions ?? []), next], history: record?.history ?? [], historical: false })
  s.audit(a, 'background-authorization-reviewed', 'application:' + app.id, { version })
  return { application: app.id, version }
}

/** The receipt relationship and native session have already been checked by the HTTP door. */
export async function respondAuthorization(s: State, a: Actor, app: Data, record: Data, b: Data) {
  const action = oneOf(b.action, ['agreed', 'refused', 'withdrawn'] as const, 'Your choice')
  const v = record.versions.find((v: Data) => v.version === b.version)
  requireThat(v, 'The wording changed; open the current request', 409)
  const candidate = s.get('candidate', app.candidate)
  const key = text(b.responseId, 'Response id', 80)
  requireThat(/^[a-zA-Z0-9-]{16,80}$/.test(key), 'Use the response id supplied by the form')
  const fingerprint = await sha256(canonical({ action, version: v.version, operator: a.id, candidate: candidate.id }))
  const previous = record.history.find((e: Data) => e.responseId === key)
  if (previous) {
    requireThat(previous.fingerprint === fingerprint, 'This response id already records a different choice', 409)
    return
  }
  const state = authorizationState(record, v.version)
  if (action === 'withdrawn') requireThat(state === 'agreed', 'Only recorded agreement can be withdrawn', 409)
  else {
    requireThat(!record.historical, 'Restored evidence is historical; a fresh employer review is required', 409)
    requireThat(v.version === currentAuthorization(record).version && app.status === 'active' && !app.imported && s.get('vacancy', app.vacancy).status !== 'closed', 'This request changed or closed; open the current request', 409)
    requireThat(v.language === (app.language ?? 'en'), 'Wording has not been reviewed in the current application language', 409)
    requireThat(v.candidateIdentity.candidate === candidate.id && v.candidateIdentity.email === candidate.email && v.candidateIdentity.name === candidate.name, 'Candidate identity changed; fresh employer review is required', 409)
    await requireAuthorizationSequence(s, app)
    requireThat(state === 'unanswered', 'This version already has a choice; fresh employer review is required', 409)
    if (action === 'agreed') requireThat(b.agreement === true, 'Affirmatively select agreement before continuing')
  }
  const event = { version: v.version, disclosureVersion: v.disclosureVersion, authorizationVersion: v.authorizationVersion,
    action, responseId: key, fingerprint, at: now(), identity: { candidate: candidate.id, operator: a.id, session: a.session, email: a.email, name: candidate.name } }
  s.put('background-authorization', record.id, { ...record, history: [...record.history, event] })
  s.audit(a, 'background-authorization-' + action, 'application:' + app.id, { version: v.version })
}

export function authorizationView(s: State, a: Actor) {
  if (a.agent || !isAdmin(a)) return null
  const applications = s.all('application').filter(app => authorizationReader(s, a, app))
  const ids = new Set(applications.map(app => app.id))
  return { editable: applications.filter(app => app.status === 'active' && !app.imported).map(app => app.id),
    records: s.all('background-authorization').filter(r => ids.has(r.application)).map(r => ({ ...r, state: authorizationState(r, currentAuthorization(r).version) })) }
}
