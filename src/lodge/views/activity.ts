import type { WorkspaceRecords } from './workspace'
import { proposalApplications } from './proposals'
import type { State } from '../core/state'
import type { Data } from '../core/types'

/**
 * Each visible candidate's activity feed, built only from what the reader's
 * projection already holds: stage moves, emails, interviews, offers and notes
 * they may see, and scorecard submissions as who and when, never their content.
 */
export function activity(s: State, view: { applications: Data[]; messages: Data[]; interviews: Data[]; offers: Data[]; teamNotes: Data[] }) {
  const apps = new Map(view.applications.map(app => [app.id, app]))
  const on = (application: string) => ({ application, candidate: apps.get(application)?.candidate })
  const entries: Data[] = []
  for (const app of view.applications) for (const e of app.history) entries.push({ kind: 'stage', at: e.at, actor: e.actor, ...on(app.id), from: e.from, to: e.to, reason: e.reason })
  for (const m of view.messages) {
    entries.push({ kind: 'email', at: m.draftedAt, actor: m.draftedBy, ...on(m.application), subject: m.subject, state: 'drafted' })
    for (const d of m.downloads ?? []) entries.push({ kind: 'email', at: d.at, actor: d.by, ...on(m.application), subject: m.subject, state: 'downloaded to send' })
  }
  for (const i of view.interviews) entries.push({ kind: 'interview', at: i.scheduledAt ?? i.createdAt, actor: i.scheduledBy ?? i.createdBy, ...on(i.application), title: i.title, status: i.status, start: i.start ?? null })
  for (const c of s.all('scorecard')) if (apps.has(c.application) && c.status === 'submitted') entries.push({ kind: 'scorecard', at: c.submittedAt, actor: c.author, ...on(c.application), corrected: !!c.corrects })
  for (const o of view.offers) entries.push({ kind: 'offer', at: o.outcomeAt ?? o.createdAt, actor: o.outcomeBy ?? o.createdBy, ...on(o.application), title: o.title, status: o.status })
  for (const n of view.teamNotes) entries.push({ kind: 'note', at: n.at, actor: n.author, application: n.application, candidate: n.candidate, note: n.id, text: n.text, private: n.private, edited: !!n.editedAt })
  return entries.filter(e => e.candidate && e.at).sort((x, y) => y.at.localeCompare(x.at))
}

/** Preparation is projected after source authorization, never from raw audit rows. */
export function preparationActivity(view: WorkspaceRecords & { proposals: Data[] }) {
  const entries: Data[] = []
  const add = (draft: Data, kind: 'proposal' | 'debrief', apps: Data[]) => {
    for (const app of apps) {
      const on = { application: app.id, candidate: app.candidate, draft: draft.id }
      entries.push({ ...on, kind: kind + '-prepared', at: draft.proposedAt ?? draft.preparedAt,
        actor: draft.proposedBy ?? draft.preparedBy, preparedByAgent: draft.proposedByAgent ?? draft.preparedByAgent,
        preparation: draft.preparation ?? null })
      const actor = draft.decidedBy ?? draft.keptBy, at = draft.decidedAt ?? draft.keptAt
      if (actor && at) entries.push({ ...on, kind: kind + '-decided', actor, at, status: draft.status })
    }
  }
  for (const proposal of view.proposals) add(proposal, 'proposal', proposalApplications(view, proposal))
  for (const brief of view.debriefs) add(brief, 'debrief', view.applications.filter(app => app.id === brief.application))
  return entries.filter(entry => entry.at)
}
