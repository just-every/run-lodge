import { blindFor } from './blind'
import type { State } from './state'
import { Fault, requireThat, scope, type Actor, type Data, type Role } from './types'

// Who may see and change what. Every screen, search, export, download and
// agent read is built from these checks, so a restricted interviewer gets the
// same answer through each of them.

/** CRM-005 agencies never acquire employer authority, even from stale assignments. */
export const isAgency = (a: Pick<Actor, 'owner' | 'roles'>) => !a.owner && a.roles.includes('agency')
export const isEmployeeOnly = (a: Pick<Actor, 'owner' | 'roles'>) => !a.owner && a.roles.length === 1 && a.roles[0] === 'employee'
export const isAdmin = (a: Actor) => a.owner || (!isAgency(a) && a.roles.includes('admin'))
/** OPS-002: compliance is a human read role, separate from hiring authority. */
export const isCompliance = (a: Actor) => !a.agent && !isAgency(a) && (isAdmin(a) || a.roles.includes('compliance'))
export const isComplianceOnly = (a: Actor) => !a.owner && !isAgency(a) && a.roles.includes('compliance') && !a.roles.some(r => ['admin', 'manager', 'interviewer', 'approver'].includes(r))

/** A compliance grant never grants the job's hiring records or candidate identity. */
export function canSeeCompliance(s: State, a: Actor, application: Data) {
  if (!isCompliance(a)) return false
  const app = s.find('application', application.id), vacancy = app && s.find('vacancy', app.vacancy)
  if (!app || !vacancy) return false
  if (isAdmin(a)) return canSeeApplication(s, a, app)
  return (vacancy.compliancePeople ?? []).includes(scope(a))
}
export const canReview = (a: Pick<Actor, 'owner' | 'roles'>) => !isAgency(a) && (a.owner || a.roles.some(role => ['admin', 'manager', 'interviewer'].includes(role)))
export const onPanel = (a: Actor, interview: Data) => canReview(a) && (interview.participants ?? []).includes(scope(a))
export const has = (a: Actor, role: Role) => !isAgency(a) && (a.owner || a.roles.includes(role))

export function requireRole(a: Actor, ...roles: Role[]) {
  if (isAgency(a) || (!a.owner && !roles.some(r => a.roles.includes(r)))) throw new Fault(403, 'Your Lodge role does not allow this')
}

export function requireAdmin(a: Actor) {
  if (!isAdmin(a)) throw new Fault(403, 'Only the owner or a hiring admin can do this')
}

/** REQ-003: a job's hiring team by role. The job's own hiring manager (`manager`) is always one of its hiring managers. */
export const TEAM_ROLES = ['recruiters', 'coordinators', 'hiringManagers', 'sourcers', 'interviewers'] as const
export type TeamRole = typeof TEAM_ROLES[number]
export const teamOf = (vacancy: Data, role: TeamRole): string[] => vacancy.team?.[role] ?? []
/** Recruiters, coordinators and hiring managers run the job. */
export const runsJob = (who: string, vacancy: Data) => vacancy.manager === who || (['recruiters', 'coordinators', 'hiringManagers'] as const).some(r => teamOf(vacancy, r).includes(who))
export const onTeam = (who: string, vacancy: Data) => TEAM_ROLES.some(r => teamOf(vacancy, r).includes(who)) || vacancy.manager === who
/** The job's hiring managers, its own first. */
export const hiringManagers = (vacancy: Data) => [vacancy.manager, ...teamOf(vacancy, 'hiringManagers')].filter(Boolean) as string[]

/**
 * A confidential job or a private candidate is visible only to the owner, holders
 * of the "see private" permission and the people named on it (a job's hiring
 * team, its own hiring manager included, is always named). Everything else is unaffected.
 */
export function cleared(a: Actor, record: Data | undefined, flag: 'confidential' | 'private') {
  if (!record?.[flag]) return true
  const who = scope(a)
  return a.owner || a.seePrivate === true || (record.namedPeople ?? []).includes(who) || (flag === 'confidential' && onTeam(who, record))
}

/** REQ-004: a manager's department or office grant covers the job. */
const granted = (a: Actor, vacancy: Data) => !!a.grants && ((!!vacancy.departmentId && a.grants.departments.includes(vacancy.departmentId)) || (!!vacancy.officeId && a.grants.offices.includes(vacancy.officeId)))

/**
 * Managers run their own vacancies, the jobs whose hiring team names them as a
 * recruiter, coordinator or hiring manager (REQ-003) and, with department or
 * office grants, every job in them; admins and the owner run all of them,
 * except confidential ones they are not cleared for.
 */
export function managesVacancy(a: Actor, vacancy: Data) {
  if (isAgency(a)) return false
  if (isAdmin(a) && cleared(a, vacancy, 'confidential')) return true
  if (!a.roles.includes('manager')) return false
  return runsJob(scope(a), vacancy) || !!vacancy.levels?.members?.[scope(a)] || (granted(a, vacancy) && cleared(a, vacancy, 'confidential'))
}

export function requireManages(a: Actor, vacancy: Data) {
  if (!managesVacancy(a, vacancy)) throw new Fault(403, 'This vacancy belongs to another hiring manager')
}

/**
 * OPS-004: named permission levels. A level is a set of these permissions; the
 * owner and hiring admins hold all of them business-wide. A level assigned to a
 * member on a job wins; else the levels of their REQ-003 team roles on the job;
 * else their department and office levels (REQ-004 grants), combined. Anyone
 * without an assigned level keeps Lodge's seeded rights: the people who run a
 * job hold the manager set, the approver role approves, "see private" holders
 * (and only they, among admins) see private candidates, and assigned reviewers read released scorecards and
 * export the activity they see. Monitoring and accommodation answers are never
 * a level's to grant.
 */
export const PERMISSIONS = ['contact', 'scorecards', 'move', 'reject', 'offers', 'approve', 'private', 'export', 'settings'] as const
export type Permission = typeof PERMISSIONS[number]
export const MANAGER_PERMISSIONS: Permission[] = ['contact', 'scorecards', 'move', 'reject', 'offers', 'export', 'settings']
export const SEEDED_LEVELS: Data[] = [
  { id: 'lodge-manager', name: 'Hiring manager (Lodge default)', permissions: MANAGER_PERMISSIONS, seeded: true },
  { id: 'lodge-interviewer', name: 'Interviewer (Lodge default)', permissions: ['scorecards', 'export'], seeded: true },
  { id: 'lodge-approver', name: 'Approver (Lodge default)', permissions: ['approve'], seeded: true },
]
export const levelById = (s: State, id: string): Data | undefined => SEEDED_LEVELS.find(l => l.id === id) ?? s.find('permission-level', id)

/** The levels assigned to this person for this job, by precedence; null when none applies. */
function assignedLevels(s: State, a: Actor, vacancy: Data): Data[] | null {
  const who = scope(a), on = vacancy.levels ?? {}
  if (on.members?.[who]) return [levelById(s, on.members[who])].filter(Boolean) as Data[]
  const roles = TEAM_ROLES.filter(r => teamOf(vacancy, r).includes(who) || (r === 'hiringManagers' && vacancy.manager === who))
  const byRole = roles.map(r => on.roles?.[r]).filter(Boolean)
  if (byRole.length) return byRole.map(id => levelById(s, id)).filter(Boolean) as Data[]
  const byPlace = [...(vacancy.departmentId ? a.grants?.levels?.[vacancy.departmentId] ?? [] : []), ...(vacancy.officeId ? a.grants?.levels?.[vacancy.officeId] ?? [] : [])]
  if (byPlace.length && granted(a, vacancy)) return byPlace.map(id => levelById(s, id)).filter(Boolean) as Data[]
  return null
}

/** What this person may do on this job (OPS-004), read from the saved records on every request. */
export function permissionsOn(s: State, a: Actor, vacancy: Data): Set<Permission> {
  if (isAgency(a) || isComplianceOnly(a)) return new Set()
  // Admins hold every permission business-wide; seeing private candidates stays with the owner and "see private" holders (OPS-005).
  if (isAdmin(a) && cleared(a, vacancy, 'confidential')) return new Set(PERMISSIONS.filter(p => p !== 'private' || a.owner || a.seePrivate))
  const levels = assignedLevels(s, a, vacancy)
  if (levels) return new Set(levels.flatMap(l => l.permissions))
  const seeded = new Set<Permission>(managesVacancy(a, vacancy) ? MANAGER_PERMISSIONS : ['scorecards', 'export'])
  if (has(a, 'approver')) seeded.add('approve')
  if (a.seePrivate) seeded.add('private')
  return seeded
}

export const can = (s: State, a: Actor, vacancy: Data, p: Permission) => permissionsOn(s, a, vacancy).has(p)

const NEEDS: Record<Permission, string> = { contact: 'see contact details', scorecards: 'read and release scorecards', move: 'move stages', reject: 'reject', offers: 'create and see offers', approve: 'approve', private: 'see private candidates', export: 'export', settings: 'edit job settings' }
export function requireCan(s: State, a: Actor, vacancy: Data, p: Permission) {
  if (!can(s, a, vacancy, p)) throw new Fault(403, `Your permission level on this job does not let you ${NEEDS[p]}`)
}

/** Interviewers see an application only when assigned to review it or invited to one of its interviews. */
export function assignedTo(s: State, a: Actor, application: Data) {
  if (!canReview(a)) return false
  s.get('application', application.id)
  return (application.reviewers ?? []).includes(scope(a)) || s.all('interview').some(i => i.application === application.id && i.status !== 'cancelled' && onPanel(a, i) && !!s.get('interview', i.id))
}

export function canSeeApplication(s: State, a: Actor, application: Data) {
  if (isAgency(a) || isComplianceOnly(a)) return false
  // A deactivated member keeps their history but loses every view at once.
  if (!a.owner && !a.roles.length) return false
  s.get('application', application.id)
  const vacancy = s.find('vacancy', application.vacancy)
  // OPS-004: a level with "see private candidates" clears the private candidates of that job only.
  if (!cleared(a, s.find('candidate', application.candidate), 'private') && !(vacancy && managesVacancy(a, vacancy) && can(s, a, vacancy, 'private'))) return false
  // ATTR-005: an internal application reaches only the owner, admins and the job's hiring team.
  if (application.internal && !(vacancy && ((isAdmin(a) && cleared(a, vacancy, 'confidential')) || onTeam(scope(a), vacancy)))) return false
  return (vacancy && managesVacancy(a, vacancy)) || assignedTo(s, a, application)
}

export function requireApplication(s: State, a: Actor, id: unknown): Data {
  const application = s.find('application', id)
  // Unknown and out-of-scope applications answer alike, so ids cannot be probed.
  if (!application || !canSeeApplication(s, a, application)) throw new Fault(404, 'Application not found')
  return application
}

/** CRM-009: who sees an event and its pool: the owner and admins, the event's owner, and the hiring teams (REQ-003) of its linked jobs. */
export function seesEvent(s: State, a: Actor, e: Data) {
  if (isAgency(a) || isComplianceOnly(a)) return false
  if (!a.owner && !a.roles.length) return false
  if (isAdmin(a)) return true
  const who = scope(a)
  return e.owner === who || (e.jobs ?? []).some((id: string) => { const v = s.find('vacancy', id); return !!v && onTeam(who, v) && cleared(a, v, 'confidential') })
}

/** A person in the pool of an event the reader sees. */
const inSeenPool = (s: State, a: Actor, candidate: Data) => s.all('event-capture').some(r => r.candidate === candidate.id && seesEvent(s, a, s.get('event', r.event)))

/** OPS-004: a private candidate is cleared for someone whose level on one of the candidate's jobs sees private candidates. */
const privateByLevel = (s: State, a: Actor, candidate: Data) => s.all('application').some(app => { const v = app.candidate === candidate.id && s.find('vacancy', app.vacancy); return !!v && managesVacancy(a, v) && can(s, a, v, 'private') })

export function canSeeCandidate(s: State, a: Actor, candidate: Data) {
  if (isAgency(a) || isComplianceOnly(a)) return false
  if (!cleared(a, candidate, 'private') && !privateByLevel(s, a, candidate)) return false
  if (inSeenPool(s, a, candidate)) return true
  const apps = s.all('application').filter(app => app.candidate === candidate.id)
  // Admins see every candidate except one known only through confidential jobs they are not cleared for.
  if (isAdmin(a)) return !apps.length || apps.some(app => cleared(a, s.find('vacancy', app.vacancy), 'confidential') || canSeeApplication(s, a, app))
  return apps.some(app => canSeeApplication(s, a, app))
}

/** A candidate the reader may act on: a private one, or one known only through confidential jobs, answers as unknown. */
export function requireCandidate(s: State, a: Actor, id: unknown): Data {
  const candidate = s.find('candidate', id)
  if (!candidate || !canSeeCandidate(s, a, candidate)) throw new Fault(404, 'Candidate not found')
  return candidate
}

/** Contact details stay with the people who run the vacancy; interviewers see names. */
export function canSeeContact(s: State, a: Actor, candidate: Data) {
  if (isAgency(a) || isComplianceOnly(a)) return false
  if (isAdmin(a)) return canSeeCandidate(s, a, candidate)
  if (!cleared(a, candidate, 'private') && !privateByLevel(s, a, candidate)) return false
  if (inSeenPool(s, a, candidate)) return true
  return s.all('application').some(app => {
    if (app.candidate !== candidate.id) return false
    s.get('application', app.id)
    const vacancy = s.find('vacancy', app.vacancy)
    // OPS-004: the job's level decides whether contact details show.
    return vacancy ? managesVacancy(a, vacancy) && can(s, a, vacancy, 'contact') && !blindFor(s, a, app) : false
  })
}

/**
 * Restricted documents (right-to-work papers, voluntary monitoring answers,
 * anything marked restricted) require human compliance access. A separate
 * compliance member reads only application documents on explicitly granted jobs.
 */
export function canSeeDocument(s: State, a: Actor, doc: Data) {
  if (isAgency(a)) return false
  if (doc.restricted) {
    if (!isCompliance(a)) return false
    if (!isAdmin(a)) {
      const app = doc.application && s.find('application', doc.application)
      return !doc.esign && !!app && canSeeCompliance(s, a, app)
    }
  }
  // OFFER-005: a natively signed PDF or certificate follows offer rights on its job, and never reaches an agent.
  if (doc.esign) { const app = s.find('application', doc.application), vacancy = app && s.find('vacancy', app.vacancy); return !a.agent && !!vacancy && managesVacancy(a, vacancy) && can(s, a, vacancy, 'offers') && !blindFor(s, a, app) }
  if (doc.application && s.find('application', doc.application)) {
    // A transferred application carries its source's attachments to the new job's team.
    for (let app = s.find('application', doc.application), hops = 0; app && hops < 20; app = app.transferredTo && s.find('application', app.transferredTo), hops++)
      if (canSeeApplication(s, a, app) && !blindFor(s, a, app)) return true
    // MIG-008: the files of an imported application belong to the live application it was moved into.
    return s.all('application').some(x => x.activated?.from === doc.application && canSeeApplication(s, a, x) && !blindFor(s, a, x))
  }
  const candidate = s.find('candidate', doc.candidate)
  if (s.all('application').some(app => app.candidate === doc.candidate && canSeeApplication(s, a, app) && blindFor(s, a, app))) return s.all('application').some(app => app.candidate === doc.candidate && canSeeApplication(s, a, app) && !blindFor(s, a, app))
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
  const app = s.find('application', card.application), vacancy = app && s.find('vacancy', app.vacancy)
  return !!app && app.feedbackReleased === true && canSeeApplication(s, a, app) && !!vacancy && can(s, a, vacancy, 'scorecards')
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
  if (approval.subjectKind === 'message') {
    const m = s.find('message', approval.subjectId), app = m?.templateDraft && s.find('application', m.application), job = app && s.find('vacancy', app.vacancy)
    if (m?.templateDraft && (!app || !job || !canSeeApplication(s, a, app) || !managesVacancy(a, job) || !can(s, a, job, 'contact'))) return false
  }
  if (isAdmin(a)) {
    const subject = s.find(approval.subjectKind, approval.subjectId)
    if (!subject) return true
    if (approval.subjectKind === 'vacancy') return cleared(a, subject, 'confidential')
    const app = subject.application && s.find('application', subject.application)
    return !app || canSeeApplication(s, a, app)
  }
  if ((approval.approver === scope(a) || approval.chain?.steps.some((step: Data) => step.approvers.includes(scope(a)))) && has(a, approval.subjectKind === 'message' ? 'manager' : 'approver')) {
    if (!approval.chain) return true
    const vacancy = s.find('vacancy', approval.subjectId)
    return !!vacancy && can(s, a, vacancy, 'approve')
  }
  if (approval.requestedBy !== scope(a)) return false
  const subject = s.find(approval.subjectKind, approval.subjectId)
  const app = subject?.application && s.find('application', subject.application)
  const vacancy = approval.subjectKind === 'vacancy' ? subject : app && s.find('vacancy', app.vacancy)
  return !!vacancy && managesVacancy(a, vacancy) && (approval.subjectKind !== 'offer' || can(s, a, vacancy, 'offers'))
}
