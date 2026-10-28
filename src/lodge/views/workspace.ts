import { waitingApprovers } from '../records/approval-chains'
import { referenceView } from '../references/views'
import { publicReceipt } from '../careers/receipt'
import { careersDomainView } from '../careers/domain'
import type { Bindings } from '../../auth.server'
import { connectorSummary } from '../connectors/views'
import { referralsView, employerReferrals } from '../referrals/views'
import { employerAgencies } from '../agency/views'
import { fieldProjection, fieldResult } from './fields'
import { blindResult } from '../core/blind'
import { blindProjection } from './blind-review'
import { canSeeProposal } from './proposals'
import type { State } from '../core/state'
import { isCompliance, isComplianceOnly, canSeeCompliance, isAgency, cleared, teamOf, canSeeApproval, canSeeNote, canSeeTeamNote, canSeeApplication, canSeeCandidate, canSeeContact, canSeeDocument, canSeeScorecard, isAdmin, managesVacancy, can, permissionsOn, SEEDED_LEVELS } from '../core/access'
import { requireThat, scope, type Actor, type Data } from '../core/types'
import { latestApproval, versionOf } from '../records/approvals'
import { duplicateSuggestions, transferredFrom } from '../records/candidates'
import { panel, summary, versioned } from '../records/scorecards'
import { funnel, history } from '../records/pipeline'
import { rangeCheck } from '../records/offers'
import { panelView } from '../records/interviews'
import { envelopeView, envelopesOf } from '../esign/envelope'
import { disclosureHistory, signerList, SIGNING_NOTICE } from '../esign/disclosure'
import { retentionReview } from '../records/retention'
import { missingTerms } from '../records/vacancies'
import { coordination } from '../agents/coordination'
import { activity } from './activity'
import { businessToday } from '../records/tasks'
import { interviewerActivity } from './reports'
import { staleDebrief } from '../agents/debriefs'
import { library } from '../records/questions'
import { rulesView } from '../records/rules'
import { rejectionsView } from '../records/rejections'
import { reviewQueues } from '../records/reviews'
import { boardViews } from '../records/board-views'
import { mergeRule, sourceOf } from '../records/sources'
import { boardSettings, publicSettings } from '../records/job-board'
import { internalBoard, internalNotices } from '../records/internal'
import { fairChanceView } from '../records/fair-chance'
import { eventsView } from '../records/events'
import { intakeView } from '../resumes/intake'
import { intakeLifecycleView } from '../resumes/lifecycle'
import { cpraDraft } from '../records/privacy'
import { sandboxesView } from '../operations/sandbox'
import { providerSummary } from '../operations/providers'
import { alertsView, notifyView } from '../notify/view'

/**
 * REQ-003 (ct, 19 Oct): a sourcer sees who is already on the job, as names and
 * current stage only, so they do not source someone twice. Spam, erased and
 * private candidates they are not cleared for are left out.
 */
function sourcingList(s: State, a: Actor, v: Data) {
  return s.all('application').filter(app => app.vacancy === v.id && app.status !== 'spam').flatMap(app => {
    const c = s.find('candidate', app.candidate)
    if (!c || c.deleted || c.mergedInto || !cleared(a, c, 'private')) return []
    return [{ candidateName: c.name, stage: app.status === 'active' ? v.stages.find((st: Data) => st.id === app.stage)?.name ?? '' : app.status }]
  }).sort((x, y) => x.candidateName.localeCompare(y.candidateName))
}

/**
 * What a confidential job or private candidate hides from this reader in
 * admin-wide lists (audit, holds, retention): records they are not cleared for,
 * and records about those.
 */
export function concealer(s: State, a: Actor, appIds: Set<string>) {
  const hiddenCandidate = (id: string) => { const c = s.find('candidate', id); return !!c && !canSeeCandidate(s, a, c) }
  const hiddenVacancy = (id: string) => !cleared(a, s.find('vacancy', id), 'confidential')
  const hiddenApp = (id: string) => { const app = s.find('application', id); return !!app && !appIds.has(id) && (hiddenVacancy(app.vacancy) || hiddenCandidate(app.candidate)) }
  const concealed = (record: string) => {
    const [kind, id] = [record.slice(0, record.indexOf(':')), record.slice(record.indexOf(':') + 1)]
    if (kind === 'vacancy') return hiddenVacancy(id)
    if (kind === 'candidate') return hiddenCandidate(id)
    if (kind === 'application') return hiddenApp(id)
    const subject = (kind === 'offer' || kind === 'message') && s.find(kind, id)
    return !!subject && hiddenApp(subject.application)
  }
  return { hiddenCandidate, hiddenVacancy, hiddenApp, concealed }
}

/**
 * The actor's whole permitted view. The app, search, exports and the agent
 * command surface all read this same projection, so what a person cannot see
 * here they cannot reach any other way.
 */
export async function workspaceRecords(s: State, a: Actor, env?: Bindings) {
  requireThat(!isAgency(a), 'Agency record not found', 404)
  const admin = isAdmin(a)
  const applications = s.all('application').filter(app => canSeeApplication(s, a, app))
  const appIds = new Set(applications.map(x => x.id))
  const myApprovals = s.all('approval').filter(x => canSeeApproval(s, a, x))
  const managed = s.all('vacancy').filter(v => managesVacancy(a, s.get('vacancy', v.id)))
  // REQ-003: a job's sourcers and interview pool see its role, stages and rubric; the people who run it see it all.
  const pooled = (v: Data) => !v.imported && v.status !== 'closed' && (teamOf(v, 'sourcers').includes(scope(a)) || teamOf(v, 'interviewers').includes(scope(a))) && cleared(a, v, 'confidential')
  const visibleVacancyIds = new Set([...managed.map(v => v.id), ...applications.map(x => x.vacancy), ...s.all('vacancy').filter(pooled).map(v => v.id)])

  const vacancies: Data[] = []
  for (const v of s.all('vacancy').filter(v => visibleVacancyIds.has(v.id))) {
    if (managesVacancy(a, v)) {
      const approval = latestApproval(s, 'vacancy', v.id)
      const version = await versionOf(s, 'vacancy', v)
      vacancies.push({ ...v, manages: true, permissions: [...permissionsOn(s, a, v)], version, missing: missingTerms(v), approval: approval ?? null, approvedNow: approval?.status === 'approved' && approval.version === version, funnel: funnel(v, applications) })
    } else {
      // Panel members see the role, its stages and the rubric they score against.
      const sources = teamOf(v, 'sourcers').includes(scope(a))
      vacancies.push({ id: v.id, title: v.title, department: v.department, location: v.location, status: v.status, stages: v.stages, rubrics: v.rubrics, plan: v.plan, manages: false, permissions: [...permissionsOn(s, a, v)], sources, ...(sources ? { pipeline: sourcingList(s, a, v) } : {}) })
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
    // OPS-004: offers stay with the people whose level on the job creates and sees them.
    if (!vacancy || !managesVacancy(a, vacancy) || !can(s, a, vacancy, 'offers')) continue
    const approval = latestApproval(s, 'offer', o.id), version = await versionOf(s, 'offer', o)
    // OFFER-005: the signing envelopes of this offer, without any hash, token or code (and without IPs or user agents for an agent).
    const envelopes = envelopesOf(s, o.id).sort((x, y) => x.sentAt.localeCompare(y.sentAt)).map(e => envelopeView(e, a.agent))
    offers.push({ ...o, version, approval: approval ?? null, approvedNow: approval?.status === 'approved' && approval.version === version, rangeWarning: rangeCheck(vacancy, o), esign: envelopes.at(-1) ?? null, esignHistory: envelopes })
  }

  // OPS-004: a message's recipient is the candidate's email, shown only with "see contact details" on the job.
  const contactOn = (application: string) => { const app = s.all('application').find(x => x.id === application), v = app && s.all('vacancy').find(x => x.id === app.vacancy); return !!v && can(s, a, v, 'contact') }
  const addressed = (x: Data) => x.subjectKind !== 'message' || contactOn(x.terms?.application) ? x : { ...x, terms: { ...x.terms, to: undefined } }
  const messages: Data[] = []
  for (const m of s.all('message').filter(m => appIds.has(m.application))) {
    const app = applications.find(x => x.id === m.application)!
    const vacancy = s.all('vacancy').find(v => v.id === app.vacancy)
    if (!vacancy || !managesVacancy(a, vacancy)) continue
    const approval = latestApproval(s, 'message', m.id), version = await versionOf(s, 'message', m)
    messages.push({ ...m, ...(contactOn(m.application) ? {} : { to: undefined }), version, approval: approval ? addressed(approval) : null, approvedNow: approval?.status === 'approved' && approval.version === version })
  }

  const approvals: Data[] = []
  for (const x of myApprovals) {
    const subject = s.all(x.subjectKind).find(r => r.id === x.subjectId)
    approvals.push({ ...addressed(x), waitingApprovers: waitingApprovers(x), currentVersion: subject ? await versionOf(s, x.subjectKind, subject) : null })
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
      // CRM-008: the list entry the source text resolves to (null while unmapped).
      sourceEntry: sourceOf(s, app.source),
    }
  })
  const interviews = s.all('interview').filter(i => appIds.has(i.application)).map((i): Data => {
    const app = applications.find(x => x.id === i.application)!
    return panelView(a, s.all('vacancy').find(v => v.id === app.vacancy), i)
  })
  const visibleCandidates = new Set(candidates.map(c => c.id))
  const { hiddenCandidate, hiddenVacancy, hiddenApp, concealed } = concealer(s, a, appIds)
  const live = s.all('vacancy').filter(v => !v.imported), active = s.all('application').filter(x => x.status === 'active')
  // Follow-ups and tasks the reader owns or set, while what they point at stays in view.
  const tasks = s.all('task').filter(t => (t.owner === scope(a) || t.createdBy === scope(a)) && (t.application ? appIds.has(t.application) : !t.candidate || visibleCandidates.has(t.candidate))).sort((x, y) => x.due.localeCompare(y.due))
  const today = businessToday(s)
  const movedIn = new Map<string, string>(applications.filter(x => x.activated && !x.activated.undone).map(x => [x.activated.from, x.id]))
  const teamNotes = s.all('team-note').filter(n => visibleCandidates.has(n.candidate) && canSeeTeamNote(s, a, n)).sort((x, y) => x.at.localeCompare(y.at))
  const view = blindProjection(s, a, fieldProjection(s, a, {
    actor: { email: a.email, name: a.name, owner: a.owner, roles: a.roles, agent: a.agent, actsFor: a.scopeAs ?? null },
    business: s.all('business')[0] ?? null,
    careers: admin && !a.agent && s.find('business', 'main') ? { brand: s.find('careers-brand', 'main') ?? null, ...careersDomainView(s, a, env ?? { AUTH_ORIGIN: 'https://unconfigured.invalid' }) } : null,
    connectors: connectorSummary(s, a),
    sandboxes: sandboxesView(s, a), providerSetup: admin && !a.agent ? await providerSummary(s) : null,
    members: s.all('member').map(m => admin ? m : { email: m.email, name: m.name, roles: m.roles, active: m.active }),
    referrals: !a.agent && s.find('business', 'main') ? referralsView(s, a, env ?? ({} as Bindings)) : null, referralReviews: employerReferrals(s, a),
    vacancies, agencies: employerAgencies(s, a),
    // Kickoffs: admins see all; a manager sees their own and those behind the jobs they run.
    kickoffs: s.all('kickoff').filter(k => admin || k.author === scope(a) || managed.some(v => v.id === k.vacancy)),
    applications: projected,
    candidates,
    resumeIntakes: intakeView(s, a),
    ...intakeLifecycleView(s, a),
    resumeExtractions: s.all('resume-extraction').filter(r => { const c = s.find('candidate', r.candidate); return c && canSeeContact(s, a, c) }),
    mergedCandidates: admin ? s.all('candidate').filter(c => c.mergedInto && !hiddenCandidate(c.mergedInto) && !hiddenCandidate(c.id)) : [],
    receipts: admin ? s.all('receipt').filter(r => !hiddenApp(r.application)).map(publicReceipt) : [],
    duplicateReviews: admin ? s.all('duplicate-review').filter(r => !hiddenCandidate(r.first) && !hiddenCandidate(r.second)) : [],
    documents: s.all('document').filter(d => canSeeDocument(s, a, s.get('document', d.id))),
    interviews,
    scorecards: visibleCards,
    notes: s.all('interview-note').filter(n => canSeeNote(s, a, n)),
    teamNotes, activity: activity(s, { applications: projected, messages, interviews, offers, teamNotes }),
    tasks,
    references: referenceView(s, a, appIds),
    // SCREEN-001: the question library, for admins who keep it and managers who attach it.
    questions: library(s, a),
    // REQ-002: job templates, for the admins who keep them and the managers who start jobs from them.
    offerTemplates: admin || a.roles.includes('manager') ? s.all('offer-template') : [],
    // OFFER-005: the reviewed disclosure versions and the designated offer signers, for the people who send offers; the signer reads their own designation notice.
    esign: a.agent || isAgency(a) ? null : { disclosure: disclosureHistory(s), signers: admin || a.roles.includes('manager') ? signerList(s) : [], me: signerList(s).find(x => x.email === a.email) ?? null, notice: SIGNING_NOTICE },
    jobTemplates: admin || a.roles.includes('manager') ? s.all('job-template').sort((x, y) => x.name.localeCompare(y.name)) : [],
    // REQ-004: the department hierarchy and office list, which every member may read.
    departments: s.all('department'), offices: s.all('office'),
    // SCREEN-002: rules and the rule-matches queue, for the people who run the job.
    ...rulesView(s, a, appIds),
    // DISP-001: the reason list for everyone; templates and scheduled rejection emails for the people who run the job.
    ...rejectionsView(s, a, appIds),
    // REVIEW-001: the reader's review queues, shown on their home (HOME-001) and the job's board.
    reviewQueues: reviewQueues(s, a, applications),
    // PIPE-001: the reader's own saved board views (filters, sort, layout) per job.
    boardViews: boardViews(s, a, visibleVacancyIds),
    // CRM-008: the source list every member may read, and the admin's attribution rule after merges.
    sources: s.all('source').sort((x, y) => x.type.localeCompare(y.type) || x.name.localeCompare(y.name)), sourceMergeRule: mergeRule(s),
    // ATTR-009: the public job board's token, allowed origins and keys (never a key's hash), for the people who administer it.
    payRules: admin && !a.agent ? s.find('business', 'main')?.payRules ?? [] : null,
    jobBoard: admin && !a.agent ? publicSettings(boardSettings(s)) : null,
    // CRM-009: the events the reader sees, with their pools (people they may see) and reports.
    events: eventsView(s, a, c => canSeeCandidate(s, a, c)),
    // ATTR-005: the internal job board every person member sees, notices of a report's internal application, and the admins' policy.
    internalBoard: internalBoard(s, a), internalNotices: internalNotices(s, a), internalPolicy: admin ? s.find('internal-policy', 'main') ?? { notifyManager: false } : null,
    // COORD-006 briefs, for the people who run the job (and their agents) only.
    debriefs: s.all('debrief').filter(d => projected.some(app => app.id === d.application && app.manages)).map(d => ({ ...d, stale: staleDebrief(s, d) })),
    notifications: [
      ...tasks.filter(t => t.owner === scope(a) && t.status === 'open' && t.due <= today).map(t => ({ id: 'due:' + t.id, kind: 'task-due', task: t.id, application: t.application, candidate: t.candidate, by: t.createdBy, reason: t.note, at: t.due, overdue: t.due < today })),
      ...s.all('notification').filter(n => n.to === scope(a) && appIds.has(n.application)).sort((x, y) => y.at.localeCompare(x.at)),
    ],
    // TEAM-002/003: the reader's due alerts (mentions among them, shown on HOME-001) and their notification settings.
    alerts: alertsView(s, a), notify: notifyView(s, a),
    // MIG-008: the owner's cutovers of imported jobs into live ones.
    cutovers: a.owner && !a.agent ? s.all('cutover').sort((x, y) => y.at.localeCompare(x.at)) : [],
    applicationEmails: s.all('application-email').filter(m => applications.some(app => app.id === m.application && canSeeContact(s, a, s.get('candidate', app.candidate)))),
    approvalDelegation: !a.agent && (a.owner || a.roles.includes('approver')) ? s.find('approval-delegation', a.email) ?? null : null,
    messages, offers, approvals,
    restricted: isCompliance(a) ? s.all('monitoring').filter(m => { const app = s.find('application', m.application); return !!app && canSeeCompliance(s, a, app) }) : [],
    // HIRE-007: fair-chance places and records are restricted material: the owner and hiring admins (people, not agents) only.
    fairChance: admin ? fairChanceView(s, a, appIds) : null,
    holds: admin ? s.all('hold').filter(h => !(h.candidate && hiddenCandidate(h.candidate)) && !(h.vacancy && hiddenVacancy(h.vacancy))) : [],
    retention: admin ? (r => ({ due: r.due.filter(x => !hiddenCandidate(x.candidate)), held: r.held.filter(x => !hiddenCandidate(x.candidate)) }))(retentionReview(s)) : null,
    dataRequests: admin ? s.all('data-request').filter(r => !hiddenCandidate(r.candidate)).map(({ tokenHash, ...r }) => r) : [],
    // PRIV-001: the current California notice, for the owner who edits it and the admins who answer requests.
    cpraNotice: admin ? cpraDraft(s) : null,
    // OPS-004: the permission levels admins assign (Lodge's seeded ones first).
    permissionLevels: admin ? [...SEEDED_LEVELS, ...s.all('permission-level').sort((x, y) => x.name.localeCompare(y.name))] : [],
    deletionReceipts: admin ? s.all('deletion-receipt') : [],
    duplicates: admin ? duplicateSuggestions(s).filter(d => !hiddenCandidate(d.first) && !hiddenCandidate(d.second)) : [],
    // Counts across the whole business, confidential jobs and private candidates included, without identity.
    totals: admin ? { openVacancies: live.filter(v => v.status === 'open').length, draftVacancies: live.filter(v => v.status === 'draft').length, activeApplications: active.length, candidates: s.all('candidate').filter(c => !c.deleted && !c.mergedInto && !c.imported).length } : null,
    importedHistory: {
      // MIG-008: what was said about an imported application is read on the live application it was moved into.
      notes: s.all('imported-note').filter(n => appIds.has(n.application) || movedIn.has(n.application)).map(n => ({ ...n, application: movedIn.get(n.application) ?? n.application })),
      ratings: s.all('imported-rating').filter(n => appIds.has(n.application) || movedIn.has(n.application)).map(n => ({ ...n, application: movedIn.get(n.application) ?? n.application })),
      messages: s.all('imported-message').map(n => ({ ...n, application: movedIn.get(n.application) ?? n.application })).filter(n => applications.some(app => app.id === n.application && managed.some(v => v.id === app.vacancy))),
      members: admin ? s.all('source-member') : [],
    },
    coordination: coordination(s, a),
    audit: admin ? s.all('audit').filter(e => !concealed(e.record ?? '')).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 300) : [],
  }))
  // Field projection strips restricted custom fields and embedded hiring records.
  // Restore only the independently authorized document metadata, never that hiring data.
  const complianceDocuments = s.all('document').filter(d => d.restricted && canSeeDocument(s, a, s.get('document', d.id)))
  view.documents = [...view.documents.filter(d => !d.restricted), ...complianceDocuments]
  if (isComplianceOnly(a)) {
    // An old team, event or notification assignment must not survive a move
    // from hiring to compliance. Every human keeps their own employee portal.
    const empty = (value: any): any => Array.isArray(value) ? [] : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, empty(item)])) : null
    for (const key of Object.keys(view)) {
      if (['actor', 'business', 'referrals', 'internalBoard'].includes(key)) continue
      ;(view as Data)[key] = empty((view as Data)[key])
    }
    view.vacancies = s.all('vacancy').filter(v => isCompliance(a) && (v.compliancePeople ?? []).includes(scope(a))).map(v => ({ id: v.id, title: v.title, stages: [], rubrics: [], plan: [], manages: false, permissions: [], compliance: true }))
    view.documents = complianceDocuments
    view.restricted = s.all('monitoring').filter(m => { const app = s.find('application', m.application); return !!app && canSeeCompliance(s, a, app) })
  }
  return view
}

export type WorkspaceRecords = Awaited<ReturnType<typeof workspaceRecords>>

export async function workspace(s: State, a: Actor, env?: Bindings) {
  const records = await workspaceRecords(s, a, env)
  if (isComplianceOnly(a)) return { ...records, proposals: [], interviewerActivity: null }
  return { ...records, proposals: s.all('proposal').filter(p => canSeeProposal(s, a, p, records)).map(p => fieldResult(s, a, blindResult(s, a, p, s.find('application', p.sources.find((source: Data) => source.blindApplication)?.blindApplication)))), interviewerActivity: interviewerActivity(s, a, records) }
}

export type Workspace = Awaited<ReturnType<typeof workspace>>
export const visibleIds = (w: Workspace) => new Set<string>([...w.applications, ...w.candidates, ...w.vacancies, ...w.documents].map((r: Data) => r.id))
