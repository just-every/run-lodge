import type { State } from '../core/state'
import { isAdmin, requireAdmin, requireApplication, requireCan, requireManages } from '../core/access'
import { list, now, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { schemaList, schemaOf } from './schema'
import { validateValues, valuesFor, requireStageFields } from './values'

function settings(s: State, a: Actor, id: unknown) {
  const v = s.get('vacancy', id)
  requireManages(a, v); requireCan(s, a, v, 'settings')
  requireThat(!v.imported && v.status === 'draft', 'Change published job fields and views in a workflow sandbox; choose a draft job here', 409)
  return v
}

export function fieldSchema(s: State, a: Actor, b: Data) {
  const v = settings(s, a, b.id), incoming = schemaList(v, b.fields)
  const current = schemaOf(v)
  if (!isAdmin(a)) for (const f of incoming) {
    requireThat(!f.restricted && !current.some(old => old.id === f.id && old.restricted), 'Only the owner or a hiring admin can configure restricted fields', 403)
  }
  const fields = isAdmin(a) ? incoming : [...incoming, ...current.filter(f => f.restricted)]
  // Existing facts cannot silently acquire a different record/type or restricted visibility.
  for (const f of fields) {
    const before = current.find(old => old.id === f.id)
    if (!before) continue
    const rows = before.record === 'vacancy' ? [v] : s.scan(before.record).filter(row => before.record === 'application' ? row.vacancy === v.id : s.scan('application').some(app => app.vacancy === v.id && app.candidate === row.id))
    if (rows.some(row => Object.hasOwn(row.customValues ?? {}, f.id))) {
      requireThat(before.record === f.record && before.type === f.type, 'Create a new field instead of changing the record or type of a field with saved values', 409)
      requireThat(!before.restricted || f.restricted, 'Restricted fields with saved values must stay restricted', 409)
      for (const row of rows) validateValues([f], { [f.id]: row.customValues?.[f.id] })
    }
  }
  // A saved view cannot outlive a field used in its predicate.
  requireThat((v.hiringViews ?? []).every((view: Data) => view.filters.every((filter: Data) => fields.some(f => f.id === filter.field))), 'Remove saved view filters before deleting their fields', 409)
  const record = s.put('vacancy', v.id, { ...v, customSchema: fields })
  s.audit(a, 'field-schema-defined', 'vacancy:' + v.id, { fields: fields.length })
  return record
}

export function fieldValues(s: State, a: Actor, b: Data) {
  requireThat(!!b.application !== !!b.vacancy, 'Choose an application or a requisition')
  const app = b.application ? requireApplication(s, a, b.application) : null
  const v = s.get('vacancy', app?.vacancy ?? b.vacancy)
  requireManages(a, v); requireCan(s, a, v, app ? 'contact' : 'settings')
  const schema = schemaOf(v)
  for (const id of Object.keys(b.values ?? {})) if (schema.some(f => f.id === id && f.restricted)) requireAdmin(a)
  const values = validateValues(schema, b.values)
  for (const id of Object.keys(values)) {
    const f = schema.find(f => f.id === id)!
    requireThat(app ? f.record !== 'vacancy' : f.record === 'vacancy', 'Choose the record this custom field belongs to')
    if (f.restricted) requireAdmin(a)
  }
  if (app) {
    const person = s.get('candidate', app.candidate)
    requireThat(!person.deleted && !person.mergedInto, 'This candidate record is closed', 409)
    for (const [kind, row] of [['candidate', person], ['application', app]] as const) {
      const given = valuesFor(schema, values, kind)
      if (Object.keys(given).length) s.put(kind, row.id, { ...row, customValues: { ...row.customValues, ...given } })
    }
    if (app.status === 'active') requireStageFields(s, v, s.get('application', app.id), app.stage)
  } else s.put('vacancy', v.id, { ...v, customValues: { ...v.customValues, ...values } })
  s.audit(a, 'field-values-updated', (app ? 'application:' + app.id : 'vacancy:' + v.id), { at: now(), count: Object.keys(values).length })
  return app ? { application: s.get('application', app.id), candidate: s.get('candidate', app.candidate) } : s.get('vacancy', v.id)
}

export function hiringViews(s: State, a: Actor, b: Data) {
  const v = settings(s, a, b.id), schema = schemaOf(v)
  const views = list(b.views, 'Saved hiring views', 30, (raw: any) => {
    const filters = list(raw?.filters ?? [], 'Field filters', 30, (filter: any) => {
      const f = schema.find(f => f.id === filter?.field)
      requireThat(f, 'Saved view filters must name fields of this job')
      if (f.restricted) requireAdmin(a)
      return { field: f.id, equals: validateValues([f], { [f.id]: filter.equals })[f.id] }
    })
    return { id: raw?.id ? text(raw.id, 'View id', 220) : uid(), name: text(raw?.name, 'View name', 120), query: optionalText(raw?.query, 'Search query', 300), filters, tags: [...new Set(list(raw?.tags ?? [], 'Tags', 30, tag => text(tag, 'Tag', 80)))] }
  })
  requireThat(new Set(views.map(view => view.id)).size === views.length, 'Saved view ids must be unique')
  const hidden = (v.hiringViews ?? []).filter((view: Data) => view.filters.some((filter: Data) => schema.some(f => f.id === filter.field && f.restricted)))
  if (!isAdmin(a)) requireThat(!views.some(view => hidden.some((old: Data) => old.id === view.id)), 'Only the owner or a hiring admin can configure restricted views', 403)
  const all = isAdmin(a) ? views : [...views, ...hidden]
  const record = s.put('vacancy', v.id, { ...v, hiringViews: all })
  s.audit(a, 'hiring-views-defined', 'vacancy:' + v.id, { count: all.length })
  return record
}
