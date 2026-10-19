import type { Data } from '../core/types'

// PIPE-001: one job's pipeline board, read only from the reader's own workspace
// projection, so it shows exactly what they may see. The app and
// GET /api/lodge/board/<job> run this same function. Exact semantics:
// - days in stage: whole 24-hour periods since the application entered its
//   current stage (its last stage move, else its submission), rounded down;
// - last activity: the newest entry in the reader's activity feed for the
//   application (or a note on its candidate), else its submission;
// - next interview: the earliest scheduled interview still ahead, else one
//   still collecting times;
// - outstanding scorecards: panel members (reviewers and scheduled
//   interviewers) who have not submitted, shown to the people who run the job;
// - needs decision: a non-empty panel has all submitted and no stage move came
//   after the last submission;
// - filters (source, reviewer, tag, screening-rule match not dismissed) all
//   hold at once; columns count the filtered cards and keep the job total.
// The view (filters, sort, columns or list) is saved per person per job.

export const BOARD_LAYOUTS = ['columns', 'list'] as const
export const BOARD_SORTS = ['activity', 'days', 'name', 'submitted'] as const
export const BOARD_FILTERS = ['source', 'reviewer', 'tag', 'rule'] as const
export type BoardFilter = typeof BOARD_FILTERS[number]
export interface BoardView { layout: typeof BOARD_LAYOUTS[number]; sort: typeof BOARD_SORTS[number]; filters: Partial<Record<BoardFilter, string>> }

const DAY = 86_400_000
export const DEFAULT_VIEW: BoardView = { layout: 'columns', sort: 'activity', filters: {} }

/** The reader's saved view of this job, or the default. */
export function savedView(w: Data, vacancy: string): BoardView {
  const v = (w.boardViews ?? []).find((x: Data) => x.vacancy === vacancy)
  return v ? { layout: v.layout, sort: v.sort, filters: v.filters ?? {} } : DEFAULT_VIEW
}

/** Days in stage, last activity, next interview, outstanding scorecards and the needs-decision flag of one application. */
export function cardFacts(w: Data, app: Data, now: number) {
  const moves = app.history ?? []
  const enteredStage = moves.at(-1)?.at ?? app.submittedAt
  const feed = (w.activity ?? []).filter((e: Data) => e.application === app.id || (!e.application && e.candidate === app.candidate))
  const lastActivity = [app.submittedAt, ...feed.map((e: Data) => e.at)].sort().at(-1)
  const mine = (w.interviews ?? []).filter((i: Data) => i.application === app.id)
  const ahead = mine.filter((i: Data) => i.status === 'scheduled' && Date.parse(i.start) > now).sort((x: Data, y: Data) => x.start.localeCompare(y.start))
  const next = app.status === 'active' ? ahead[0] ?? mine.find((i: Data) => i.status === 'proposed') : undefined
  const panel: Data[] | undefined = app.panel
  const outstanding = panel ? panel.filter(p => !p.submitted).map(p => p.email) : null
  const lastCard = feed.filter((e: Data) => e.kind === 'scorecard' && e.application === app.id && !e.corrected).map((e: Data) => e.at).sort().at(-1)
  const needsDecision = app.status === 'active' && !!panel?.length && outstanding!.length === 0 && !!lastCard && lastCard >= enteredStage
  return {
    enteredStage, daysInStage: Math.max(0, Math.floor((now - Date.parse(enteredStage)) / DAY)), lastActivity,
    nextInterview: next ? { id: next.id, title: next.title, status: next.status, start: next.start ?? null, firstSlot: next.slots?.[0] ?? null } : null,
    scorecards: panel ? { submitted: panel.length - outstanding!.length, panel: panel.length, outstanding } : null,
    needsDecision,
  }
}

const SORTS: Record<BoardView['sort'], (x: Data, y: Data) => number> = {
  activity: (x, y) => y.lastActivity.localeCompare(x.lastActivity),
  days: (x, y) => y.daysInStage - x.daysInStage || x.enteredStage.localeCompare(y.enteredStage),
  name: () => 0,
  submitted: (x, y) => x.submittedAt.localeCompare(y.submittedAt),
}

/** The board of one job the reader can see, with their saved view applied (or `view` to preview another); null when not visible. */
export function board(w: Data, vacancyId: string, now = Date.now(), view = savedView(w, vacancyId)) {
  const v = w.vacancies.find((x: Data) => x.id === vacancyId)
  if (!v) return null
  const all = w.applications.filter((a: Data) => a.vacancy === v.id && a.status !== 'spam')
  const matched = (app: Data) => (w.ruleMatches ?? []).filter((m: Data) => m.application === app.id && m.status !== 'dismissed').map((m: Data) => m.rule)
  const f = view.filters
  const pass = (app: Data) => (!f.source || app.source === f.source) && (!f.reviewer || (app.reviewers ?? []).includes(f.reviewer))
    && (!f.tag || (app.tags ?? []).includes(f.tag)) && (!f.rule || matched(app).includes(f.rule))
  const cards = all.filter(pass).map((app: Data) => ({ application: app.id, candidate: app.candidate, candidateName: app.candidateName, source: app.source ?? '', status: app.status, stage: app.status === 'active' ? app.stage : 'closed', tags: app.tags ?? [], submittedAt: app.submittedAt, ...cardFacts(w, app, now) }))
    .sort((x: Data, y: Data) => SORTS[view.sort](x, y) || x.candidateName.localeCompare(y.candidateName) || x.application.localeCompare(y.application))
  const column = (id: string, name: string) => ({ id, name, total: all.filter((a: Data) => (a.status === 'active' ? a.stage : 'closed') === id).length, cards: cards.filter((c: Data) => c.stage === id) })
  const distinct = (values: string[]) => [...new Set(values.filter(Boolean))].sort()
  return {
    vacancy: v.id, title: v.title, view, filtered: Object.values(f).some(Boolean),
    columns: [...v.stages.map((st: Data) => column(st.id, st.name)), column('closed', 'Closed')],
    options: {
      source: distinct(all.map((a: Data) => a.source ?? '')), reviewer: distinct(all.flatMap((a: Data) => a.reviewers ?? [])), tag: distinct(all.flatMap((a: Data) => a.tags ?? [])),
      rule: (w.screeningRules ?? []).filter((r: Data) => r.vacancy === v.id).map((r: Data) => ({ id: r.id, name: r.name })),
    },
  }
}
