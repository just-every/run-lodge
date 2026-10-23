import type { State } from '../core/state'
import { requireAdmin } from '../core/access'
import { email, integer, list, now, oneOf, optionalText, requireThat, sha256, text, uid, type Actor, type Data } from '../core/types'
import { names } from './fair-chance'
import { approvedOffices } from './posts'
import { businessToday } from './tasks'

// PRIV-001: the California (CPRA) applicant notice and applicants' own privacy
// requests. A job is in California when its location, its offices or the post's
// offices name California or CA (HIRE-007's place rule); its application form
// shows the CPRA notice beside the general one and records both versions.
// Lodge drafts the notice from what it collects, but the sale, sharing and
// sensitive-use statement is the business's own (it may share data outside
// Lodge), so the owner adopts the notice, confirming that statement, before a
// California job publishes or any California door takes someone's details.
//
// Until CAND-001 gives applicants accounts, /privacy-requests takes access,
// deletion and correction requests. Identity is verified by an application
// receipt code plus the email on that record; an unverified request is kept as
// "identity not verified" and releases nothing. Each request is acknowledged on
// its own page at once (CPRA allows 10 business days), says how it will be
// processed and which identity check was used, and is due 45 calendar days
// after it was received in the business's time zone, extendable once by up to
// 45 more days with a reason the requester sees. Lodge sends no email until
// COM-001 connects a mailbox.

export const SALE_STATEMENT = 'We do not sell or share your personal information, and we do not use or disclose sensitive personal information for purposes beyond those the CPRA permits.'
export const VERIFICATION = 'receipt code and email on record'
export const PUBLIC_TYPES = ['access', 'deletion', 'correction'] as const
export const REQUESTS_PER_HOUR = 10
export const DUE_DAYS = 45

/** What Lodge itself collects, as version 1 of every business's CPRA notice until the owner edits it. */
function defaultCategories(s: State): Data[] {
  const days = s.find('business', 'main')?.retentionDays ?? 365
  const kept = `Kept ${days} days after it is received, unless a legal hold applies.`
  return [
    { category: 'Identifiers', collected: 'Name, email, phone and where you are based.', purposes: 'Evaluating your application and contacting you about it.', retention: kept },
    { category: 'Professional or employment information', collected: 'Your resume, cover note and answers to the employer’s questions.', purposes: 'Evaluating your application against the job’s requirements.', retention: kept },
    { category: 'Sensitive personal information', collected: 'Adjustments you ask for and your voluntary answer about your gender, kept apart from your application.', purposes: 'Providing adjustments and equal-opportunity monitoring only; never used to assess you.', retention: kept },
  ]
}

/** The adopted CPRA notice now in force, or null until the owner adopts one. */
export const cpraNotice = (s: State): Data | null => s.find('cpra-notice', 'main')?.versions.at(-1) ?? null

/** What the owner edits: the notice in force, or Lodge's draft from what it collects until one is adopted. */
export const cpraDraft = (s: State): Data => cpraNotice(s) ?? { version: 0, draft: true, intro: '', categories: defaultCategories(s), saleStatement: SALE_STATEMENT }

export const ADOPT_FIRST = 'Adopt your California privacy notice first (Retention and requests › California applicant notice)'

/** The notice a California door shows; refused until the owner has adopted one. */
export function requireCpraNotice(s: State) {
  const notice = cpraNotice(s)
  requireThat(notice, ADOPT_FIRST, 409)
  return notice
}

/** The owner adopts or edits the CPRA notice, confirming the sale and sharing statement; each change is a new version and applications keep the one they were shown. */
export function saveCpraNotice(s: State, a: Actor, b: Data) {
  requireThat(a.owner, 'Only the owner can change the California privacy notice', 403)
  requireThat(b.confirmStatement === true, `Confirm that this is true of your business: “${SALE_STATEMENT}”`)
  const latest = cpraNotice(s)
  const categories = list(b.categories, 'Categories', 20, (x: any, i) => ({
    category: text(x?.category, `Category ${i + 1}`, 120), collected: text(x?.collected, `What is collected (${i + 1})`, 1000),
    purposes: text(x?.purposes, `Purposes (${i + 1})`, 1000), retention: text(x?.retention, `How long it is kept (${i + 1})`, 500),
  }))
  requireThat(categories.length > 0, 'Name at least one category of personal information')
  const intro = optionalText(b.intro, 'Introduction', 4000)
  if (latest && JSON.stringify([latest.intro, latest.categories]) === JSON.stringify([intro, categories])) return latest
  const versions: Data[] = s.find('cpra-notice', 'main')?.versions ?? []
  const next = { version: versions.length + 1, intro, categories, saleStatement: SALE_STATEMENT, statementConfirmedBy: a.email, at: now(), by: a.email }
  s.put('cpra-notice', 'main', { versions: [...versions, next] })
  s.audit(a, 'cpra-notice-saved', 'cpra-notice:main', { version: next.version })
  return next
}

/** Whether a job (or the post it is applied through) is in California. */
export function inCalifornia(s: State, v: Data, post: Data | null = null) {
  const offices = [...approvedOffices(v), ...(post?.locations ?? [])].map(id => s.find('office', id)?.name).filter(Boolean)
  return names('California', [v.location, ...offices].filter(Boolean).join('; '))
}

const addDays = (day: string, days: number) => new Date(Date.parse(day + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10)

/**
 * The primary record of a receipt's applicant, when the email given is the one on it.
 * A repeat board submission's receipt was handed to whoever sent that email again, so
 * it verifies the earlier application only for a requester signed in as that email.
 */
function verify(s: State, code: string, address: string, signedIn: boolean) {
  const receipt = code ? s.find('receipt', code.toUpperCase()) : undefined
  const app = receipt && (!receipt.repeat || signedIn) ? s.find('application', receipt.application) : undefined
  let person = app ? s.find('candidate', app.candidate) : undefined
  for (let hops = 0; person?.mergedInto && hops < 20; hops++) person = s.find('candidate', person.mergedInto)
  return person && !person.deleted && !person.mergedInto && person.email?.toLowerCase() === address ? person : null
}

const hash = (token: string) => sha256('privacy-request\u0000' + token)

/** A request from the public page, or from a candidate signed in as the email given. Returns the record and the one-time token of its status page. */
export async function submitPrivacyRequest(s: State, b: Data, signedIn = false) {
  const type = oneOf(b.type, PUBLIC_TYPES, 'Request')
  const name = text(b.name, 'Full name', 160), address = email(b.email, 'Email')
  const details = type === 'correction' ? text(b.details, 'What should be corrected', 4000) : optionalText(b.details, 'Details', 4000)
  const code = optionalText(b.receipt, 'Application receipt', 40)
  const person = verify(s, code, address, signedIn)
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, '0')).join('')
  const receivedAt = businessToday(s), at = now()
  const record = s.put('data-request', uid(), {
    candidate: person?.id ?? null, candidateName: person?.name ?? null, requester: { name, email: address }, type, receivedAt, channel: 'Privacy request page', note: details,
    status: person ? 'open' : 'unverified', identity: { method: VERIFICATION, verified: !!person, receipt: code || null }, californiaRequest: true,
    acknowledgedAt: at, dueOn: addDays(receivedAt, DUE_DAYS), tokenHash: await hash(token), code: 'PRQ-' + uid().slice(0, 8).toUpperCase(), submittedAt: at,
  })
  s.audit(null, 'privacy-request-received', 'data-request:' + record.id, { type, verified: !!person })
  return { record, token }
}

export async function requestByToken(s: State, token: string) {
  requireThat(/^[a-f0-9]{48}$/.test(token), 'Not found', 404)
  const digest = await hash(token)
  return s.all('data-request').find(r => r.tokenHash === digest) ?? s.all('privacy-request-closed').find(r => r.tokenHash === digest) ?? null
}

/** An admin extends an open request once, by up to 45 days, with the reason the requester sees. */
export function extendRequest(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const r = s.get('data-request', b.id)
  requireThat(r.status === 'open' && r.dueOn, 'Only an open request with a deadline can be extended', 409)
  requireThat(!r.extension, 'This request was already extended once', 409)
  const days = integer(b.days ?? DUE_DAYS, 'Days to extend', 1, DUE_DAYS)
  const record = s.put('data-request', r.id, { ...r, extension: { days, reason: text(b.reason, 'Reason for the extension', 1000), by: a.email, at: now() }, dueOn: addDays(r.dueOn, days) })
  s.audit(a, 'data-request-extended', 'data-request:' + r.id, { days })
  return record
}

export const REFUSAL_BASES: Data = {
  'legal-hold': 'A legal hold requires us to keep these records (LDG-012).',
  'required-record': 'The law requires us to keep these records (REPORT-002).',
}

/** An admin refuses a deletion with its documented basis; a legal hold must actually cover the person. */
export function refuseRequest(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const r = s.get('data-request', b.id)
  requireThat(r.status === 'open' && r.candidate, 'Only an open, verified request can be refused', 409)
  requireThat(r.type === 'deletion', 'Only a deletion request is refused for records that must be kept', 409)
  const basis = oneOf(b.basis, Object.keys(REFUSAL_BASES) as ['legal-hold', 'required-record'], 'Why the records must be kept')
  if (basis === 'legal-hold') {
    const vacancies = new Set(s.scan('application').filter(x => x.candidate === r.candidate).map(x => x.vacancy))
    requireThat(s.scan('hold').some(h => h.status === 'active' && (h.candidate === r.candidate || vacancies.has(h.vacancy))), 'No active legal hold covers this person', 409)
  }
  const reason = `${REFUSAL_BASES[basis]} ${text(b.explanation, 'Explanation for the requester', 2000)}`
  const record = s.put('data-request', r.id, { ...r, status: 'refused', refusal: { basis, reason }, completedBy: a.email, completedAt: now(), outcome: 'Refused: ' + reason })
  s.audit(a, 'data-request-refused', 'data-request:' + r.id, { basis })
  return record
}

/** Erasure removes a person's requests (LDG-012); a page-submitted one keeps a personal-data-free status for its requester. */
export function closeOnErasure(s: State, requests: Data[], receipt: string) {
  for (const r of requests.filter(r => r.tokenHash))
    s.put('privacy-request-closed', uid(), { tokenHash: r.tokenHash, code: r.code, type: r.type, receivedAt: r.receivedAt, dueOn: r.dueOn, status: 'complete', outcome: r.type === 'deletion' ? 'Your records were deleted.' : 'Your records were deleted before this request was completed.', completedAt: now(), receipt })
}
