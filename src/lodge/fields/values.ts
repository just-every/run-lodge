import type { State } from '../core/state'
import { about, requireThat, type Data } from '../core/types'
import { schemaOf, type FieldSpec } from './schema'

const empty = (value: unknown) => value === undefined || value === null || value === ''

/** The one type decoder used by staff JSON, applicant forms and CSV imports. */
export function fieldValue(f: FieldSpec, input: unknown): string | number | boolean | null {
  if (empty(input)) return null
  switch (f.type) {
    case 'text':
      requireThat(typeof input === 'string' && input.length <= 8000, `${f.name} must be text of at most 8000 characters`)
      return input.trim() || null
    case 'number': {
      requireThat(typeof input === 'number' || typeof input === 'string' && input.trim() !== '', `${f.name} must be a number`)
      const value = Number(input)
      requireThat(Number.isFinite(value), `${f.name} must be a finite number`)
      return value
    }
    case 'date':
      requireThat(typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) && !Number.isNaN(Date.parse(input + 'T00:00:00Z')) && new Date(input + 'T00:00:00Z').toISOString().slice(0, 10) === input, `${f.name} must be a real date (YYYY-MM-DD)`)
      return input
    case 'boolean':
      requireThat([true, false, 'true', 'false'].includes(input as any), `${f.name} must be true or false`)
      return input === true || input === 'true'
    case 'choice':
      requireThat(typeof input === 'string' && f.choices.includes(input), `${f.name} must be one of its configured choices`)
      return input
  }
}

/** Partial updates validate every supplied key; missing keys never erase saved values. */
export function validateValues(schema: FieldSpec[], input: unknown): Data {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Custom values must be an object')
  return Object.fromEntries(Object.entries(input).map(([id, value]) => about('cf-' + id, () => {
    const f = schema.find(f => f.id === id)
    requireThat(f, 'Unknown custom field')
    return [id, fieldValue(f, value)]
  })))
}

export function valuesFor(schema: FieldSpec[], values: Data, record: FieldSpec['record']) {
  return Object.fromEntries(schema.filter(f => f.record === record && Object.hasOwn(values, f.id)).map(f => [f.id, values[f.id]]))
}

/** Missing fields are checked on every intake and stage entry, with false and zero valid. */
export function requireStageFields(s: State, v: Data, app: Data, stage: string) {
  const person = s.get('candidate', app.candidate)
  const rows: Data = { candidate: person, application: app, vacancy: v }
  for (const f of schemaOf(v).filter(f => f.requiredStages.includes(stage))) {
    about('cf-' + f.id, () => {
      requireThat(!empty(rows[f.record].customValues?.[f.id]), `Complete ${f.restricted ? 'the required restricted field' : f.name} before entering ${v.stages.find((x: Data) => x.id === stage)?.name ?? stage}`, 409)
      fieldValue(f.restricted ? { ...f, name: 'Restricted field' } : f, rows[f.record].customValues[f.id])
    })
  }
}
