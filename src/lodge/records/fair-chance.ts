import type { State } from '../core/state'
import { requireAdmin, requireApplication } from '../core/access'
import { date, integer, list, now, oneOf, requireThat, text, type Actor, type Data } from '../core/types'
import { approvedNow } from './approvals'
import { businessToday } from './tasks'

// HIRE-007: fair-chance sequencing. Admins name the places (a US state or a
// city) where, as their counsel determines, criminal history may be asked or
// checked only after a conditional offer, each with a waiting period. A job is
// at such a place when its location or office names it (a state also by its
// two-letter abbreviation, as in "Los Angeles, CA"). Criminal-history questions
// are refused on those jobs and left off their application page. After a
// recorded conditional offer, admins record the individualized assessment, the
// pre-adverse notice the employer gave (Lodge sends nothing) and the final
// decision; an adverse decision waits until the notice day plus the waiting
// period, in whole calendar days of the business's time zone. Lodge records;
// the employer decides. These records are restricted like accommodation
// answers: the owner and hiring admins only.

export const CRIMINAL_HISTORY = /\b(convict(ed|ions?)|criminal (history|record|background|offen[cs]es?)|arrest(ed|s)?|felon(y|ies|s)?|misdemeanou?rs?|(ever been|been) (charged|incarcerated|jailed|imprisoned)|pleaded (guilty|no contest))\b/i

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}
const ABBREVIATION = Object.fromEntries(Object.entries(STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]))
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const places = (s: State): Data[] => s.find('fair-chance', 'main')?.places ?? []

function names(place: string, where: string) {
  if (new RegExp(`(^|[^a-z])${escape(place.toLowerCase())}($|[^a-z])`).test(where.toLowerCase())) return true
  const abbr = ABBREVIATION[place.toLowerCase()] ?? (STATES[place.toUpperCase()] ? place.toUpperCase() : null)
  return !!abbr && (new RegExp(`(^|[,;(\\s])${abbr}($|[,;)\\s\\d])`).test(where) || where.toLowerCase().includes(STATES[abbr].toLowerCase()))
}

/** The fair-chance place a job is at, if any. */
export function fairChancePlace(s: State, vacancy: Data): Data | undefined {
  const where = [vacancy.location, vacancy.officeId ? s.find('office', vacancy.officeId)?.name : ''].filter(Boolean).join('; ')
  return where ? places(s).find(p => names(p.place, where)) : undefined
}

/** Admins name the fair-chance places and each one's waiting period (whole days, default 5). */
export function fairChancePlaces(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const next = list(b.places ?? [], 'Fair-chance places', 60, (x: any) => ({ place: text(x?.place, 'Place', 100), waitingDays: integer(x?.waitingDays ?? 5, 'Waiting period (days)', 1, 60) }))
  requireThat(new Set(next.map(p => p.place.toLowerCase())).size === next.length, 'Name each place once')
  const record = s.put('fair-chance', 'main', { places: next, by: a.email, at: now() })
  s.audit(a, 'fair-chance-places', 'fair-chance:main', { places: next.map(p => p.place) })
  return record
}

/** An offer marked conditional that is approved on its current terms, or accepted. */
export async function conditionalOffer(s: State, applicationId: string) {
  for (const o of s.all('offer').filter(x => x.application === applicationId && x.conditional))
    if (o.status === 'accepted' || (o.status === 'draft' && await approvedNow(s, 'offer', o))) return o
  return undefined
}

const addDays = (day: string, days: number) => new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10)

/** The first day a final adverse decision may be recorded. */
export const adverseFrom = (record: Data) => record.notice ? addDays(record.notice.date, record.notice.waitingDays) : null

/** Admins record the assessment, the pre-adverse notice the employer gave, then the final decision, in that order. */
export async function fairChanceStep(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const app = requireApplication(s, a, b.application)
  const place = fairChancePlace(s, s.get('vacancy', app.vacancy))
  requireThat(place, 'This job is not at a fair-chance place', 409)
  requireThat(await conditionalOffer(s, app.id), 'Record a conditional offer first: at a fair-chance place criminal history comes after it', 409)
  const step = oneOf(b.step, ['assessment', 'pre-adverse-notice', 'final-decision'] as const, 'Step')
  const current = s.find('fair-chance-record', app.id) ?? { application: app.id, candidate: app.candidate, place: place.place, assessments: [] }
  requireThat(!current.decision, 'The final decision is already recorded', 409)
  let next: Data
  if (step === 'assessment') next = { ...current, assessments: [...current.assessments, { text: text(b.text, 'Individualized assessment', 8000), by: a.email, at: now() }] }
  else if (step === 'pre-adverse-notice') {
    requireThat(current.assessments.length, 'Record the individualized assessment before the pre-adverse notice', 409)
    requireThat(!current.notice, 'The pre-adverse notice is already recorded', 409)
    const day = date(b.date, 'Day the employer gave the notice')
    requireThat(day <= businessToday(s), 'The notice day cannot be in the future')
    next = { ...current, notice: { date: day, waitingDays: place.waitingDays, note: text(b.text, 'What the notice said and how it was given', 4000), by: a.email, at: now() } }
  } else {
    const outcome = oneOf(b.outcome, ['proceed', 'adverse'] as const, 'Decision')
    requireThat(current.assessments.length, 'Record the individualized assessment before the decision', 409)
    if (outcome === 'adverse') {
      requireThat(current.notice, 'Give and record the pre-adverse notice before an adverse decision', 409)
      requireThat(businessToday(s) >= adverseFrom(current)!, `The waiting period runs until ${adverseFrom(current)}; record the final decision from then`, 409)
    }
    next = { ...current, decision: { outcome, reason: text(b.text, 'Reason for the decision', 4000), by: a.email, at: now() } }
  }
  const record = s.put('fair-chance-record', app.id, { id: app.id, ...next })
  s.audit(a, 'fair-chance-' + step, 'application:' + app.id)
  return { ...record, adverseFrom: adverseFrom(record) }
}

/** What admins (people, not agents) read: the places and the records of applications they see. */
export function fairChanceView(s: State, a: Actor, visible: Set<string>) {
  if (a.agent) return null
  return { places: places(s), records: s.all('fair-chance-record').filter(r => visible.has(r.application)).map(r => ({ ...r, adverseFrom: adverseFrom(r) })) }
}
