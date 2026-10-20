import { list, oneOf, optionalText, requireThat, text, uid, type Data } from '../core/types'

export interface FieldSpec {
  id: string
  name: string
  record: 'candidate' | 'application' | 'vacancy'
  type: 'text' | 'number' | 'date' | 'boolean' | 'choice'
  choices: string[]
  restricted: boolean
  identity: 'school' | 'year' | null
  requiredStages: string[]
  importColumn?: string
}

/** Every job owns its field ids, including fields copied from an import template. */
export function schemaList(v: Data, input: unknown): FieldSpec[] {
  const fields = list(input, 'Custom fields', 60, (raw: any) => {
    requireThat(raw && typeof raw === 'object', 'Each custom field needs a definition')
    const local = raw.id ? text(raw.id, 'Field id', 220) : uid()
    requireThat(/^[a-zA-Z0-9:_-]+$/.test(local), 'Field ids may contain letters, numbers, colons, underscores and hyphens')
    const id = local.startsWith(v.id + ':') ? local : v.id + ':' + local
    const type = oneOf(raw.type, ['text', 'number', 'date', 'boolean', 'choice'] as const, 'Field type')
    const choices = list(raw.choices ?? [], 'Choices', 60, c => text(c, 'Choice', 160))
    requireThat(new Set(choices).size === choices.length, 'Field choices must be unique')
    requireThat(type !== 'choice' || choices.length > 0, 'A choice field needs choices')
    requireThat(type === 'choice' || choices.length === 0, 'Only choice fields may define choices')
    const requiredStages = [...new Set(list(raw.requiredStages ?? [], 'Required stages', 12, st => {
      requireThat(v.stages.some((x: Data) => x.id === st), 'Required fields must name a current stage of this job')
      return st as string
    }))]
    const importColumn = optionalText(raw.importColumn, 'Import CSV column', 200)
    return { id, name: text(raw.name, 'Field name', 120), record: oneOf(raw.record, ['candidate', 'application', 'vacancy'] as const, 'Record type'), type, choices, restricted: raw.restricted === true,
      identity: raw.identity == null || raw.identity === '' ? null : oneOf(raw.identity, ['school', 'year'] as const, 'Identity redaction'), requiredStages, ...(importColumn ? { importColumn } : {}) }
  })
  requireThat(new Set(fields.map(f => f.id)).size === fields.length, 'Custom field ids must be unique')
  return fields
}

export const schemaOf = (v: Data): FieldSpec[] => v.customSchema ?? []
