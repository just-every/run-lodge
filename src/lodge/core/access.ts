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

/**
 * A confidential job or a private candidate is visible only to the owner, holders
 * of the "see private" permission and the people named on it (a job's own
 * hiring manager is always named). Everything else is unaffected.
 */
export function cleared(a: Actor, record: Data | undefined, flag: 'confidential' | 'private') {
  if (!record?.[flag]) return true
  const who = scope(a)
  return a.owner || a.seePrivate === true || (record.namedPeople ?? []).includes(who) || (flag === 'confidential' && record.manager === who)
}

/** REQ-004: a manager's department or office grant covers the job. */
const granted = (a: Actor, vacancy: Data) => !!a.grants && ((!!vacancy.departmentId && a.grants.departments.includes(vacancy.departmentId)) || (!!vacancy.officeId && a.grants.offices.includes(vacancy.officeId)))

/**
 * Managers run their own vacancies and, with department or office grants, every
 * job in them; admins and the owner run all of them, except confidential ones
 * they are not cleared for.
 */
export function managesVacancy(a: Actor, vacancy: Data) {
  if (isAdmin(a) && cleared(a, vacancy, 'confidential')) return true
  if (!a.roles.includes('manager')) return false
  return vacancy.manager === scope(a) || (granted(a, vacancy) && cleared(a, vacancy, 'confidential'))
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
  if (!cleared(a, s.find('candidate', application.candidate), 'private')) return false
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
  if (!cleared(a, candidate, 'private')) return false
  const apps = s.all('application').filter(app => app.candidate === candidate.id)
  // Admins see every candidate except one known only through confidential jobs they are not cleared for.
  if (isAdmin(a)) return !apps.length || apps.some(app => cleared(a, s.find('vacancy', app.vacancy), 'confidential') || canSeeApplication(s, a, app))
  return apps.some(app => canSeeApplication(s, a, app))
}

/** Contact details stay with the people who run the vacancy; interviewers see names. */
export function canSeeContact(s: State, a: Actor, candidate: Data) {
  if (isAdmin(a)) return canSeeCandidate(s, a, candidate)
  if (!cleared(a, candidate, 'private')) return false
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
  if (doc.restricted && !isAdmin(a)) return false
  if (doc.application && s.find('application', doc.application)) {
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

/**
 * A shared candidate note reaches everyone who can see the candidate; a private
 * one only admins, the hiring managers of the note's job and its author.
 */
export function canSeeTeamNote(s: State, a: Actor, note: Data) {
  const candidate = s.find('candidate', note.candidate)
  if (!candidate || !canSeeCandidate(s, a, candidate)) return false
  if (!note.private || isAdmin(a) || note.author === scope(a)) return true
  const app = note.application && s.find('application', note.application)
  const vacancy = app && s.find('vacancy', app.vacancy)
  return !!vacancy && managesVacancy(a, vacancy)
}

/** Approval terms have their own assigned reviewer grant, independent of application visibility. */
export function canSeeApproval(s: State, a: Actor, approval: Data) {
  if (isAdmin(a)) {
    const subject = s.find(approval.subjectKind, approval.subjectId)
    if (!subject) return true
    if (approval.subjectKind === 'vacancy') return cleared(a, subject, 'confidential')
    const app = subject.application && s.find('application', subject.application)
    return !app || canSeeApplication(s, a, app)
  }
  if (approval.approver === scope(a) && has(a, approval.subjectKind === 'message' ? 'manager' : 'approver')) return true
  if (approval.requestedBy !== scope(a)) return false
  const subject = s.find(approval.subjectKind, approval.subjectId)
  const app = subject?.application && s.find('application', subject.application)
  const vacancy = approval.subjectKind === 'vacancy' ? subject : app && s.find('vacancy', app.vacancy)
  return !!vacancy && managesVacancy(a, vacancy)
}
