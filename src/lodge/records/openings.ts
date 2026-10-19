import type { State } from '../core/state'
import { requireManages } from '../core/access'
import { date, now, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { officeRef } from './org'

// REQ-001: a job carries one opening per approved headcount. Each opening has an
// opening ID (the employer's own, or generated), a target start date and a
// status: requested (an extra opening waiting on LDG-001 headcount approval),
// open, filled (by a named accepted offer) or closed (without a hire, with a
// reason). Closed and filled openings stay on the job as history.

/** Openings that count against the approved headcount: everything approved, whatever became of it. */
export const approvedOpenings = (v: Data) => (v.openings ?? []).filter((o: Data) => ['open', 'filled', 'closed'].includes(o.status))
export const openOpenings = (v: Data) => (v.openings ?? []).filter((o: Data) => o.status === 'open')

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/

/** An opening ID is unique across the business, compared ignoring case. */
function code(s: State, value: unknown, vacancyId: string, openingId: string | null) {
  const c = text(value, 'Opening ID', 40)
  requireThat(CODE.test(c), 'An opening ID uses letters, digits, dots, dashes and underscores (up to 40)')
  const taken = s.all('vacancy').some(v => (v.openings ?? []).some((o: Data) => o.code.toLowerCase() === c.toLowerCase() && !(v.id === vacancyId && o.id === openingId)))
  requireThat(!taken, `Opening ID ${c} is already in use`, 409)
  return c
}

/** Generated IDs read as the job's short reference and the opening's number, for example LDG-3F9A2C-02. */
function generated(s: State, v: Data, n: number) {
  for (let k = n; ; k++) {
    const c = `LDG-${v.id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}-${String(k).padStart(2, '0')}`
    if (!s.all('vacancy').some(x => (x.openings ?? []).some((o: Data) => o.code.toLowerCase() === c.toLowerCase()))) return c
  }
}

function blank(s: State, v: Data, openings: Data[], status: 'open' | 'requested', extra: Data = {}) {
  const kickoff = v.kickoff ? s.find('kickoff', v.kickoff) : null
  return { id: uid().slice(0, 8), code: generated(s, { ...v, openings }, openings.length + 1), targetStart: kickoff?.targetStart ?? null, status, ...(status === 'open' ? { openedAt: now() } : { requestedAt: now() }), ...extra }
}

/**
 * Called when a headcount approval is decided. Approved: requested openings
 * open, and new openings are added until the approved openings match the
 * headcount. Rejected: requested openings are refused and the headcount falls
 * back to the openings already approved, so the earlier approval applies again.
 */
export function settleOpenings(s: State, a: Actor, v: Data, decision: 'approved' | 'rejected') {
  const openings: Data[] = [...(v.openings ?? [])]
  if (decision === 'rejected') {
    if (!openings.some(o => o.status === 'requested')) return
    const settled = openings.map(o => o.status === 'requested' ? { ...o, status: 'refused', refusedAt: now() } : o)
    s.put('vacancy', v.id, { ...v, openings: settled, headcount: approvedOpenings({ openings: settled }).length || v.headcount })
    s.audit(a, 'openings-refused', 'vacancy:' + v.id)
    return
  }
  const opened = openings.map(o => o.status === 'requested' ? { ...o, status: 'open', openedAt: now() } : o)
  while (approvedOpenings({ openings: opened }).length < (v.headcount ?? 0)) opened.push(blank(s, v, opened, 'open'))
  s.put('vacancy', v.id, { ...v, openings: opened })
  s.audit(a, 'openings-opened', 'vacancy:' + v.id, { openings: openOpenings({ openings: opened }).map((o: Data) => o.code) })
}

/** Add one requested opening and raise the headcount; it opens only once LDG-001 approval of the new headcount is given. */
export function requestedOpening(s: State, v: Data, b: Data) {
  const opening = blank(s, v, v.openings ?? [], 'requested')
  return { ...opening, code: b.code ? code(s, b.code, v.id, null) : opening.code, targetStart: b.targetStart ? date(b.targetStart, 'Target first day') : opening.targetStart, officeId: officeRef(s, b.office) }
}

function find(s: State, a: Actor, b: Data) {
  const v = s.get('vacancy', b.vacancy)
  requireManages(a, v)
  requireThat(v.status !== 'closed', 'This vacancy is closed', 409)
  const opening = (v.openings ?? []).find((o: Data) => o.id === b.opening)
  requireThat(opening, 'Opening not found', 404)
  return { v, opening }
}

/** Set an opening's employer-defined ID and target start date while it is open or requested. */
export function editOpening(s: State, a: Actor, b: Data) {
  const { v, opening } = find(s, a, b)
  requireThat(['open', 'requested'].includes(opening.status), 'Only an open or requested opening changes', 409)
  const next = { ...opening, code: b.code === undefined ? opening.code : code(s, b.code, v.id, opening.id), targetStart: b.targetStart ? date(b.targetStart, 'Target first day') : null, officeId: b.office === undefined ? opening.officeId : officeRef(s, b.office) }
  const record = s.put('vacancy', v.id, { ...v, openings: v.openings.map((o: Data) => o.id === opening.id ? next : o) })
  s.audit(a, 'opening-edited', 'vacancy:' + v.id, { opening: next.code })
  return record
}

/** Close an open opening without a hire; the reason is required and kept. */
export function closeOpening(s: State, a: Actor, b: Data) {
  const { v, opening } = find(s, a, b)
  requireThat(opening.status === 'open', 'Only an open opening can be closed', 409)
  const reason = text(b.reason, 'Why the opening closes without a hire', 500)
  requireThat(!s.all('offer').some(o => o.opening === opening.id && o.status === 'draft'), 'A draft offer names this opening; withdraw it first', 409)
  const record = s.put('vacancy', v.id, { ...v, openings: v.openings.map((o: Data) => o.id === opening.id ? { ...o, status: 'closed', closedAt: now(), closedBy: a.email, closeReason: reason } : o) })
  s.audit(a, 'opening-closed', 'vacancy:' + v.id, { opening: opening.code, reason })
  return record
}

/** The opening an offer names, which must be open on the offer's job. */
export function namedOpening(v: Data, id: unknown) {
  if (id === undefined || id === null || id === '') return undefined
  const opening = openOpenings(v).find((o: Data) => o.id === id)
  requireThat(opening, 'Name an open opening on this job', 409)
  return opening.id as string
}

/** An accepted offer fills the opening it names. Jobs approved before openings existed have none to fill. */
export function fill(v: Data, offer: Data, application: string) {
  if (!approvedOpenings(v).length) return v
  requireThat(offer.opening, 'Name the opening this offer fills, then have the offer approved again', 409)
  namedOpening(v, offer.opening)
  return { ...v, openings: v.openings.map((o: Data) => o.id === offer.opening ? { ...o, status: 'filled', filledAt: now(), offer: offer.id, application } : o) }
}

/** Erasure keeps the filled opening and its dates, without the erased offer or application. */
export function forgetFill(v: Data, appIds: Set<string>) {
  if (!(v.openings ?? []).some((o: Data) => appIds.has(o.application))) return null
  return { ...v, openings: v.openings.map((o: Data) => {
    if (!appIds.has(o.application)) return o
    const { offer: _offer, application: _application, ...kept } = o
    return { ...kept, filledBy: 'erased candidate' }
  }) }
}
