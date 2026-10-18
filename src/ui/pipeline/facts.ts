import { sentence } from '../names'
import type { D } from '../shared'

// What the board reads off the workspace: each application's stage, its time there, its next interview and the
// agent proposals that wait on the signed-in person. All derived from records; nothing here is a score.

const CLOSED: D = { hired: 'Hired', rejected: 'Not progressing', withdrawn: 'Withdrew' }

export const stageName = (v: D | undefined, id: string) => CLOSED[id] ?? v?.stages.find((s: D) => s.id === id)?.name ?? (id ? sentence(id) : 'Received')
export const closedLabel = (app: D) => CLOSED[app.status] ?? sentence(app.status)

/** When the application last moved, or arrived. */
export const lastMove = (app: D) => app.history.at(-1)?.at ?? app.submittedAt

/** Arrived in the last seven days. */
export const isNew = (app: D) => Date.now() - Date.parse(app.submittedAt) < 7 * 86400000

/** The application's next interview: the earliest scheduled one still ahead, else one still collecting times. */
export function nextInterview(w: D, app: D) {
  const mine = w.interviews.filter((i: D) => i.application === app.id)
  const ahead = mine.filter((i: D) => i.status === 'scheduled' && Date.parse(i.start) > Date.now()).sort((x: D, y: D) => x.start.localeCompare(y.start))
  return ahead[0] ?? mine.find((i: D) => i.status === 'proposed')
}

/** "Panel 2 of 2": where an interview sits in its vacancy's plan. */
export function planPlace(v: D | undefined, iv: D) {
  const i = v?.plan?.findIndex((p: D) => p.id === iv.planItem) ?? -1
  return i < 0 ? '' : `Panel ${i + 1} of ${v!.plan.length}`
}

/** The application a proposal acts on, from its changes or its sources. */
export const proposalApplication = (p: D): string | undefined =>
  p.changes.find((c: D) => typeof c.input?.application === 'string')?.input.application ?? p.sources.find((s: D) => s.kind === 'application')?.id

/** Proposals still open that the signed-in person may decide. */
export const openProposals = (w: D) => w.proposals.filter((p: D) => p.status === 'proposed' && (p.approver === w.actor.email || (w.actor.owner && p.proposedBy !== w.actor.email)))

/** Applications on this vacancy, by column: each stage in order, then everything closed. */
export function columns(v: D, apps: D[]): { id: string; name: string; apps: D[] }[] {
  const active = apps.filter(a => a.status === 'active')
  const byRecent = (x: D, y: D) => lastMove(y).localeCompare(lastMove(x))
  return [
    ...v.stages.map((s: D) => ({ id: s.id, name: s.name, apps: active.filter(a => a.stage === s.id).sort(byRecent) })),
    { id: 'closed', name: 'Closed', apps: apps.filter(a => a.status !== 'active').sort(byRecent) },
  ]
}

/** "LinkedIn 19 · Indeed 12": where this vacancy's applications came from, largest first. */
export function sources(apps: D[]) {
  const counts = new Map<string, number>()
  for (const a of apps) counts.set(a.source || 'Not recorded', (counts.get(a.source || 'Not recorded') ?? 0) + 1)
  return [...counts].sort((x, y) => y[1] - x[1])
}
