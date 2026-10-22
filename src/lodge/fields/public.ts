import type { Data } from '../core/types'
import { schemaOf } from './schema'

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Plain HTML controls are shared by hosted and embedded applicant pages. */
export function customFieldControls(v: Data, values: Data) {
  return schemaOf(v).filter(f => f.record !== 'vacancy').map(f => {
    const name = 'cf-' + f.id, required = f.requiredStages.includes(v.stages[0]?.id)
    const req = required ? ' required' : '', label = esc(f.name) + (required ? '' : ' (optional)')
    const selected = (value: string) => String(values[name]) === value ? ' selected' : ''
    const help = f.restricted ? '<small>Only hiring administrators can read this answer.</small>' : ''
    if (f.type === 'choice' || f.type === 'boolean') {
      const options = f.type === 'boolean' ? [['true', 'Yes'], ['false', 'No']] : f.choices.map(choice => [choice, choice])
      return `<label${f.restricted ? ' data-draft-private' : ''}>${label}${help}<select name="${esc(name)}"${req}><option value="">Choose…</option>${options.map(([value, title]) => `<option value="${esc(value)}"${selected(value)}>${esc(title)}</option>`).join('')}</select></label>`
    }
    return `<label${f.restricted ? ' data-draft-private' : ''}>${label}${help}<input name="${esc(name)}" type="${f.type === 'text' ? 'text' : f.type}"${f.type === 'number' ? ' step="any"' : ' maxlength="8000"'} value="${esc(values[name])}"${req}></label>`
  }).join('\n')
}

export function submittedCustomFields(v: Data, values: Data) {
  return Object.fromEntries(schemaOf(v).filter(f => f.record !== 'vacancy' && Object.hasOwn(values, 'cf-' + f.id)).map(f => [f.id, values['cf-' + f.id]]))
}
