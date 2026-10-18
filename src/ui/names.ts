import type { D } from './shared'

// People and records are shown by name. A raw key or id is never the visible text;
// where one helps (an audit row), it stays in a title attribute and in the exports.

/** A member's name for an email address, or the address when it belongs to no member. */
export const person = (w: D, email?: string) => !email ? '' : email === 'public' || email === 'applicant' ? 'Applicant' : w.members.find((m: D) => m.email === email)?.name || email
export const people = (w: D, emails: string[]) => emails.map(e => person(w, e)).join(', ')

/** "approval-requested" → "Approval requested". */
const PHRASES: D = { 'approval-approved': 'Approved', 'approval-rejected': 'Rejected', 'import-commit': 'Import committed', 'import-undo': 'Import undone', 'import-resume': 'Import resumed', 'interview-plan': 'Interview plan saved', 'rubric-version': 'Rubric version saved', 'data-request': 'Candidate request recorded', 'data-request-complete': 'Candidate request completed', 'interview-note': 'Interview note saved', 'candidate-availability': 'Candidate availability recorded' }
export const phrase = (key: string) => PHRASES[key] ?? sentence(key.replace(/-/g, ' '))
export const sentence = (text: string) => text ? text[0].toUpperCase() + text.slice(1) : text

export const KINDS: D = { message: 'Message', vacancy: 'Vacancy', offer: 'Offer' }

/** The record an audit entry points at ("offer:<id>"), named from the workspace. */
export function recordName(w: D, ref: string) {
  const at = ref.indexOf(':'), kind = ref.slice(0, at), id = ref.slice(at + 1)
  const find = (list: D[] | undefined) => list?.find((x: D) => x.id === id)
  const vacancy = (vid: string) => w.vacancies.find((v: D) => v.id === vid)?.title
  const application = (aid: string) => { const a = w.applications.find((x: D) => x.id === aid); return a && [a.candidateName, vacancy(a.vacancy)].filter(Boolean).join(' · ') }
  const candidate = (cid: string) => w.candidates.find((c: D) => c.id === cid)?.name
  let name: string | undefined
  if (kind === 'vacancy') name = vacancy(id)
  else if (kind === 'application') name = application(id)
  else if (kind === 'candidate') name = candidate(id)
  else if (kind === 'offer') { const o = find(w.offers); name = o && 'Offer · ' + (application(o.application) ?? o.title) }
  else if (kind === 'message') { const m = find(w.messages); name = m && 'Message · ' + m.subject }
  else if (kind === 'interview') { const i = find(w.interviews), a = i && w.applications.find((x: D) => x.id === i.application); name = i && [w.vacancies.find((v: D) => v.id === a?.vacancy)?.plan?.find((p: D) => p.id === i.planItem)?.name ?? i.title, application(i.application)].filter(Boolean).join(' · ') }
  else if (kind === 'document') name = find(w.documents)?.name
  else if (kind === 'member') name = person(w, id)
  else if (kind === 'business') name = w.business?.name
  else if (kind === 'hold') { const h = find(w.holds); name = h && 'Legal hold · ' + (h.candidate ? candidate(h.candidate) : vacancy(h.vacancy)) }
  else if (kind === 'data-request') { const r = find(w.dataRequests); name = r && 'Candidate request · ' + (r.candidateName ?? 'deleted candidate') }
  else if (kind === 'proposal') name = find(w.proposals)?.summary
  else if (kind === 'import') { const j = w.importJobs?.find((x: D) => x.id === id); name = 'Workable import' + (j?.package ? ' · ' + j.package : '') }
  return name || `${sentence(kind.replace(/-/g, ' '))} (no longer in the workspace)`
}

/** The chip tone of an approval, offer or proposal status, the same everywhere. */
export const tone = (status: string): 'good' | 'warn' | 'neutral' => ['approved', 'accepted', 'applied', 'submitted'].includes(status) ? 'good' : status === 'pending' ? 'warn' : 'neutral'
