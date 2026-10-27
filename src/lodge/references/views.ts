import type { State } from '../core/state'
import { can, managesVacancy } from '../core/access'
import { requireThat, type Actor, type Data } from '../core/types'
import { canReadReference } from './records'

export function referenceView(s: State, a: Actor, visible: Set<string>) {
  const tasks: Data[] = [], configurations: Data[] = [], questionnaires: Data[] = [], records: Data[] = [], editable: string[] = []
  for (const appId of visible) {
    const app = s.get('application', appId), v = s.get('vacancy', app.vacancy)
    if (!a.agent && !app.imported && managesVacancy(a, v) && can(s, a, v, 'settings') && can(s, a, v, 'contact')) editable.push(appId)
    const q = s.find('reference-questionnaire', appId)
    if (q && editable.includes(appId)) configurations.push(q)
    if (!q || !canReadReference(s, a, app, q)) continue
    questionnaires.push(q)
    tasks.push(...s.all('task').filter(t => t.application === appId && t.purpose === 'call-references'))
    records.push(...s.all('reference-record').filter(r => r.application === appId))
  }
  return { questionnaires, records, editable, configurations, tasks }
}

export function referenceExport(s: State, a: Actor, application: string) {
  const app = s.get('application', application), v = s.get('vacancy', app.vacancy), q = s.get('reference-questionnaire', app.id)
  requireThat(canReadReference(s, a, app, q), 'Reference record not found', 404)
  requireThat(can(s, a, v, 'export'), 'Your permission level does not let you export references', 403)
  s.audit(a, 'references-exported', 'application:' + app.id)
  return { format: 'lodge-manual-references-1', questionnaire: q, records: s.all('reference-record').filter(r => r.application === app.id) }
}
