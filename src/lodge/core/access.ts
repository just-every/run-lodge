import type { State } from './state'
import { Fault, requireThat, scope, type Actor, type Data, type Role } from './types'

// Who may see and change what. Every screen, search, export, download and
// agent read is built from these checks, so a restricted interviewer gets the
// same answer through each of them.

export const isAdmin = (a: Actor) => a.owner || a.roles.includes('admin')
export const canReview = (a: Pick<Actor, 'owner' | 'roles'>) => a.owner || a.roles.some(role => ['admin', 'manager', 'interviewer'].includes(role))
export const onPanel = (a: Actor, interview: Data) => canReview(a) && (interview.participants ?? []).includes(scope(a))
export const has = (a: Actor, role: Role) => a.owner || a.roles.includes(role)

export function requireRole(a: Actor, ...roles: Role[]) {
  if (!a.owner && !roles.some(r => a.roles.includes(r))) throw new Fault(403, 'Your Lodge role does not allow this')
}

export function requireAdmin(a: Actor) {
  if (!isAdmin(a)) throw new Fault(403, 'Only the owner or a hiring admin can do this')
}

/** Managers run their own vacancies; admins and the owner run all of them. */
export function managesVacancy(a: Actor, vacancy: Data) {
  return isAdmin(a) || (a.roles.includes('manager') && vacancy.manager === scope(a))
}

export function requireManages(a: Actor, vacancy: Data) {
  if (!managesVacancy(a, vacancy)) throw new Fault(403, 'This vacancy belongs to another hiring manager')
}

/** Interviewers see an application only when assigned to review it or invited to one of its interviews. */
export function assignedTo(s: State, a: Actor, application: Data) {
  if (!canReview(a)) return false
  s.get('application', application.id)
  return (application.reviewers ?? []).includes(scope(a)) || s.all('interview').some(i => i.application === application.id && i.status !== 'cancelled' && onPanel(a, i) && !!s.get('interview', i.id))
}

export function canSeeApplication(s: State, a: Actor, application: Data) {
  // A deactivated member keeps their history but loses every view at once.
  if (!a.owner && !a.roles.length) return false
  s.get('application', application.id)
  const vacancy = s.find('vacancy', application.vacancy)
  return (vacancy && managesVacancy(a, vacancy)) || assignedTo(s, a, application)
}

export function requireApplication(s: State, a: Actor, id: unknown): Data {
  const application = s.find('application', id)
  // Unknown and out-of-scope applications answer alike, so ids cannot be probed.
  if (!application || !canSeeApplication(s, a, application)) throw new Fault(404, 'Application not found')
  return application
}

export function canSeeCandidate(s: State, a: Actor, candidate: Data) {
  if (isAdmin(a)) return true
  return s.all('application').some(app => app.candidate === candidate.id && canSeeApplication(s, a, app))
}

/** Contact details stay with the people who run the vacancy; interviewers see names. */
export function canSeeContact(s: State, a: Actor, candidate: Data) {
  if (isAdmin(a)) return true
  return s.all('application').some(app => {
    if (app.candidate !== candidate.id) return false
    s.get('application', app.id)
    const vacancy = s.find('vacancy', app.vacancy)
    return vacancy ? managesVacancy(a, vacancy) : false
  })
}

/**
 * Restricted documents (right-to-work papers, voluntary monitoring answers,
 * anything marked restricted) are visible to the owner and hiring admins only.
 */
export function canSeeDocument(s: State, a: Actor, doc: Data) {
  if (isAdmin(a)) return true
  if (doc.restricted) return false
  if (doc.application) {
    // A transferred application carries its source's attachments to the new job's team.
    for (let app = s.find('application', doc.application), hops = 0; app && hops < 20; app = app.transferredTo && s.find('application', app.transferredTo), hops++)
      if (canSeeApplication(s, a, app)) return true
    return false
  }
  const candidate = s.find('candidate', doc.candidate)
  return !!candidate && canSeeCandidate(s, a, candidate)
}

export function requireDocument(s: State, a: Actor, id: unknown): Data {
  const doc = s.find('document', id)
  if (!doc || !canSeeDocument(s, a, doc)) throw new Fault(404, 'Document not found')
  return doc
}

/**
 * Scorecards are independent: an author always sees their own; colleagues see
 * submitted ones only after the vacancy's manager releases the feedback.
 */
export function canSeeScorecard(s: State, a: Actor, card: Data) {
  if (card.author === scope(a)) { const app = s.find('application', card.application); return !!app && canSeeApplication(s, a, app) }
  if (card.status !== 'submitted') return false
  const app = s.find('application', card.application)
  return !!app && app.feedbackReleased === true && canSeeApplication(s, a, app)
}

export function requireMember(s: State, emailAddress: string, role?: Role) {
  const member = s.find('member', emailAddress)
  requireThat(member?.active, `${emailAddress} is not an active Lodge member`)
  if (role) requireThat(member.roles.includes(role) || member.owner, `${emailAddress} does not have the ${role} role`)
  return member
}

/** Notes and their quoted drafts remain private even after submitted feedback is released. */
export function canSeeNote(s: State, a: Actor, note: Data) {
  const app = s.find('application', note.application)
  return note.author === scope(a) && !!app && canSeeApplication(s, a, app)
}

/** Approval terms have their own assigned reviewer grant, independent of application visibility. */
export function canSeeApproval(s: State, a: Actor, approval: Data) {
  if (isAdmin(a)) return true
  if (approval.approver === scope(a) && has(a, approval.subjectKind === 'message' ? 'manager' : 'approver')) return true
  if (approval.requestedBy !== scope(a)) return false
  const subject = s.find(approval.subjectKind, approval.subjectId)
  const app = subject?.application && s.find('application', subject.application)
  const vacancy = approval.subjectKind === 'vacancy' ? subject : app && s.find('vacancy', app.vacancy)
  return !!vacancy && managesVacancy(a, vacancy)
}
