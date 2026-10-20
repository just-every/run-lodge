import { requireThat, type Data } from '../core/types'
import { schemaList, type FieldSpec } from './schema'
import { validateValues, valuesFor } from './values'

export interface FieldTemplate { id: string; stages: Data[]; customSchema: FieldSpec[] }

/** Map an employer's explicit CSV columns; source bytes and raw payloads stay intact. */
export function importedFields(template: FieldTemplate | undefined, job: string, stages: Data[]) {
  if (!template) return []
  return template.customSchema.map(field => ({ ...field, id: job + ':' + field.id.slice((template.id + ':').length), requiredStages: field.requiredStages.flatMap(id => {
    const index = template.stages.findIndex(st => st.id === id), name = template.stages[index]?.name
    const stage = stages.find(st => st.name === name) ?? stages[index]
    return stage ? [stage.id] : []
  }) }))
}

export function importValues(schema: FieldSpec[], record: FieldSpec['record'], headers: string[], row: Data) {
  const fields = schema.filter(f => f.record === record && f.importColumn)
  for (const f of fields) requireThat(headers.filter(h => h === f.importColumn).length === 1, `Import column “${f.importColumn}” for ${f.name} must appear exactly once in the ${record === 'vacancy' ? 'jobs' : 'candidates'} CSV`)
  return valuesFor(fields, validateValues(fields, Object.fromEntries(fields.map(f => [f.id, row[f.importColumn!]]))), record)
}

export function fieldTemplate(v: Data): FieldTemplate {
  return { id: v.id, stages: v.stages, customSchema: schemaList(v, v.customSchema ?? []) }
}
