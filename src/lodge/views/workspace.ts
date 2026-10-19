import { canSeeProposal } from './proposals'
import type { State } from '../core/state'
import { canSeeApproval, canSeeNote, canSeeTeamNote, canSeeApplication, canSeeCandidate, canSeeContact, canSeeDocument, canSeeScorecard, isAdmin, managesVacancy } from '../core/access'
import { scope, type Actor, type Data } from '../core/types'
import { latestApproval, versionOf } from '../records/approvals'
import { duplicateSuggestions, transferredFrom } from '../records/candidates'
import { panel, summary, versioned } from '../records/scorecards'
import { funnel, history } from '../records/pipeline'
import { rangeCheck } from '../records/offers'
import { retentionReview } from '../records/retention'
import { missingTerms } from '../records/vacancies'
import { coordination } from '../agents/coordination'
import { activity } from './activity'
import { businessToday } from '../records/tasks'

/**
 * The actor's whole permitted view. The app, search, exports and the agent
 * command surface all read this same projection, so what a person cannot see
 * here they cannot reach any other way.
 */
export async function workspaceRecords(s: State, a: Actor) {
  const admin = isAdmin(a)
  const applications = s.all('application').filter(app => canSeeApplication(s, a, app))
  const appIds = new Set(applications.map(x => x.id))
  const myApprovals = s.all('approval').filter(x => canSeeApproval(s, a, x))
  const managed = s.all('vacancy').filter(v => managesVacancy(a, s.get('vacancy', v.id)))
  const visibleVacancyIds = new Set([...managed.map(v => v.id), ...applications.map(x => x.vacancy)])

  const vacancies: Data[] = []
  for (const v of s.all('vacancy').filter(v => visibleVacancyIds.has(v.id))) {
    if (managesVacancy(a, v)) {
      const approval = latestApproval(s, 'vacancy', v.id)
      const version = await versionOf(s, 'vacancy', v)
      vacancies.push({ ...v, manages: true, version, missing: missingTerms(v), approval: approval ?? null, approvedNow: approval?.status === 'approved' && approval.version === version, funnel: funnel(v, applications) })
    } else {
      // Panel members see the role, its stages and the rubric they score against.
      vacancies.push({ id: v.id, title: v.title, department: v.department, location: v.location, status: v.status, stages: v.stages, rubrics: v.rubrics, plan: v.plan, manages: false })
    }
  }

  const candidates = s.all('candidate').filter(c => !c.deleted && !c.mergedInto && canSeeCandidate(s, a, c)).map((c): Data => {
    if (admin) return { ...c, imported: c.imported ?? null }
    const base = { id: c.id, name: c.name, headline: c.headline, skills: c.skills, source: c.source, imported: c.imported ?? null }
    if (!canSeeContact(s, a, c)) return base
    return { ...base, email: c.email, phone: c.phone, location: c.location }
  })

  const offers: Data[] = []
  for (const o of s.all('offer').filter(o => appIds.has(o.application))) {
    const app = applications.find(x => x.id === o.application)!
    const vacancy = s.all('vacancy').find(v => v.id === app.vacancy)
    if (!vacancy || !managesVacancy(a, vacancy)) continue
    const approval = latestApproval(s, 'offer', o.id), version = await versionOf(s, 'offer', o)
    offers.push({ ...o, version, approval: approval ?? null, approvedNow: approval?.status === 'approved' && approval.version === version, rangeWarning: rangeCheck(vacancy, o) })
  }

  const messages: Data[] = []
  for (const m of s.all('message').filter(m => appIds.has(m.application))) {
    const app = applications.find(x => x.id === m.application)!
    const vacancy = s.all('vacancy').find(v => v.id === app.vacancy)
    if (!vacancy || !managesVacancy(a, vacancy)) continue
    const approval = latestApproval(s, 'message', m.id), version = await versionOf(s, 'message', m)
    messages.push({ ...m, version, approval: approval ?? null, approvedNow: approval?.status === 'approved' && approval.version === version })
  }

  const approvals: Data[] = []
  for (const x of myApprovals) {
    const subject = s.all(x.subjectKind).find(r => r.id === x.subjectId)
    approvals.push({ ...x, currentVersion: subject ? await versionOf(s, x.subjectKind, subject) : null })
  }

  const visibleCards = versioned(s.all('scorecard').filter(c => canSeeScorecard(s, a, c)))
  const projected = applications.map((app): Data => {
    const vacancy = s.all('vacancy').find(v => v.id === app.vacancy)
    const manages = !!vacancy && managesVacancy(a, vacancy)
    const cards = s.all('scorecard').filter(c => c.application === app.id)
    return {
      ...app, manages, candidateName: s.all('candidate').find(c => c.id === app.candidate)?.name ?? 'Unknown', history: history(s, app.id),
      // The source applications' stage histories travel with a transfer; their scorecards stay with their own job's panel.
      earlier: transferredFrom(s, app).map(x => ({ application: x.id, vacancy: x.vacancy, title: s.find('vacancy', x.vacancy)?.title ?? '', history: history(s, x.id) })),
      panel: manages ? panel(s, app).map(p => ({ email: p, submitted: cards.some(c => c.author === p && c.status === 'submitted') })) : undefined,
      scorecardSummary: summary(s, app, visibleCards),
    }
  })
  const interviews = s.all('interview').filter(i => appIds.has(i.application)).map((i): Data => {
    const app = applications.find(x => x.id === i.application)!
    const vacancy = s.all('vacancy').find(v => v.id === app.vacancy)
    // The candidate's availability link is a credential for the hiring team only.
    return vacancy && managesVacancy(a, vacancy) ? i : { ...i, candidateToken: undefined }
  })
  const visibleCandidates = new Set(candidates.map(c => c.id))
  // Follow-ups and tasks the reader owns or set, while what they point at stays in view.
  const tasks = s.all('task').filter(t => (t.owner === scope(a) || t.createdBy === scope(a)) && (t.application ? appIds.has(t.application) : !t.candidate || visibleCandidates.has(t.candidate))).sort((x, y) => x.due.localeCompare(y.due))
  const today = businessToday(s)
  const teamNotes = s.all('team-note').filter(n => visibleCandidates.has(n.candidate) && canSeeTeamNote(s, a, n)).sort((x, y) => x.at.localeCompare(y.at))
  return {
    actor: { email: a.email, name: a.name, owner: a.owner, roles: a.roles, agent: a.agent, actsFor: a.scopeAs ?? null },
    business: s.all('business')[0] ?? null,
    members: s.all('member').map(m => admin ? m : { email: m.email, name: m.name, roles: m.roles, active: m.active }),
    vacancies,
    applications: projected,
    candidates,
    mergedCandidates: admin ? s.all('candidate').filter(c => c.mergedInto) : [],
    receipts: admin ? s.all('receipt') : [],
    duplicateReviews: admin ? s.all('duplicate-review') : [],
    documents: s.all('document').filter(d => canSeeDocument(s, a, s.get('document', d.id))),
    interviews,
    scorecards: visibleCards,
    notes: s.all('interview-note').filter(n => canSeeNote(s, a, n)),
    teamNotes, activity: activity(s, { applications: projected, messages, interviews, offers, teamNotes }),
    tasks,
    notifications: [
      ...tasks.filter(t => t.owner === scope(a) && t.status === 'open' && t.due <= today).map(t => ({ id: 'due:' + t.id, kind: 'task-due', task: t.id, application: t.application, candidate: t.candidate, by: t.createdBy, reason: t.note, at: t.due, overdue: t.due < today })),
      ...s.all('notification').filter(n => n.to === scope(a) && appIds.has(n.application)).sort((x, y) => y.at.localeCompare(x.at)),
    ],
    messages, offers, approvals,
    restricted: admin ? s.all('monitoring') : [],
    holds: admin ? s.all('hold') : [],
    retention: admin ? retentionReview(s) : null,
    dataRequests: admin ? s.all('data-request') : [],
    deletionReceipts: admin ? s.all('deletion-receipt') : [],
    duplicates: admin ? duplicateSuggestions(s) : [],
    importedHistory: {
      notes: s.all('imported-note').filter(n => appIds.has(n.application)),
      ratings: s.all('imported-rating').filter(n => appIds.has(n.application)),
      messages: s.all('imported-message').filter(n => applications.some(app => app.id === n.application && managed.some(v => v.id === app.vacancy))),
      members: admin ? s.all('source-member') : [],
    },
    coordination: coordination(s, a),
    audit: admin ? s.all('audit').sort((x, y) => y.at.localeCompare(x.at)).slice(0, 300) : [],
  }
}

export type WorkspaceRecords = Awaited<ReturnType<typeof workspaceRecords>>

export async function workspace(s: State, a: Actor) {
  const records = await workspaceRecords(s, a)
  return { ...records, proposals: s.all('proposal').filter(p => canSeeProposal(s, a, p, records)) }
}

export type Workspace = Awaited<ReturnType<typeof workspace>>
export const visibleIds = (w: Workspace) => new Set<string>([...w.applications, ...w.candidates, ...w.vacancies, ...w.documents].map((r: Data) => r.id))
