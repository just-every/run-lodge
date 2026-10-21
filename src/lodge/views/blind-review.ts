import type { State } from '../core/state'
import { blindCode, blindFor, blindId, redactor } from '../core/blind'
import type { Actor, Data } from '../core/types'

/** REVIEW-002: all read doors consume this projection, including proposal sources. */
export function blindProjection<T extends Data>(s: State, a: Actor, view: T): T {
  const apps: Data[] = view.applications
  const blind = new Map<string, Data>(apps.filter(app => blindFor(s, a, app)).map(app => [app.id, app]))
  const people = new Set([...blind.values()].map(app => app.candidate))
  const fullPeople = new Set(apps.filter(app => !blind.has(app.id)).map(app => app.candidate))
  const sanitize = new Map([...blind.values()].map(app => [app.id, redactor(s, app)]))
  const reveals = (app: Data) => s.all('audit').filter(e => e.action === 'blind-review-revealed' && e.record === 'application:' + app.id).map(e => ({ id: e.id, at: e.at, email: e.email, from: e.from, to: e.to }))
  const clean = (value: any, app: Data): any => {
    if (typeof value === 'string') return value === app.candidate ? blindId(app) : sanitize.get(app.id)!(value)
    if (Array.isArray(value)) return value.map(x => clean(x, app))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'candidateToken').map(([k, v]) => [k, ['id', 'application', 'vacancy'].includes(k) ? v : clean(v, app)]))
    return value
  }
  const text = (app: Data) => {
    const extracted = s.all('resume-extraction').filter(r => r.candidate === app.candidate && (!r.application || r.application === app.id)).map(r => r.sourceText)
    const originals = s.all('document').filter(d => d.kind === 'resume' && d.candidate === app.candidate && (!d.application || d.application === app.id)).map(d => s.resumeTexts.get(d.id))
    return [...new Set([...extracted, ...originals].filter(Boolean))].map(t => sanitize.get(app.id)!(t)).join('\n\n')
  }
  const rows = (items: Data[]) => items.flatMap(row => {
    const app = blind.get(row.application)
    if (app) return [clean(row, app)]
    // A person-wide record cannot be joined into a blind application from another job.
    if (!row.application && people.has(row.candidate)) return []
    return [row]
  })
  const out: Data = { ...view }
  out.applications = apps.map(app => {
    if (!blind.has(app.id)) return { ...app, blind: false, reveals: reveals(app) }
    // No transfer/merge lineage, source identifiers, cross-job hashes or person-level joins.
    const { transferredFrom, transferredTo, transferHistory, earlier, credit, employee, customValues, ...safe } = app
    return { ...clean(safe, app), candidate: blindId(app), candidateName: blindCode(app), blind: true, earlier: [], resumeText: text(app), reveals: reveals(app) }
  })
  out.candidates = [
    ...view.candidates.filter((c: Data) => !people.has(c.id) || fullPeople.has(c.id)),
    ...[...blind.values()].map(app => ({ id: blindId(app), name: blindCode(app), blind: true, resumeText: text(app), imported: null })),
  ]
  // Original metadata, images and source passages never accompany a blind application.
  out.documents = view.documents.filter((d: Data) => !blind.has(d.application) && !(people.has(d.candidate) && !fullPeople.has(d.candidate) && !d.application))
  out.resumeExtractions = view.resumeExtractions.filter((r: Data) => !blind.has(r.application) && !(people.has(r.candidate) && !fullPeople.has(r.candidate) && !r.application))
  out.resumeIntakes = view.resumeIntakes.filter((r: Data) => !blind.has(r.application) && !(people.has(r.candidate) && !fullPeople.has(r.candidate) && !r.application))
  for (const key of ['interviews', 'scorecards', 'notes', 'teamNotes', 'activity', 'tasks', 'messages', 'offers', 'notifications', 'alerts', 'debriefs']) out[key] = rows(view[key])
  out.importedHistory = { ...view.importedHistory, notes: rows(view.importedHistory.notes), ratings: rows(view.importedHistory.ratings), messages: rows(view.importedHistory.messages) }
  out.vacancies = view.vacancies.map((v: Data) => {
    const mine = [...blind.values()].filter(app => app.vacancy === v.id)
    if (!mine.length || !v.pipeline) return v
    return { ...v, pipeline: v.pipeline.map((r: Data) => mine.reduce((x, app) => clean(x, app), r)) }
  })
  out.reviewQueues = view.reviewQueues.map((q: Data) => ({ ...q, reviews: rows(q.reviews) }))
  // Sandboxes carry historical application snapshots: they follow the same sanitization.
  out.sandboxes = view.sandboxes.map((box: Data) => [...blind.values()].reduce((x, app) => clean(x, app), box))
  out.coordination = [...blind.values()].reduce((x, app) => clean(x, app), view.coordination)
  out.events = view.events.map((e: Data) => ({ ...e, pool: e.pool.filter((r: Data) => !people.has(r.candidate) || fullPeople.has(r.candidate)).map((r: Data) => ({ ...r, applications: r.applications.filter((app: Data) => !blind.has(app.id)) })) }))
  const contextual = (value: any): any => {
    if (Array.isArray(value)) return value.map(contextual)
    if (value && typeof value === 'object') {
      const app = blind.get(value.application)
      const source = app ? clean(value, app) : value
      return Object.fromEntries(Object.entries(source).map(([k, v]) => [k, contextual(v)]))
    }
    return value
  }
  return contextual(out) as T
}
