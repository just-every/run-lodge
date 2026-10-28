import { contactDigest } from './capture'
import type { State } from '../core/state'
import { can, canSeeContact, cleared, isAdmin, managesVacancy, teamOf } from '../core/access'
import { Fault, canonical, now, oneOf, requireThat, scope, text, type Actor, type Data } from '../core/types'
import { candidate, candidateFields, CONSENT_BASES, startApplication } from './candidates'
import { ensureSource } from './sources'

const SOURCE = 'Sourced: extension'
const digits = (v: string) => v.replace(/\D/g, '')
const normalized = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')
const human = (a: Actor) => requireThat(!a.agent, 'Only an authorized human recruiting member can review a prospect', 403)

function jobAllowed(s: State, a: Actor, v: Data) {
  return !v.imported && v.status === 'open' && cleared(a, v, 'confidential') &&
    ((managesVacancy(a, v) && can(s, a, v, 'contact')) || teamOf(v, 'sourcers').includes(scope(a)))
}

export function captureDestinations(s: State, a: Actor) {
  if (a.agent) return { jobs: [], poolAllowed: false }
  return { jobs: s.all('vacancy').filter(v => jobAllowed(s, a, v)).map(v => ({ id: v.id, title: v.title })), poolAllowed: isAdmin(a) }
}

function fields(b: Data) {
  const captureId = text(b.captureId, 'Capture identifier', 36).toLowerCase()
  requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId), 'Start a new extension capture')
  const sourceURL = text(b.sourceURL, 'Source page URL', 2000)
  let url: URL
  try { url = new URL(sourceURL) } catch { throw new Fault(400, 'Invalid source page URL') }
  requireThat((url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) && !url.username && !url.password, 'Use an ordinary secure web page')
  requireThat(!/(^|\.)linkedin\.com$/i.test(url.hostname) && !['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com'].includes(url.hostname), 'LinkedIn and inbox capture are not supported by this extension')
  url.search = ''; url.hash = ''
  return { ...candidateFields(b), captureId, sourceURL: url.href, vacancy: typeof b.vacancy === 'string' && b.vacancy !== 'pool' ? b.vacancy : '', consentBasis: oneOf(b.consentBasis, CONSENT_BASES, 'Basis for keeping their details'), consentNote: text(b.consentNote, 'Consent basis evidence', 1000), talentPool: b.talentPool === true }
}

async function review(s: State, a: Actor, b: Data) {
  human(a)
  const input = fields(b)
  requireThat(!s.find('prospect-capture-spent', input.captureId), 'This capture was already confirmed; start a new capture for another person', 409)
  const job = input.vacancy ? s.get('vacancy', input.vacancy) : null
  if (job) requireThat(jobAllowed(s, a, job), 'Choose a job you are currently authorized to source', 403)
  else requireThat(isAdmin(a) && input.talentPool, 'Only an owner or hiring admin may add to the native talent pool, with recorded contact consent', 403)
  if (input.email && s.find('capture-custody', 'main')) requireThat(!s.find('capture-erased', await contactDigest(s, input.email)), 'This capture cannot be added; consult the authorized privacy administrator', 409)
  s.scan('application')
  const duplicates = s.scan('candidate').filter(c => !c.deleted && !c.mergedInto && canSeeContact(s, a, c)).flatMap(c => {
    const reasons = []
    if (input.email && input.email === c.email) reasons.push('Same email')
    if (digits(input.phone).length >= 7 && digits(input.phone) === digits(c.phone ?? '')) reasons.push('Same phone')
    if (normalized(input.name) === normalized(c.name)) reasons.push('Same name')
    return reasons.length ? [{ id: c.id, name: c.name, reasons, revision: s.revisionOf('candidate', c.id) }] : []
  }).sort((x, y) => x.id.localeCompare(y.id))
  return { input, job, duplicates }
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
function signedData(s: State, a: Actor, r: Awaited<ReturnType<typeof review>>, expires: number) {
  return new TextEncoder().encode(canonical({ input: r.input, duplicates: r.duplicates, jobRevision: r.job ? s.revisionOf('vacancy', r.job.id) : null, session: a.session, member: a.memberships, roles: a.roles, expires }))
}

/** A POST-only, authenticated preview; cancellation leaves no staged personal copy. */
export async function previewProspect(s: State, a: Actor, b: Data, secret: string) {
  const r = await review(s, a, b), expires = Date.now() + 15 * 60 * 1000
  const token = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), signedData(s, a, r, expires))), n => n.toString(16).padStart(2, '0')).join('')
  return { fields: r.input, duplicates: r.duplicates.map(({ revision, ...d }) => d), expires, token }
}

/** The signed preview binds exact fields, visible duplicates, saved authority and session. */
export async function confirmProspect(s: State, a: Actor, b: Data, secret: string) {
  const r = await review(s, a, b)
  requireThat(b.confirmed === true, 'Explicitly confirm the reviewed prospect', 409)
  requireThat(typeof b.expires === 'number' && b.expires > Date.now() && b.expires <= Date.now() + 15 * 60 * 1000 && typeof b.token === 'string' && /^[0-9a-f]{64}$/.test(b.token), 'Review this capture again', 409)
  const bytes = Uint8Array.from(b.token.match(/../g)!, (v: string) => parseInt(v, 16))
  requireThat(await crypto.subtle.verify('HMAC', await signingKey(secret), bytes, signedData(s, a, r, b.expires)), 'Details, duplicates or authority changed; review this capture again', 409)
  const decisions = Array.isArray(b.decisions) ? b.decisions : []
  requireThat(decisions.length === r.duplicates.length && new Set(decisions.map((d: Data) => d.id)).size === decisions.length && r.duplicates.every(d => decisions.some((choice: Data) => choice.id === d.id && ['existing', 'distinct'].includes(choice.decision))), 'Decide every visible duplicate before confirming', 409)
  const existing = decisions.filter((d: Data) => d.decision === 'existing')
  requireThat(existing.length <= 1, 'Choose at most one existing person; captures never merge people', 409)
  const { input, job } = r
  let result: Data
  if (existing.length) {
    const person = s.get('candidate', existing[0].id)
    requireThat(canSeeContact(s, a, person), 'Candidate not found', 404)
    // The match confers no new access, overwrites no details and never changes pool consent.
    requireThat(job || person.consent?.talentPool, 'The existing person needs their own current talent pool consent', 409)
    const application = job ? startApplication(s, a, person, job, SOURCE, { credit: { kind: 'sourcer', who: scope(a), by: a.email, at: now(), automatic: true }, sourceURL: input.sourceURL }) : null
    result = { candidate: person, application }
  } else {
    result = await candidate(s, a, { ...input, source: SOURCE })
    if (result.application) result.application = s.put('application', result.application.id, { ...result.application, credit: { kind: 'sourcer', who: scope(a), by: a.email, at: now(), automatic: true }, sourceURL: input.sourceURL })
  }
  ensureSource(s, SOURCE, 'sourced')
  const provenance = { sourceURL: input.sourceURL, by: a.email, at: now(), consentBasis: input.consentBasis, consentNote: input.consentNote, existing: !!existing.length, duplicateDecisions: decisions }
  const person = s.get('candidate', result.candidate.id)
  s.put('candidate', person.id, { ...person, prospectCaptures: [...(person.prospectCaptures ?? []), provenance] })
  // This random, unlinked marker survives person erasure; it contains no personal fields.
  s.put('prospect-capture-spent', input.captureId, { spent: true })
  s.audit(a, 'prospect-capture-confirmed', 'candidate:' + person.id, { application: result.application?.id ?? null })
  return { candidate: person.id, application: result.application?.id ?? null, source: SOURCE }
}
