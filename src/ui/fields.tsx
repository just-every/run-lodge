import { useState } from 'react'
import type { PageProps } from './app'
import { Check, Field, Form, type D } from './shared'

const kinds = ['candidate', 'application', 'vacancy']
const types = ['text', 'number', 'date', 'boolean', 'choice']
const options = (items: string[]) => items.map(value => ({ value, label: value === 'vacancy' ? 'Requisition' : value[0].toUpperCase() + value.slice(1) }))
export const isFieldAdmin = (w: D) => w.actor.owner || w.actor.roles.includes('admin')

/** Keep browser input values typed at the command boundary. Blank clears an optional value. */
export function typedFieldValue(field: D, value: string) {
  if (value === '') return null
  if (field.type === 'number') {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new Error('Enter a number for ' + field.name)
    return number
  }
  if (field.type === 'boolean') return value === 'true'
  return value
}

export function TypedField({ field, value, required = false, name = 'value' }: { field: D; value?: unknown; required?: boolean; name?: string }) {
  const choices = field.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
    : field.type === 'choice' ? field.choices.map((value: string) => ({ value, label: value })) : undefined
  // Native number fields need step=any for decimal values.
  if (field.type === 'number') return <label>{field.name}<input name={name} type="number" step="any" required={required} defaultValue={value == null ? '' : String(value)} /></label>
  return <Field label={field.name} name={name} type={field.type === 'date' ? 'date' : 'text'} options={choices} required={required} defaultValue={value == null ? '' : String(value)} />
}

function SchemaForm({ field, stages, admin, save }: { field?: D; stages: D[]; admin: boolean; save: (field: D) => Promise<unknown> }) {
  const [type, setType] = useState(field?.type ?? 'text')
  return <Form label={field ? 'Save field' : 'Add field'} reset={!field} onSubmit={async x => {
    const next = { id: field?.id ?? crypto.randomUUID(), name: x.name.trim(), record: x.record, type,
      choices: type === 'choice' ? x.choices.split('\n').map((v: string) => v.trim()).filter(Boolean) : [],
      restricted: admin ? x.restricted === true : field?.restricted === true, identity: x.identity || null,
      requiredStages: stages.filter(s => x['required-' + s.id]).map(s => s.id), importColumn: x.importColumn.trim() || undefined }
    await save(next)
    if (!field) setType('text')
  }}>
    <Field label="Field name" name="name" defaultValue={field?.name} />
    <Field label="Record kind" name="record" defaultValue={field?.record ?? 'candidate'} options={options(kinds)} />
    <label>Field type<select name="type" value={type} onChange={event => setType(event.target.value)}>{options(types).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    {type === 'choice' && <Field label="Choices (one per line)" name="choices" type="textarea" defaultValue={field?.choices?.join('\n')} />}
    {admin && <Check label="Restricted to owner and hiring admins" name="restricted" defaultChecked={field?.restricted} />}
    <Field label="Identity to redact during blind review" name="identity" required={false} defaultValue={field?.identity ?? ''} options={[{ value: 'school', label: 'School' }, { value: 'year', label: 'Graduation year' }]} hint="Choose only an explicitly recorded school or graduation year." />
    <fieldset className="wide"><legend>Required before entering stages</legend>{stages.map(s => <Check key={s.id} name={'required-' + s.id} label={s.name} defaultChecked={field?.requiredStages?.includes(s.id)} />)}</fieldset>
    <Field label="Workable CSV column (optional)" name="importColumn" required={false} defaultValue={field?.importColumn} />
  </Form>
}

/** The same form authors live draft configuration and isolated sandbox configuration. */
export function FieldSchemaEditor({ fields, stages, admin, save }: { fields: D[]; stages: D[]; admin: boolean; save: (fields: D[]) => Promise<unknown> }) {
  return <>
    {fields.map(field => <details key={field.id}><summary>Change field “{field.name}” · {field.record} · {field.type}{field.restricted ? ' · restricted' : ''}</summary>
      <SchemaForm key={JSON.stringify(field)} field={field} stages={stages} admin={admin} save={next => save(fields.map(f => f.id === field.id ? next : f))} />
      <Form label={'Remove field ' + field.name} compact onSubmit={() => save(fields.filter(f => f.id !== field.id))} />
    </details>)}
    <details><summary>Add a typed field</summary><SchemaForm stages={stages} admin={admin} save={next => save([...fields, next])} /></details>
  </>
}

export function FieldValues({ fields, values, editable, save, label }: { fields: D[]; values: D; editable: boolean; save: (values: D) => Promise<unknown>; label: string }) {
  if (!fields.length) return null
  return <section aria-label={label}><h3>{label}</h3>
    <dl>{fields.map(f => <div key={f.id}><dt>{f.name}{f.restricted ? ' · restricted' : ''}</dt><dd>{values[f.id] == null ? 'Not recorded' : typeof values[f.id] === 'boolean' ? values[f.id] ? 'Yes' : 'No' : String(values[f.id])}</dd></div>)}</dl>
    {editable && <details><summary>Edit {label.toLowerCase()}</summary>
      <Form key={JSON.stringify(values) + JSON.stringify(fields)} label={'Save ' + label.toLowerCase()} onSubmit={x => save(Object.fromEntries(fields.map(f => [f.id, typedFieldValue(f, x[f.id])])))}>
        {fields.map(f => <TypedField key={f.id} field={f} name={f.id} value={values[f.id]} />)}
      </Form>
    </details>}
  </section>
}

export function JobFields({ v, w, mutate }: { v: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const fields = v.customSchema ?? [], editable = v.manages && !v.imported
  const configure = editable && v.permissions?.includes('settings')
  return <section aria-label="Custom hiring fields">
    <h3>Custom hiring fields</h3>
    {configure && <>
      <p>Candidate fields follow the person; application fields belong to this job application; requisition fields belong to the job. Only the owner and hiring admins see restricted fields.</p>
      {v.status === 'draft' ? <FieldSchemaEditor fields={fields} stages={v.stages} admin={isFieldAdmin(w)} save={fields => mutate('field-schema', { id: v.id, fields })} />
        : <p>Field configuration requires a draft job. Trial field, required-stage and permission changes in Workflow sandbox, review the impact, then unpublish this job before deploying the exact preview.</p>}
    </>}
    <FieldValues fields={fields.filter((f: D) => f.record === 'vacancy')} values={v.customValues ?? {}} editable={editable} label="Requisition fields" save={values => mutate('field-values', { vacancy: v.id, values })} />
  </section>
}

export function ApplicationFields({ app, v, c, mutate }: { app: D; v?: D; c: D } & Pick<PageProps, 'mutate'>) {
  // A blind context must never render or offer editing of typed identity/profile values.
  if (app.blind) return <p className="hint">Typed profile values are hidden during blind review.</p>
  return <FieldValues fields={(v?.customSchema ?? []).filter((f: D) => f.record !== 'vacancy')} values={{ ...(c.customValues ?? {}), ...(app.customValues ?? {}) }} editable={app.manages} label="Profile fields" save={values => mutate('field-values', { application: app.id, values })} />
}
