import { useState } from 'react'
import type { PageProps } from './app'
import { Check, Field, Form, type D } from './shared'

const destinations = [{ value: 'willow', label: 'Willow' }, { value: 'bamboohr', label: 'BambooHR' }, { value: 'adp', label: 'ADP Workforce Now' }]
const show = (value: unknown): string => typeof value === 'object' && value !== null ? JSON.stringify(value) : value == null || value === '' ? 'Missing' : String(value)

export function HandoffMappingSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const [selected, setSelected] = useState('')
  const jobs = w.vacancies.filter((v: D) => v.manages && ['settings', 'offers', 'contact'].every(p => v.permissions.includes(p)))
  if (w.actor.agent || !jobs.length) return null
  const mapping = w.handoffPreviews.mappings.find((m: D) => m.vacancy === selected), job = jobs.find((v: D) => v.id === selected)
  return <section className="card" aria-label="Employee mapping settings"><h2>Employee mapping preview</h2>
    <p>Declare destination field names for a local review. Tenant identifiers and schema compatibility are unverified. No connection or employee-creation permission is granted.</p>
    <label>Mapping job<select aria-label="Mapping job" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose…</option>{jobs.map((v: D) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
    {job && <Form key={selected + mapping?.revision} label="Save employee mapping" onSubmit={values => mutate('handoff-mapping', {
      vacancy: selected, revision: mapping?.revision ?? null, destination: values.destination, tenant: values.tenant, customField: values.customField,
      fields: Object.fromEntries(Object.keys(w.handoffPreviews.fields).map(key => [key, values['map-' + key]])),
    })}>
      <Field label="Declared destination" name="destination" defaultValue={mapping?.destination ?? 'willow'} options={destinations} />
      <Field label="Declared tenant identifier" name="tenant" defaultValue={mapping?.tenant ?? ''} required={false} />
      <Field label="Existing nonrestricted custom field" name="customField" defaultValue={mapping?.customField} options={(job.customSchema ?? []).filter((f: D) => !f.restricted).map((f: D) => ({ value: f.id, label: f.name }))} />
      {Object.entries(w.handoffPreviews.fields).map(([key, label]) => <Field key={key} label={String(label) + ' destination field'} name={'map-' + key} defaultValue={mapping?.fields.find((f: D) => f.source === key)?.target ?? key} required={false} />)}
    </Form>}
    {mapping && <p>Employer-declared mapping saved. Schema validation remains unverified.</p>}
  </section>
}

export function HandoffPreview({ offer, app, w, mutate }: { offer: D; app: D; w: D; mutate: PageProps['mutate'] }) {
  if (w.actor.agent || offer.status !== 'accepted') return null
  const mapping = w.handoffPreviews.mappings.find((m: D) => m.vacancy === app.vacancy), rows = w.handoffPreviews.records.filter((r: D) => r.offer === offer.id)
  const documents = w.documents.filter((d: D) => d.candidate === app.candidate && (!d.application || d.application === app.id) && !d.restricted)
  return <section aria-label="Employee creation mapping preview" style={{ overflowWrap: 'anywhere' }}><h4>Employee creation mapping preview</h4>
    <p>Local review only. Handoff incomplete. Employee creation is not authorized or verified. Destination readback, tenant identifiers, schema validation and provider contingencies are unknown.</p>
    {!offer.signature && <p>A recorded acceptance alone is unsigned and cannot unlock a mapping preview.</p>}
    {!mapping && <p>Configure employer-declared fields under Settings after selecting administrative preflight fields and an existing nonrestricted custom field.</p>}
    {mapping && offer.signature && <Form label="Prepare employee mapping preview" onSubmit={values => mutate('handoff-preview', { offer: offer.id, mappingRevision: mapping.revision, documents: documents.filter((d: D) => values['doc-' + d.id]).map((d: D) => d.id) })}>
      <p>Signed originals and any native completion certificate are always included. Select additional originals to freeze their stored-byte digests.</p>
      {documents.filter((d: D) => ![offer.signature.document, offer.signature.certificate].includes(d.id)).map((d: D) => <Check key={d.id} name={'doc-' + d.id} label={d.name} />)}
    </Form>}
    {rows.map((row: D) => <article className="card" key={row.id} aria-label={'Frozen employee preview ' + row.id}>
      <h4>{destinations.find(d => d.value === row.snapshot.destination)?.label} · {row.stale ? 'Sources changed; prepare again' : row.reviewValid ? 'Human reviewed; creation not authorized' : 'Human review required'}</h4>
      <p>Declared tenant: {row.snapshot.tenant || 'Missing'} · Not validated.</p>
      <p>{row.snapshot.signature.label}. {row.snapshot.signature.kind === 'outside' ? 'Human attestation only; not provider-verified.' : 'Native completion with intact stored artifacts.'}</p>
      <p>Missing fields: {row.snapshot.missing.length ? row.snapshot.missing.join(', ') : 'None in this local mapping'}. Provider contingencies unknown: {row.snapshot.contingencies.declared || 'None declared; no completion inferred'}.</p>
      <dl>{row.snapshot.fields.map((f: D) => <div key={f.source}><dt>{f.label} → {f.target || 'Destination field missing'}</dt><dd>{show(f.value)}</dd></div>)}</dl>
      <details><summary>Frozen sources and original digests</summary>
        <p>Terms fingerprint <code>{row.snapshot.termsVersion}</code></p>
        {row.snapshot.documents.map((d: D) => <p key={d.id}>{d.name} · SHA-256 <code>{d.sha256}</code> · Artifact revision <code>{d.artifactRevision}</code></p>)}
        {row.snapshot.sources.map((s: D) => <p key={s.kind + s.id}>{s.kind} <code>{s.id}</code> · Revision <code>{s.revision}</code></p>)}
      </details>
      {!row.stale && !row.reviewValid && <Form label="Record human mapping review" onSubmit={values => mutate('handoff-preview-review', { id: row.id, fingerprint: row.fingerprint, ...values })}>
        <Field label="Mapping review reason" name="reason" />
        <Check name="acknowledge" label="This review grants no permission to create an employee or complete a destination" />
      </Form>}
      {row.review && <p>Recorded review: {row.review.reason}. {row.reviewValid ? 'Current snapshot reviewed.' : 'Review invalid; fresh human review required.'}</p>}
    </article>)}
  </section>
}
