import type { State } from '../core/state'
import { blindCode, blindFor, redactor } from '../core/blind'
import { canSeeApplication, canSeeApproval, canSeeCandidate, canSeeTeamNote, isAgency, onTeam } from '../core/access'
import { grantsOf } from '../core/store'
import { times, businessZone } from '../core/time'
import type { Actor, Data, Role } from '../core/types'
import { EVENTS } from './events'

// An alert is a small record that points at something: it keeps no name, contact detail or text of its own (a mention
// kept for someone who cannot see the candidate is the one exception, and holds only a cleaned excerpt). What it says and
// whether it may be shown or sent at all is worked out from the live records every time it is read or sent.

const ALL: Role[] = ['admin', 'manager', 'interviewer', 'approver']

/** A saved member as the person they are, or null when they could not receive anything today. */
export function memberActor(s: State, m: Data | undefined): Actor | null {
  if (!m?.active || m.agent || !(m.owner || m.roles?.length) || (!m.owner && m.roles.includes('agency'))) return null
  return { id: m.email, email: m.email, name: m.name, session: '', version: 0, owner: m.owner === true, roles: m.owner ? ALL : m.roles, agent: false, seePrivate: m.owner === true || m.seePrivate === true, grants: m.owner ? undefined : grantsOf(s, m) }
}

/** Whether the alert's subject is still something this person may be pointed at. */
export function reach(s: State, who: Actor, alert: Data) {
  if (isAgency(who)) return false
  if (alert.textOnly) return true
  if (alert.event === 'approval') { const approval = s.find('approval', alert.approval); return !!approval && approval.status === 'pending' && canSeeApproval(s, who, approval) }
  if (alert.note) { const note = s.find('team-note', alert.note); if (!note || !canSeeTeamNote(s, who, note)) return false }
  const app = s.find('application', alert.application)
  if (app) return canSeeApplication(s, who, app) && (alert.scope !== 'team' || onTeam(who.email, s.get('vacancy', app.vacancy)))
  const candidate = s.find('candidate', alert.candidate)
  return !!candidate && !candidate.deleted && !candidate.mergedInto && canSeeCandidate(s, who, candidate)
}

const personName = (s: State, email: string | null) => (email && s.find('member', email)?.name) || email || 'Someone'

/** What an alert says to this person, and the link to its exact item (none for a mention they cannot follow). */
export function describe(s: State, alert: Data, who: Actor) {
  const by = personName(s, alert.by), app = s.find('application', alert.application)
  const candidate = s.find('candidate', alert.candidate ?? app?.candidate)
  const name = app && blindFor(s, who, app) ? blindCode(app) : candidate?.name ?? 'a candidate'
  const job = s.find('vacancy', alert.vacancy)?.title ?? ''
  const iv = alert.event === 'interview' ? s.find('interview', alert.item) : null
  const at = iv?.start && iv.status === 'scheduled' ? times(businessZone(s.find('business', 'main'))).when(iv.start) : ''
  let title = '', detail = ''
  switch (alert.event) {
    case 'application': title = `New application: ${name}`; detail = job; break
    case 'assigned': title = `${by} assigned you to review ${name}`; detail = job; break
    case 'approval': { const approval = s.find('approval', alert.approval); title = `Approval waiting: ${approval?.terms?.title ?? approval?.terms?.subject ?? 'a request'}`; detail = `Requested by ${personName(s, approval?.requestedBy ?? null)}`; break }
    case 'scorecard': title = `${by} submitted a scorecard for ${name}`; detail = job; break
    case 'feedback': title = `Feedback was released for ${name}`; detail = job; break
    case 'interview': title = `${iv ? iv.title.split(':')[0] : 'Interview'} ${alert.what}${at ? ' for ' + at : ''}: ${name}`; detail = job; break
    case 'offer': title = `Offer ${alert.what}: ${name}`; detail = job; break
    case 'mention': {
      const note = s.find('team-note', alert.note)
      title = alert.textOnly ? `${by} mentioned you in a note` : `${by} mentioned you on ${name}`
      detail = alert.textOnly ? alert.excerpt : app && blindFor(s, who, app) ? redactor(s, app)(note?.text ?? '') : note?.text ?? ''
      break
    }
  }
  const link = alert.textOnly ? null : alert.event === 'approval' ? '/app?approval=' + alert.approval
    : alert.event === 'interview' && iv?.status === 'scheduled' ? '/app?kit=' + iv.id
    : app ? '/app?application=' + app.id : '/app?candidate=' + alert.candidate
  return { title, detail, link, label: EVENTS[alert.event as keyof typeof EVENTS] as string }
}
