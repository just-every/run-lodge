import type { State } from '../core/state'
import { requireApplication, requireManages } from '../core/access'
import { Fault, list, now, oneOf, requireThat, text, type Actor, type Data } from '../core/types'
import { assignReviewers, move } from './pipeline'

// DATA-003, first slice: reviewed bulk actions on applications the actor runs,
// across jobs. A preview runs each item's own command on a copy of the records
// and shows its outcome (for a rejection with an email, the recipient and the
// filled text); apply runs each item again only when its application and
// candidate are at the revisions the preview showed, with the same checks as one
// item at a time. Each item succeeds or is refused on its own and is audited;
// the result counts both. Applying the same batch id again returns the first
// outcome and changes nothing.

export const BULK_KINDS = ['move', 'reject', 'tag', 'reviewers'] as const

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
  return { ...b.action, kind: oneOf(b.action.kind, BULK_KINDS, 'Bulk action') } as Data
}

/** One item through the same command a person would run on it alone; a move names the stage, which each job matches by name. */
function runOne(s: State, a: Actor, act: Data, application: string) {
  if (act.kind === 'move') {
    const app = requireApplication(s, a, application), stage = text(act.stage, 'Stage', 120)
    const to = s.get('vacancy', app.vacancy).stages.find((st: Data) => st.name.toLowerCase() === stage.toLowerCase())
    requireThat(to, `This job has no stage named “${stage}”`, 409)
    return move(s, a, { application, to: to.id, reason: act.reason })
  }
  if (act.kind === 'reject') return move(s, a, { application, to: 'rejected', closeReason: act.closeReason, reason: act.note, send: act.send, template: act.template, businessDays: act.businessDays })
  if (act.kind === 'tag') return tag(s, a, { application, tag: act.tag })
  return assignReviewers(s, a, { application, reviewers: act.reviewers })
}

function items(b: Data) {
  const ids = list(b.items, 'Selected applications', 200, (x, i) => text(x, `Selection ${i + 1}`, 64))
  requireThat(ids.length > 0, 'Select at least one application')
  return [...new Set(ids)]
}

const refusal = (e: unknown) => { if (e instanceof Fault) return e.message; throw e }

/** What each item would become, without changing anything. */
export function bulkPreview(s: State, a: Actor, b: Data) {
  const act = action(b)
  const results = items(b).map(id => {
    const app = s.find('application', id)
    const seen = app ? { application: s.revisionOf('application', id), candidate: s.revisionOf('candidate', app.candidate) } : null
    const copy = s.clone()
    try {
      runOne(copy, a, act, id)
      const email = act.kind === 'reject' ? copy.all('rejection-email').find(m => m.application === id && !s.find('rejection-email', m.id)) : null
      return { application: id, ok: true, seen, candidateName: s.get('candidate', app!.candidate).name, job: s.get('vacancy', app!.vacancy).title, ...(email ? { email: { to: email.to, subject: email.subject, body: email.body, sendAt: email.sendAt } } : {}) }
    } catch (e) {
      // An item the actor may not see answers alike whether it exists or not.
      return { application: id, ok: false, refusal: refusal(e) }
    }
  })
  return { action: act, items: results, ready: results.filter(r => r.ok).length, refused: results.filter(r => !r.ok).length }
}

/** Apply the previewed action item by item; an item changed since its preview is refused, never applied on new data. */
export function bulkApply(s: State, a: Actor, b: Data) {
  const batch = text(b.batch, 'Batch id', 64)
  requireThat(/^[A-Za-z0-9-]{8,64}$/.test(batch), 'Batch id must be 8 to 64 letters, digits or dashes')
  const earlier = s.find('bulk-batch', batch)
  if (earlier) { requireThat(earlier.by === a.email, 'Batch not found', 404); return { ...earlier, replayed: true } }
  const act = action(b), previewed: Data = b.previewed && typeof b.previewed === 'object' ? b.previewed : {}
  const results = items(b).map(id => {
    const seen = previewed[id]
    const app = s.find('application', id)
    try {
      requireThat(seen && app, 'Preview this item before applying', 409)
      requireThat(s.revisionOf('application', id) === seen.application && s.revisionOf('candidate', app!.candidate) === seen.candidate, 'This application or candidate changed since the preview; preview again', 409)
      runOne(s.clone(), a, act, id)
      runOne(s, a, act, id)
      return { application: id, ok: true }
    } catch (e) {
      const why = refusal(e)
      s.audit(a, 'bulk-item-refused', 'application:' + id, { batch, kind: act.kind, refusal: why })
      return { application: id, ok: false, refusal: why }
    }
  })
  const outcome = { batch, by: a.email, at: now(), kind: act.kind, items: results, applied: results.filter(r => r.ok).length, refused: results.filter(r => !r.ok).length }
  s.put('bulk-batch', batch, outcome)
  s.audit(a, 'bulk-applied', 'bulk-batch:' + batch, { kind: act.kind, applied: outcome.applied, refused: outcome.refused })
  return outcome
}
