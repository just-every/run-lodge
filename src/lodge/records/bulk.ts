import type { State } from '../core/state'
import { requireApplication, requireManages } from '../core/access'
import { Fault, canonical, list, now, oneOf, optionalText, requireThat, sha256, text, type Actor, type Data } from '../core/types'
import { bulkExport } from '../views/exports'
import { workspace } from '../views/workspace'
import { requestApproval } from './approvals'
import { message, PURPOSES } from './messages'
import { assignReviewers, move } from './pipeline'
import { fill, MERGE_FIELDS, reasons } from './rejections'

// DATA-003: reviewed bulk actions on applications the actor runs, across jobs.
// A preview runs each item's own command on a copy of the records and shows its
// outcome (for a rejection email or a personalized message, the recipient and
// the filled text); apply runs each item again only when its application and
// candidate are at the revisions the preview showed, with the same checks as one
// item at a time. Each item succeeds or is refused on its own and is audited;
// the result counts both. Applying the same batch id again returns the first
// outcome and changes nothing.
//
// Archive closes an application with a listed DISP-001 reason (either group)
// and never an email. Export downloads the selected applications as the actor's
// workspace shows them. A personalized message is an LDG-010 draft per
// candidate, approved as exact text and downloaded unsent: Lodge sends nothing
// until COM-001 connects a mailbox.

export const BULK_KINDS = ['move', 'reject', 'archive', 'tag', 'reviewers', 'export', 'message'] as const

/** DATA-003 tagging: the people who run the job add a tag to an application. */
function tag(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  const label = text(b.tag, 'Tag', 60)
  requireThat(!(app.tags ?? []).includes(label), `Already tagged “${label}”`, 409)
  const record = s.put('application', app.id, { ...app, tags: [...(app.tags ?? []), label] })
  s.audit(a, 'tag-added', 'application:' + app.id, { tag: label })
  return record
}

function action(b: Data) {
  requireThat(b.action && typeof b.action === 'object', 'Choose the action')
  const act = { ...b.action, kind: oneOf(b.action.kind, BULK_KINDS, 'Bulk action') } as Data
  if (act.kind === 'message') {
    act.purpose = oneOf(act.purpose ?? 'other', PURPOSES, 'Purpose')
    act.subject = text(act.subject, 'Subject', 200)
    act.body = text(act.body, 'Message', 20000)
    for (const field of `${act.subject} ${act.body}`.match(/\{[^{}]*\}/g) ?? [])
      requireThat((MERGE_FIELDS as readonly string[]).includes(field.slice(1, -1)), `Unknown merge field ${field}; use ${MERGE_FIELDS.map(f => `{${f}}`).join(', ')}`)
    act.approver = optionalText(act.approver, 'Approver', 200) || undefined
  }
  return act
}

/** One item through the same command a person would run on it alone; a move names the stage, which each job matches by name. */
async function runOne(s: State, a: Actor, act: Data, application: string) {
  if (act.kind === 'move') {
    const app = requireApplication(s, a, application), stage = text(act.stage, 'Stage', 120)
    const to = s.get('vacancy', app.vacancy).stages.find((st: Data) => st.name.toLowerCase() === stage.toLowerCase())
    requireThat(to, `This job has no stage named “${stage}”`, 409)
    return move(s, a, { application, to: to.id, reason: act.reason })
  }
  if (act.kind === 'reject') return move(s, a, { application, to: 'rejected', closeReason: act.closeReason, reason: act.note, send: act.send, template: act.template, businessDays: act.businessDays })
  if (act.kind === 'archive') {
    const reason = reasons(s).find(r => r.id === act.closeReason)
    requireThat(reason, 'Choose why: a reason from the list')
    return move(s, a, { application, to: reason.group === 'withdrew' ? 'withdrawn' : 'rejected', closeReason: reason.id, reason: act.note })
  }
  if (act.kind === 'tag') return tag(s, a, { application, tag: act.tag })
  if (act.kind === 'reviewers') return assignReviewers(s, a, { application, reviewers: act.reviewers })
  const app = requireApplication(s, a, application), vacancy = s.get('vacancy', app.vacancy)
  requireManages(a, vacancy)
  if (act.kind === 'export') return app
  // The contact preference Lodge holds today is the email on record (COM-002 opt-outs inherit this refusal).
  const candidate = s.get('candidate', app.candidate)
  requireThat(candidate.email, 'This candidate has no email address', 409)
  const values = { candidate_name: candidate.name, job_title: vacancy.title, business_name: s.find('business', 'main')?.name ?? '' }
  const draft = message(s, a, { application, purpose: act.purpose, to: candidate.email, subject: fill(act.subject, values), body: fill(act.body, values) })
  if (act.approver) await requestApproval(s, a, 'message', draft, act.approver)
  return draft
}

function items(b: Data) {
  const ids = list(b.items, 'Selected applications', 200, (x, i) => text(x, `Selection ${i + 1}`, 64))
  requireThat(ids.length > 0, 'Select at least one application')
  return [...new Set(ids)]
}

const refusal = (e: unknown) => { if (e instanceof Fault) return e.message; throw e }

/** The email a rejection would schedule or the message draft it would write, as the preview shows it. */
function outgoing(s: State, copy: State, act: Data, id: string) {
  const kind = act.kind === 'reject' ? 'rejection-email' : act.kind === 'message' ? 'message' : null
  const m = kind && copy.all(kind).find(x => x.application === id && !s.find(kind, x.id))
  return m ? { email: { to: m.to, subject: m.subject, body: m.body, ...(m.sendAt ? { sendAt: m.sendAt } : { sent: false }) } } : {}
}

/** What each item would become, without changing anything. */
export async function bulkPreview(s: State, a: Actor, b: Data) {
  const act = action(b)
  const results = []
  for (const id of items(b)) {
    const app = s.find('application', id)
    const seen = app ? { application: s.revisionOf('application', id), candidate: s.revisionOf('candidate', app.candidate) } : null
    const copy = s.clone()
    try {
      await runOne(copy, a, act, id)
      results.push({ application: id, ok: true, seen, candidateName: s.get('candidate', app!.candidate).name, job: s.get('vacancy', app!.vacancy).title, ...outgoing(s, copy, act, id) })
    } catch (e) {
      // An item the actor may not see answers alike whether it exists or not.
      results.push({ application: id, ok: false, refusal: refusal(e) })
    }
  }
  return { action: act, items: results, ready: results.filter(r => r.ok).length, refused: results.filter(r => !r.ok).length }
}

/** Apply the previewed action item by item; an item changed since its preview is refused, never applied on new data. */
export async function bulkApply(s: State, a: Actor, b: Data) {
  const batch = text(b.batch, 'Batch id', 64)
  requireThat(/^[A-Za-z0-9-]{8,64}$/.test(batch), 'Batch id must be 8 to 64 letters, digits or dashes')
  const earlier = s.find('bulk-batch', batch)
  if (earlier) { requireThat(earlier.by === a.email, 'Batch not found', 404); return { ...earlier, replayed: true } }
  const act = action(b), previewed: Data = b.previewed && typeof b.previewed === 'object' ? b.previewed : {}
  const results = []
  for (const id of items(b)) {
    const seen = previewed[id]
    const app = s.find('application', id)
    try {
      requireThat(seen && app, 'Preview this item before applying', 409)
      requireThat(s.revisionOf('application', id) === seen.application && s.revisionOf('candidate', app!.candidate) === seen.candidate, 'This application or candidate changed since the preview; preview again', 409)
      await runOne(s.clone(), a, act, id)
      await runOne(s, a, act, id)
      results.push({ application: id, ok: true })
    } catch (e) {
      const why = refusal(e)
      s.audit(a, 'bulk-item-refused', 'application:' + id, { batch, kind: act.kind, refusal: why })
      results.push({ application: id, ok: false, refusal: why })
    }
  }
  const outcome: Data = { batch, by: a.email, at: now(), kind: act.kind, items: results, applied: results.filter(r => r.ok).length, refused: results.filter(r => !r.ok).length }
  // The export file is handed back once and never kept: a replay returns the outcome without it.
  let file: Data | null = null
  if (act.kind === 'export') {
    file = bulkExport(await workspace(s, a), results.filter(r => r.ok).map(r => r.application))
    outcome.digest = await sha256(canonical(file))
  }
  s.put('bulk-batch', batch, outcome)
  s.audit(a, act.kind === 'export' ? 'bulk-exported' : 'bulk-applied', 'bulk-batch:' + batch, { kind: act.kind, applied: outcome.applied, refused: outcome.refused, ...(outcome.digest ? { digest: outcome.digest } : {}) })
  return file ? { ...outcome, file } : outcome
}
