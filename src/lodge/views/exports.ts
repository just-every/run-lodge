import { captureList } from '../records/capture'
import { surveyReport } from '../surveys/records'
import { staffSeesReferral } from '../referrals/access'
import { staffSeesSubmission } from '../agency/access'
import { candidateRecords } from '../records/retention'
import type { State } from '../core/state'
import { readBlob } from '../core/store'
import { requireAdmin } from '../core/access'
import { Fault, canonical, now, requireThat, sha256, type Actor, type Data } from '../core/types'
import { mergedCandidates } from '../records/candidate-lineage'
import { workspace, type Workspace } from './workspace'

/**
 * The whole history of one vacancy as the requesting person may see it: the
 * same workspace projection, so restricted documents, monitoring answers and
 * unreleased scorecards stay out of a manager's export.
 */
export function vacancyHistory(w: Workspace, id: string) {
  const vacancy = w.vacancies.find(v => v.id === id)
  if (!vacancy || !vacancy.manages) throw new Fault(404, 'Vacancy not found')
  if (!vacancy.permissions.includes('export')) throw new Fault(403, 'Your permission level on this job does not let you export')
  const applications = w.applications.filter(x => x.vacancy === id)
  const appIds = new Set(applications.map(x => x.id)), candidateIds = new Set(applications.map(x => x.candidate))
  const forApp = (rows: Data[]) => rows.filter(r => appIds.has(r.application))
  return {
    format: 'lodge-vacancy-history-1', exportedAt: now(), exportedBy: w.actor.email,
    vacancy, approvals: w.approvals.filter(x => x.subjectId === id || forApp(w.offers).some(o => o.id === x.subjectId) || forApp(w.messages).some(m => m.id === x.subjectId)),
    applications, candidates: w.candidates.filter(c => candidateIds.has(c.id)),
    sourcingPackets: w.proposals.filter(p => p.workflow === 'sourcing-research' && p.vacancy === id),
    resumeExtractions: w.resumeExtractions.filter(r => candidateIds.has(r.candidate)),
    documents: w.documents.filter(d => appIds.has(d.application) || (candidateIds.has(d.candidate) && !d.application)),
    references: { questionnaires: forApp(w.references.questionnaires), records: forApp(w.references.records) },
    interviewDays: forApp(w.scheduling.drafts),
    takeHomes: { assignments: forApp(w.takeHomes.assignments), submissions: forApp(w.takeHomes.submissions), grades: forApp(w.takeHomes.grades) },
    interviews: forApp(w.interviews), scorecards: forApp(w.scorecards), debriefs: forApp(w.debriefs), applicationEmails: forApp(w.applicationEmails), messages: forApp(w.messages), offers: forApp(w.offers),
    teamNotes: w.teamNotes.filter(n => appIds.has(n.application) || (candidateIds.has(n.candidate) && !n.application)),
    activity: w.activity.filter(e => appIds.has(e.application) || (e.kind === 'note' && candidateIds.has(e.candidate) && !e.application)),
    restricted: forApp(w.restricted), holds: w.holds.filter(h => h.vacancy === id || candidateIds.has(h.candidate)),
    importedHistory: { notes: forApp(w.importedHistory.notes), ratings: forApp(w.importedHistory.ratings), messages: forApp(w.importedHistory.messages) },
    audit: w.audit.filter(e => e.record === 'vacancy:' + id || [...appIds].some(x => e.record === 'application:' + x)),
  }
}

/** One candidate's feed and shared notes, for anyone who can see the candidate, exactly as their workspace shows them. */
export function candidateActivity(w: Workspace, id: string) {
  const candidate = w.candidates.find(c => c.id === id)
  if (!candidate) throw new Fault(404, 'Candidate not found')
  return {
    format: 'lodge-candidate-activity-1', exportedAt: now(), exportedBy: w.actor.email, candidate: { id: candidate.id, name: candidate.name },
    notes: w.teamNotes.filter(n => n.candidate === id), activity: w.activity.filter(e => e.candidate === id),
  }
}

/** The same authorized projection, for an access request, with original document bytes. */
export async function candidateExport(db: D1Database, s: State, a: Actor, id: string, requestId?: string) {
  requireAdmin(a)
  const view = await workspace(s, a)
  const candidate = view.candidates.find(c => c.id === id)
  requireThat(candidate, 'Candidate not found', 404)
  s.get('candidate', id)
  const applications = view.applications.filter(app => app.candidate === id)
  const appIds = new Set(applications.map(app => app.id))
  const byApp = (rows: Data[]) => rows.filter(row => appIds.has(row.application))
  const offers = byApp(view.offers), messages = byApp(view.messages)
  const subjectIds = new Set([...offers, ...messages].map(r => r.id))
  const documents = []
  for (const d of view.documents.filter(d => d.candidate === id || appIds.has(d.application))) {
    const blob = await readBlob(db, d.id)
    requireThat(blob, 'The file bytes are missing', 409)
    documents.push({ ...d, base64: blob.base64 })
  }
  const agencySubmissions = []
  for (const sub of candidateRecords(s, id)['agency-submission'].filter(sub => staffSeesSubmission(s, a, sub))) {
    const files = []
    for (const file of sub.files) { const blob = await readBlob(db, file.id); requireThat(blob, 'The agency original bytes are missing', 409); files.push({ ...file, base64: blob.base64 }) }
    agencySubmissions.push({ ...sub, files })
  }
  const referrals = []
  for (const row of candidateRecords(s, id).referral.filter(r => staffSeesReferral(s, a, r))) {
    const files = []
    for (const file of row.files) { const blob = await readBlob(db, file.id); requireThat(blob, 'The referral original bytes are missing', 409); files.push({ ...file, base64: blob.base64 }) }
    referrals.push({ ...row, files })
  }
  const captures = []
  for (const mail of captureList(s, a, id)) {
    const attachments = []
    for (const file of mail.attachments) {
      const blob = await readBlob(db, file.id)
      requireThat(blob, 'The captured original bytes are missing', 409)
      attachments.push({ ...file, base64: blob.base64 })
    }
    captures.push({ ...mail, attachments })
  }
  const body = {
    captures, agencySubmissions, referrals,
    sourcingPackets: view.proposals.filter(p => p.workflow === 'sourcing-research' && p.candidate === id),
    nurtureSequences: s.all('crm-enrollment').filter(e => e.candidate === id), nurtureReplies: s.all('crm-reply').filter(reply => reply.candidate === id),
    hiringReminders: s.all('hiring-reminder').filter(reminder => appIds.has(reminder.application)),
    surveyResponses: surveyReport(s, a).surveys.flatMap(survey => survey.identified.filter(answer => appIds.has(answer.application)).map(answer => ({ ...answer, survey: survey.id, version: survey.version }))),
    format: 'lodge-candidate-export-1', exportedAt: now(), exportedBy: a.email,
    candidate, mergedCandidates: mergedCandidates(view.mergedCandidates, id),
    'reference-questionnaire': byApp(view.references.questionnaires), 'reference-record': byApp(view.references.records),
    'take-home': byApp(view.takeHomes.assignments), 'take-home-submission': byApp(view.takeHomes.submissions), 'take-home-grade': byApp(view.takeHomes.grades),
    application: applications, 'stage-event': applications.flatMap(app => app.history),
    'interview-day': byApp(view.scheduling.drafts),
    interview: byApp(view.interviews), scorecard: byApp(view.scorecards), debrief: byApp(view.debriefs), 'interview-note': byApp(view.notes),
    'team-note': view.teamNotes.filter(n => n.candidate === id), activity: view.activity.filter(e => e.candidate === id),
    'application-email': byApp(view.applicationEmails), message: messages, offer: offers, receipt: byApp(view.receipts), monitoring: byApp(view.restricted), 'fair-chance-record': byApp(view.fairChance?.records ?? []),
    approval: view.approvals.filter(r => subjectIds.has(r.subjectId)), document: documents,
    'resume-extraction': view.resumeExtractions.filter(r => r.candidate === id),
    'blind-identity': s.all('blind-identity').filter(r => r.candidate === id),
    'duplicate-review': view.duplicateReviews.filter(r => r.first === id || r.second === id),
    'imported-note': byApp(view.importedHistory.notes), 'imported-rating': byApp(view.importedHistory.ratings), 'imported-message': byApp(view.importedHistory.messages),
    dataRequests: view.dataRequests.filter(r => r.candidate === id),
  }
  const digest = await sha256(canonical(body))
  if (requestId) {
    const request = s.get('data-request', requestId)
    requireThat(request.candidate === id && request.status === 'open', 'Choose an open request for this candidate', 409)
    s.put('data-request', request.id, { ...request, status: 'complete', completedBy: a.email, completedAt: now(), outcome: `Export provided (sha256 ${digest})`, exportDigest: digest })
  }
  s.audit(a, 'candidate-exported', 'candidate:' + id, { digest, request: requestId ?? null })
  return { body, digest }
}

/**
 * DATA-003 bulk data export: the selected applications exactly as the
 * requester's workspace shows them (restricted material, unreleased scorecards
 * and private notes stay out as they do there). Document entries carry their
 * details, not their bytes.
 */
export function bulkExport(w: Workspace, ids: string[]) {
  const items = ids.map(id => {
    const application = w.applications.find(x => x.id === id)
    if (!application) throw new Fault(404, 'Application not found')
    const forApp = (rows: Data[]) => rows.filter(r => r.application === id)
    return {
      application, vacancy: (v => ({ id: v.id, title: v.title, department: v.department, location: v.location }))(w.vacancies.find(v => v.id === application.vacancy)!),
      candidate: w.candidates.find(c => c.id === application.candidate),
      documents: w.documents.filter(d => d.application === id || (d.candidate === application.candidate && !d.application)),
      references: { questionnaires: forApp(w.references.questionnaires), records: forApp(w.references.records) },
      interviewDays: forApp(w.scheduling.drafts),
      takeHomes: { assignments: forApp(w.takeHomes.assignments), submissions: forApp(w.takeHomes.submissions), grades: forApp(w.takeHomes.grades) },
      interviews: forApp(w.interviews), scorecards: forApp(w.scorecards), applicationEmails: forApp(w.applicationEmails), messages: forApp(w.messages), offers: forApp(w.offers),
      teamNotes: w.teamNotes.filter(n => n.application === id || (n.candidate === application.candidate && !n.application)),
      activity: w.activity.filter(e => e.application === id),
    }
  })
  return { format: 'lodge-bulk-export-1', exportedAt: now(), exportedBy: w.actor.email, items }
}
