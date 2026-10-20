import type { State } from '../core/state'
import { requireAdmin } from '../core/access'
import { requireThat, type Actor, type Data } from '../core/types'
import { schemaOf } from './schema'
import { validateValues, valuesFor } from './values'

/** Intake may capture applicant fields; requisition values always belong to settings. */
export function captureApplicationFields(s: State, actor: Actor | null, candidate: Data, v: Data, input: unknown) {
  const schema = schemaOf(v)
  if (actor) for (const id of Object.keys((input ?? {}) as Data)) if (schema.some(f => f.id === id && f.restricted)) requireAdmin(actor)
  const values = validateValues(schema, input ?? {})
  for (const id of Object.keys(values)) {
    const field = schema.find(f => f.id === id)!
    requireThat(field.record !== 'vacancy', 'Applicants cannot change requisition fields')
    if (actor && field.restricted) requireAdmin(actor)
  }
  const personValues = valuesFor(schema, values, 'candidate')
  if (Object.keys(personValues).length) s.put('candidate', candidate.id, { ...s.get('candidate', candidate.id), customValues: { ...candidate.customValues, ...personValues } })
  return valuesFor(schema, values, 'application')
}
