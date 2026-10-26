import type { State } from '../core/state'
import { now, requireThat, text, uid, type Actor } from '../core/types'
import { validateQuery, type Query } from './query'
import type { AnalysisScope } from './scope'

export function savedCharts(s: State, a: Actor) {
  return s.all('analysis-chart').filter(x => x.owner === a.id).map(x => ({ id: x.id, title: x.title, createdAt: x.createdAt })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
}
export function saveChart(s: State, a: Actor, scope: AnalysisScope, title: unknown, query: unknown) {
  const definition = validateQuery(query, scope)
  const chart = s.put('analysis-chart', uid(), { owner: a.id, title: text(title, 'Chart name', 120), query: definition, createdAt: now() })
  s.audit(a, 'analysis-chart-saved', 'analysis-chart:' + chart.id)
  return { id: chart.id, title: chart.title, query: definition as Query, createdAt: chart.createdAt }
}
export function reopenChart(s: State, a: Actor, scope: AnalysisScope, id: string) {
  const chart = s.find('analysis-chart', id)
  requireThat(chart && chart.owner === a.id, 'Saved chart not found', 404)
  return { id: chart.id, title: chart.title as string, query: validateQuery(chart.query, scope, true), createdAt: chart.createdAt as string }
}
