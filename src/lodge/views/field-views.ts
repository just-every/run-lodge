import { requireThat, type Data } from '../core/types'
import type { WorkspaceRecords } from './workspace'

/** DATA-001: team views evaluate only the same projected records the reader can open. */
export function savedHiringView(w: WorkspaceRecords, vacancy: string, id: string) {
  const v = w.vacancies.find(v => v.id === vacancy)
  requireThat(v, 'Vacancy not found', 404)
  const view = v.hiringViews?.find((view: Data) => view.id === id)
  requireThat(view, 'Saved hiring view not found', 404)
  const applications = w.applications.filter(app => app.vacancy === vacancy).filter(app => {
    const c = w.candidates.find(c => c.id === app.candidate)
    const words = (view.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const content = [c?.name, c?.headline, c?.skills, c?.resumeText, app.resumeText, ...Object.values(c?.customValues ?? {}), ...Object.values(app.customValues ?? {}), ...Object.values(v.customValues ?? {})].join(' ').toLowerCase()
    return words.every((word: string) => content.includes(word)) && view.tags.every((tag: string) => (app.tags ?? []).includes(tag)) && view.filters.every((filter: Data) => {
      const f = v.customSchema?.find((f: Data) => f.id === filter.field)
      if (!f || app.blind) return false
      const row = f.record === 'candidate' ? c : f.record === 'vacancy' ? v : app
      return Object.hasOwn(row?.customValues ?? {}, f.id) && row?.customValues?.[f.id] === filter.equals
    })
  })
  return { view, applications }
}
