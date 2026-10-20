import { useEffect, useState } from 'react'
import type { PageProps } from './app'
import { call, Field, Form, Table, type D } from './shared'
import { TypedField, typedFieldValue } from './fields'

function ViewForm({ view, fields, save }: { view?: D; fields: D[]; save: (view: D) => Promise<unknown> }) {
  const [fieldId, setFieldId] = useState(view?.filters?.[0]?.field ?? '')
  const field = fields.find(f => f.id === fieldId)
  return <Form label={view ? 'Save team view' : 'Add team view'} reset={!view} onSubmit={async x => {
    if (field && x.equals === '') throw new Error('Enter the value this field must equal.')
    const filters = field ? [{ field: field.id, equals: typedFieldValue(field, x.equals) }] : []
    await save({ id: view?.id ?? crypto.randomUUID(), name: x.name.trim(), query: x.query.trim(), filters, tags: x.tags.split(',').map((t: string) => t.trim()).filter(Boolean) })
    if (!view) setFieldId('')
  }}>
    <Field label="Team view name" name="name" defaultValue={view?.name} />
    <Field label="Resume or profile query" name="query" required={false} defaultValue={view?.query} />
    <label>Filter field (optional)<select name="field" value={fieldId} onChange={e => setFieldId(e.target.value)}><option value="">Any permitted field</option>{fields.map(f => <option key={f.id} value={f.id}>{f.name} · {f.record}{f.restricted ? ' · restricted' : ''}</option>)}</select></label>
    {field && <fieldset key={field.id}><legend>Field must equal</legend><TypedField name="equals" field={field} required value={view?.filters?.find((f: D) => f.field === field.id)?.equals} /></fieldset>}
    <Field label="Tags (optional, comma-separated)" name="tags" required={false} defaultValue={view?.tags?.join(', ')} />
  </Form>
}

export function HiringViewEditor({ views, fields, save }: { views: D[]; fields: D[]; save: (views: D[]) => Promise<unknown> }) {
  return <>
    {views.map(view => <details key={view.id}><summary>Change team view “{view.name}”</summary>
      <ViewForm key={JSON.stringify(view)} view={view} fields={fields} save={next => save(views.map(v => v.id === view.id ? next : v))} />
      <Form label="Remove team view" compact onSubmit={() => save(views.filter(v => v.id !== view.id))} />
    </details>)}
    <details><summary>Add a team view</summary><ViewForm fields={fields} save={view => save([...views, view])} /></details>
  </>
}

export function JobHiringViews({ v, mutate }: { v: D } & Pick<PageProps, 'mutate'>) {
  if (!v.manages || !v.permissions?.includes('settings')) return null
  return <section aria-label="Team view settings"><h3>Team view settings</h3>
    <p>Save a resume or permitted profile query with an exact typed field filter and optional tags for this hiring team.</p>
    {v.status === 'draft' ? <HiringViewEditor views={v.hiringViews ?? []} fields={v.customSchema ?? []} save={views => mutate('hiring-view', { id: v.id, views })} />
      : <p>Team view configuration requires a draft job. Trial changes in Workflow sandbox, review the scoped impact, then unpublish the job before deployment.</p>}
  </section>
}

/** This panel shows the server's scoped saved-view results, separately from the stage board. */
export function HiringViews({ v, open, revision }: { v: D; open: (id: string) => void; revision: unknown }) {
  const [selected, setSelected] = useState(''), [result, setResult] = useState<D>(), [error, setError] = useState('')
  const views = v.hiringViews ?? []
  const selectedView = views.find((view: D) => view.id === selected)
  useEffect(() => {
    let active = true
    setResult(undefined); setError('')
    if (selectedView) call('views/' + encodeURIComponent(v.id) + '/' + encodeURIComponent(selectedView.id))
      .then(value => { if (active) setResult(value) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [v.id, selectedView, revision])
  if (!views.length) return null
  return <section className="card" aria-label="Saved team view results"><h3>Saved team view results</h3>
    <p>The stage board above keeps showing the job’s pipeline. Open a saved view here to read its current matching applications.</p>
    <label>Saved team view<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a team view…</option>{views.map((view: D) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
    {error && <p role="alert">{error}</p>}
    {selectedView && !result && !error && <p role="status">Loading matching applications…</p>}
    {result && <><h4>{result.view.name}</h4><p>{result.applications.length} matching applications</p>
      <Table heads={['Candidate', 'Stage', '']} empty="No applications match this saved view.">{result.applications.map((app: D) => <tr key={app.id}><td>{app.candidateName}</td><td>{v.stages.find((s: D) => s.id === app.stage)?.name ?? app.status}</td><td><button onClick={() => open(app.id)} aria-label={'Open matching application ' + app.candidateName}>Open application</button></td></tr>)}</Table>
    </>}
  </section>
}
