import type { Workspace } from './workspace'
import type { State } from '../core/state'
import { Fault, now, requireThat, type Data } from '../core/types'
import { latestApproval, versionOf } from '../records/approvals'
import { history } from '../records/pipeline'
import { rangeCheck } from '../records/offers'

function offerContext(w: Workspace, id: string) {
  const offer = w.offers.find(o => o.id === id)
  if (!offer) throw new Fault(404, 'Offer not found')
  const application = w.applications.find(a => a.id === offer.application)!
  const vacancy = w.vacancies.find(v => v.id === application.vacancy)!
  const candidate = w.candidates.find(c => c.id === application.candidate)!
  return { offer, application, vacancy, candidate }
}

/**
 * The offer's approval packet. A vacancy manager reads it from their workspace projection; the person asked to
 * approve the offer, who may see nothing else of the application, reads the same packet built from the offer's
 * own records, with only the released scorecards.
 */
export async function packet(s: State, w: Workspace, id: string) {
  if (w.offers.some(o => o.id === id)) {
    const { offer, application: app, vacancy, candidate } = offerContext(w, id)
    return packetOf(offer, app, vacancy, candidate, w.scorecards.filter(c => c.application === app.id && c.status === 'submitted'), w.interviews, w.approvals)
  }
  requireThat(w.approvals.some(x => x.subjectKind === 'offer' && x.subjectId === id), 'Offer not found', 404)
  const stored = s.get('offer', id), app = s.get('application', stored.application), vacancy = s.get('vacancy', app.vacancy)
  const approval = latestApproval(s, 'offer', id), version = await versionOf(s, 'offer', stored)
  const offer = { ...stored, version, approval: approval ?? null, approvedNow: approval?.status === 'approved' && approval.version === version, rangeWarning: rangeCheck(vacancy, stored) }
  const released = app.feedbackReleased === true ? s.all('scorecard').filter(c => c.application === app.id && c.status === 'submitted') : []
  return packetOf(offer, { ...app, history: history(s, app.id) }, vacancy, s.get('candidate', app.candidate), released, s.all('interview'), w.approvals)
}

function packetOf(offer: Data, app: Data, vacancy: Data, candidate: Data, scorecards: Data[], interviews: Data[], approvals: Data[]) {
  return {
    offer, rangeWarning: offer.rangeWarning, candidate: { id: candidate.id, name: candidate.name },
    vacancy: { id: vacancy.id, title: vacancy.title, compensation: vacancy.compensation, headcount: vacancy.headcount, hires: vacancy.hires ?? 0, manager: vacancy.manager },
    rubric: vacancy.rubrics.find((r: { version: number }) => r.version === app.rubricVersion), history: app.history,
    scorecards, feedbackReleased: app.feedbackReleased === true,
    interviews: interviews.filter(i => i.application === app.id).map(i => ({ title: i.title, status: i.status, start: i.start ?? null, participants: i.participants })),
    approvals: approvals.filter(x => x.subjectId === offer.id || x.subjectId === vacancy.id), approval: offer.approval,
  }
}

export function handoff(w: Workspace, id: string) {
  const { offer: o, application: app, vacancy, candidate } = offerContext(w, id)
  requireThat(o.status === 'accepted', 'Only an accepted offer has an HR handoff', 409)
  return {
    format: 'lodge-hr-handoff-1', exportedAt: now(), exportedBy: w.actor.email,
    person: { name: candidate.name, email: candidate.email, phone: candidate.phone, location: candidate.location },
    role: { title: o.title, department: vacancy.department, manager: vacancy.manager, location: vacancy.location, workMode: vacancy.workMode, employmentType: vacancy.employmentType },
    pay: o.salary, startDate: o.startDate, terms: o.terms, offerAcceptedAt: o.outcomeAt,
    documents: w.documents.filter(d => d.candidate === candidate.id && (d.application === app.id || !d.application)).map(d => ({ id: d.id, name: d.name, kind: d.kind, sha256: d.sha256, restricted: d.restricted })),
    note: 'Lodge records the hiring decision only. Contracts, payroll and right-to-work checks happen in your HR process.',
  }
}
