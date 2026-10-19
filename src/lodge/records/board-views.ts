import type { State } from '../core/state'
import { canSeeApplication, managesVacancy } from '../core/access'
import { now, oneOf, optionalText, requireThat, scope, type Actor, type Data } from '../core/types'
import { BOARD_FILTERS, BOARD_LAYOUTS, BOARD_SORTS } from '../views/board'

// PIPE-001: each person's own view of a job's board (filters, sort, columns or
// list), kept per person per job. A preference, not a hiring record: it changes
// nothing anyone else sees.

export function boardView(s: State, a: Actor, b: Data) {
  const v = s.get('vacancy', b.vacancy, 'Vacancy')
  requireThat(managesVacancy(a, v) || s.all('application').some(x => x.vacancy === v.id && canSeeApplication(s, a, x)), 'Vacancy not found', 404)
  const filters = b.filters && typeof b.filters === 'object' ? b.filters as Data : {}
  const id = scope(a) + ':' + v.id
  return s.put('board-view', id, {
    id, member: scope(a), vacancy: v.id, at: now(),
    layout: oneOf(b.layout ?? 'columns', BOARD_LAYOUTS, 'Show as'), sort: oneOf(b.sort ?? 'activity', BOARD_SORTS, 'Sort by'),
    filters: Object.fromEntries(BOARD_FILTERS.flatMap(k => { const value = optionalText(filters[k], 'Filter', 200); return value ? [[k, value]] : [] })),
  })
}

/** The reader's saved board views, for the jobs they can still see. */
export const boardViews = (s: State, a: Actor, vacancies: Set<string>) => s.all('board-view').filter(x => x.member === scope(a) && vacancies.has(x.vacancy))
