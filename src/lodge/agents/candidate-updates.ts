import type { State } from '../core/state'
import { can, canSeeApplication, managesVacancy, requireCan, requireManages } from '../core/access'
import { blindFor } from '../core/blind'
import { businessZone, isZone } from '../core/time'
import { canonical, integer, now, oneOf, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'
import { delayHuman } from '../views/delay-analysis'
import { addBusinessDays } from '../records/rejections'
import { templateMessage } from '../records/message-templates'
import { message } from '../records/messages'

export const UPDATE_WINDOW_RULE = 'Count Monday through Friday, excluding the event day, at the same local wall time in the configured business zone. Saturdays and Sundays are skipped; public holidays are not. Daylight saving changes the UTC offset, not the local deadline. Zero days means the event instant. A window is overdue at its deadline. Native timing is not verified mailbox silence or attendance.'
const SETS = ['stage-event', 'interview', 'rejection-email', 'hold']
const same = (x: unknown, y: unknown) => canonical(x) === canonical(y)

export function configureCandidateUpdates(s: State, a: Actor, b: Data) {
  requireThat(!a.agent, 'A human configures candidate update evidence', 403)
  const job = s.get('vacancy', b.vacancy)
  requireManages(a, job); requireCan(s, a, job, 'settings'); requireCan(s, a, job, 'contact')
  requireThat(!job.imported && job.status !== 'closed', 'Choose an active native job', 409)
  const current = s.find('candidate-update-policy', job.id)
  requireThat((b.revision ?? null) === s.revisionOf('candidate-update-policy', job.id), 'Response window changed; reload Settings', 409)
  const zone = b.timeZone ?? businessZone(s.get('business', 'main'))
  requireThat(isZone(zone), 'Choose a valid business time zone')
  const templates = [b.statusTemplate, b.rejectionTemplate].map(id => s.get('message-template', id))
  requireThat(templates.every(t => t.vacancy === job.id), 'Update templates must belong to this job')
  requireThat(templates[0].versions.every((v: Data) => v.purpose === 'other') && templates[1].versions.every((v: Data) => v.purpose === 'rejection'), 'Choose a status template and a rejection template with the corresponding purpose')
  const record = s.put('candidate-update-policy', job.id, { vacancy: job.id, businessDays: integer(b.businessDays, 'Business days', 0, 30), timeZone: zone, statusTemplate: templates[0].id, rejectionTemplate: templates[1].id, version: (current?.version ?? 0) + 1, reviewedBy: a.email, reviewedAt: now() })
  s.audit(a, 'candidate-update-window-reviewed', 'vacancy:' + job.id)
  return record
}

/** Current contact authority, including confidential jobs, private candidates and blind review. */
function allowed(s: State, a: Actor, app: Data) {
  const job = s.find('vacancy', app.vacancy), candidate = s.find('candidate', app.candidate)
  return !!job && !!candidate && !candidate.deleted && !candidate.mergedInto && managesVacancy(a, job)
    && can(s, a, job, 'contact') && canSeeApplication(s, a, app) && !blindFor(s, a, app)
}
function contactable(s: State, app: Data) {
  const candidate = s.get('candidate', app.candidate), job = s.get('vacancy', app.vacancy)
  if (candidate.deleted || candidate.mergedInto || !candidate.email || candidate.doNotContact || candidate.optedOut || (candidate.contactPreference && candidate.contactPreference.preference !== 'email')) return false
  if (app.candidateWithdrawnAt || !['active', 'rejected'].includes(app.status) || app.imported || job.imported || job.status === 'closed' || (app.activated && app.contactBasis?.basis !== 'application')) return false
  return !s.all('hold').some(h => h.status === 'active' && (h.candidate === candidate.id || h.vacancy === job.id))
}
const source = (s: State, kind: string, id: string) => { s.get(kind, id); return { kind, id, revision: s.revisionOf(kind, id) } }

/** The evidence says only what was recorded locally. Absence of mail observations stays unknown. */
export function candidateUpdateEvidence(s: State, a: Actor, application: string): Data {
  const app = s.get('application', application)
  requireThat(allowed(s, a, app), 'Candidate update not found', 404)
  requireThat(contactable(s, app), 'Candidate update is excluded by current contact, lifecycle or hold state', 409)
  const policy = s.get('candidate-update-policy', app.vacancy, 'response window')
  const events = s.all('stage-event').filter(e => e.application === app.id)
  const interviews = s.all('interview').filter(iv => iv.application === app.id)
  const rejections = s.all('rejection-email').filter(m => m.application === app.id)
  const last = events.filter(e => e.to === (app.status === 'active' ? app.stage : app.status) && Number.isFinite(Date.parse(e.at))).sort((x, y) => y.at.localeCompare(x.at) || y.id.localeCompare(x.id))[0]
  requireThat(last && last.to === (app.status === 'active' ? app.stage : app.status), 'Native stage history is incomplete; no response window is inferred', 409)
  let anchor = { kind: 'stage-event', id: last.id, at: last.at, label: 'Recorded native stage entry' }, pending: Data | undefined
  if (app.status === 'rejected') {
    const decider = s.find('member', last.actor)
    requireThat(decider && !decider.agent && last.closeGroup === 'rejected' && !last.rule, 'Only an already recorded human rejection can supply a rejection update', 409)
    pending = rejections.filter(m => m.status === 'scheduled' && m.scheduledBy === last.actor && m.scheduledAt === last.at).at(-1)
    requireThat(pending && pending.to === s.get('candidate', app.candidate).email && pending.sendAt <= now(), 'No existing due, unsent DISP-001 email for this human rejection', 409)
  } else {
    for (const iv of interviews) {
      if (iv.status !== 'scheduled' || !Number.isFinite(Date.parse(iv.start)) || !Number.isInteger(iv.durationMinutes)) continue
      const end = new Date(Date.parse(iv.start) + iv.durationMinutes * 60000).toISOString()
      if (end <= now() && end > anchor.at) anchor = { kind: 'interview', id: iv.id, at: end, label: 'Scheduled native interview end; attendance unverified' }
    }
  }
  const template = s.get('message-template', pending ? policy.rejectionTemplate : policy.statusTemplate)
  const draft = templateMessage(s, a, { id: template.id, revision: s.revisionOf('message-template', template.id) }, app.id)
  requireThat(draft.purpose === (pending ? 'rejection' : 'other'), 'The reviewed language version has the wrong update purpose', 409)
  if (pending) requireThat(draft.subject === pending.subject && draft.body === pending.body, 'The reviewed application-language text must match the existing DISP-001 email exactly; no new disposition or reason', 409)
  const sources = [source(s, 'business', 'main'), source(s, 'vacancy', app.vacancy), source(s, 'candidate', app.candidate), source(s, 'application', app.id), source(s, 'candidate-update-policy', policy.id), source(s, 'message-template', template.id), ...events.map(e => source(s, 'stage-event', e.id)), ...interviews.map(iv => source(s, 'interview', iv.id)), ...rejections.map(m => source(s, 'rejection-email', m.id))].sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id))
  const dueAt = addBusinessDays(anchor.at, policy.businessDays, policy.timeZone)
  return { application: app.id, candidate: app.candidate, name: s.get('candidate', app.candidate).name, vacancy: app.vacancy, kind: pending ? 'recorded-rejection' : 'status-update', anchor, dueAt, overdue: dueAt <= now(), businessDays: policy.businessDays, timeZone: policy.timeZone, rule: UPDATE_WINDOW_RULE, mailbox: 'unknown', delivery: 'unverified', sent: false, complete: false, rejectionEmail: pending?.id ?? null, sources, ...draft }
}

export function candidateUpdatesView(s: State, a: Actor) {
  const jobs = s.all('vacancy').filter(job => !job.imported && job.status !== 'closed' && managesVacancy(a, job) && can(s, a, job, 'contact'))
  const policies: Data[] = jobs.flatMap(job => { const p = s.find('candidate-update-policy', job.id); return p ? [{ ...p, revision: s.revisionOf('candidate-update-policy', p.id) }] : [] })
  const cases = s.all('application').filter(app => policies.some(p => p.vacancy === app.vacancy) && allowed(s, a, app) && contactable(s, app)).flatMap(app => {
    try { return [candidateUpdateEvidence(s, a, app.id)] } catch { return [] }
  })
  return { policies, cases, rule: UPDATE_WINDOW_RULE, mailbox: 'unknown', delivery: 'unverified' }
}

/** Losing either preparing or reviewing authority hides every word of the retained packet. */
export function canSeeCandidateUpdate(s: State, a: Actor, p: Data) {
  const agent = s.find('member', p.proposedBy), principal = delayHuman(s, p.proposedFor), reviewer = delayHuman(s, p.approver), app = s.find('application', p.update.application)
  return !!agent?.active && agent.agent && agent.actsFor === p.proposedFor && !!principal && !!reviewer && !!app
    && ([p.proposedBy, p.proposedFor, p.approver].includes(a.email) || a.owner)
    && [a, principal, reviewer].every(actor => allowed(s, actor, app)) && contactable(s, app)
}
function fenceSets(s: State) { for (const kind of SETS) s.scan(kind) }
function currentEvidence(s: State, a: Actor, update: Data) {
  const fresh = candidateUpdateEvidence(s, a, update.application)
  requireThat(fresh.overdue && same(fresh.sources, update.sources) && same(fresh.anchor, update.anchor) && fresh.subject === update.subject && fresh.body === update.body, 'Candidate evidence or reviewed language changed; request a fresh proposal', 409)
  return fresh
}

export function proposeCandidateUpdate(s: State, a: Actor, b: Data) {
  requireThat(a.agent, 'A signed-in external agent authors candidate update proposals', 403)
  const approver = text(b.approver, 'Human reviewer').toLowerCase(), reviewer = delayHuman(s, approver)
  requireThat(reviewer, 'Choose a current human reviewer', 403)
  const update = candidateUpdateEvidence(s, a, b.application), reviewed = candidateUpdateEvidence(s, reviewer, b.application)
  requireThat(update.overdue && same(update.sources, reviewed.sources), 'The shared recorded response window is not overdue', 409)
  requireThat(same(b.sources, update.sources), 'Sources changed or are incomplete; read fresh candidate update evidence', 409)
  requireThat(b.subject === update.subject && b.body === update.body, 'The agent draft must use the exact reviewed application-language text; no invented reason', 409)
  const packet = { workflow: 'candidate-update', summary: 'Candidate update for ' + update.name, update, sources: update.sources, changes: [], citations: [], missing: [], rationale: '', approver, proposedBy: a.email, proposedFor: scope(a), proposedByAgent: true, proposedAt: now(), status: 'proposed', model: null }
  requireThat(canSeeCandidateUpdate(s, a, packet) && canSeeCandidateUpdate(s, reviewer, packet), 'Candidate update outside current authority', 403)
  fenceSets(s)
  // One packet per exact source snapshot, even if an external agent changes its retry identifier.
  const previous = s.scan('proposal').find(p => p.workflow === 'candidate-update' && p.update.application === update.application && same(p.sources, update.sources))
  if (previous) { requireThat(canSeeCandidateUpdate(s, a, previous), 'Existing candidate update not found', 404); return previous }
  const result = s.put('proposal', uid(), packet)
  s.audit(a, 'candidate-update-proposed', 'proposal:' + result.id, { application: update.application })
  return result
}

export function decideCandidateUpdate(s: State, a: Actor, p: Data, b: Data) {
  requireThat(!a.agent && a.email === p.approver, 'Only the named human reviewer decides this update', 403)
  requireThat(canSeeCandidateUpdate(s, a, p), 'Candidate update not found', 404)
  const decision = oneOf(b.decision, ['accepted', 'rejected'] as const, 'Draft decision'), reason = text(b.reason, 'Review reason', 2000)
  if (p.status !== 'proposed') { requireThat(p.status === decision, 'This update was already decided', 409); return p }
  let draft: Data | undefined
  if (decision === 'accepted') {
    const current = currentEvidence(s, a, p.update)
    const principal = delayHuman(s, p.proposedFor)!
    currentEvidence(s, principal, p.update)
    fenceSets(s)
    // A different agent or renewed evidence must not prepare another copy of the same native wait.
    const previous = s.scan('message').find(m => m.candidateUpdate?.application === current.application && m.candidateUpdate.anchor.kind === current.anchor.kind && m.candidateUpdate.anchor.id === current.anchor.id)
    requireThat(!previous, 'An unsent update draft already exists for this native event', 409)
    draft = message(s, a, { application: current.application, purpose: current.purpose, subject: current.subject, body: current.body })
    s.put('message', draft.id, { ...draft, templateDraft: current.templateDraft, candidateUpdate: { ...p, update: current, application: current.application, anchor: current.anchor }, sent: false, delivery: 'unverified', complete: false })
  }
  const result = s.put('proposal', p.id, { ...p, status: decision, decidedBy: a.email, decidedAt: now(), reason, results: draft ? [draft.id] : [] })
  s.audit(a, 'candidate-update-' + decision, 'proposal:' + p.id, { application: p.update.application })
  return result
}

/** LDG-010 approval and EML remain separate; neither establishes sending or completion. */
export function requireCurrentCandidateUpdate(s: State, a: Actor, m: Data) {
  if (!m.candidateUpdate) return
  const p = m.candidateUpdate
  requireThat(canSeeCandidateUpdate(s, a, p), 'Candidate update no longer has current contact or review authority', 409)
  currentEvidence(s, a, p.update)
  currentEvidence(s, delayHuman(s, p.proposedFor)!, p.update)
  requireThat(m.to === p.update.to && m.subject === p.update.subject && m.body === p.update.body, 'Update text changed; prepare a new reviewed candidate update', 409)
  fenceSets(s)
}
