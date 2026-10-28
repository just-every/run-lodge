import { useState } from 'react'
import { call, Check, Field, Form, type D } from './shared'

/** Clear the transient fragment before any workspace request or navigation. */
export function takeProspectHandoff(): D | null {
  if (!location.hash.startsWith('#lodge-capture=')) return null
  const raw = location.hash.slice('#lodge-capture='.length)
  history.replaceState(null, '', '/app?capture=1')
  try {
    const value = JSON.parse(decodeURIComponent(raw))
    if (!value || typeof value !== 'object' || Array.isArray(value) || raw.length > 16000) return { invalid: true }
    const fields: D = {}
    for (const key of ['captureId', 'sourceURL', 'name', 'email', 'phone', 'location', 'headline']) fields[key] = typeof value[key] === 'string' ? value[key] : ''
    return fields
  } catch { return { invalid: true } }
}

export function ProspectCapture({ handoff, destinations, close, clearHandoff }: { handoff: D | null; destinations: D; close: () => void; clearHandoff: () => void }) {
  const [preview, setPreview] = useState<D | null>(null), [done, setDone] = useState<D | null>(null)
  if (done) return <section className="page" aria-label="Prospect capture"><h1>Prospect saved</h1><p>The source and sourcer credit are recorded. No message was sent.</p><button onClick={close}>Return to workspace</button></section>
  if (!handoff || handoff.invalid) return <section className="page"><h1>Start a new capture</h1><p>Open the extension on a source page after signing in. Pending details are discarded when this page closes.</p><button onClick={close}>Return to workspace</button></section>
  return <section className="page" aria-label="Prospect capture">
    <h1>Review prospect</h1><p>These untrusted details came from a web page. Review the source and consent basis before adding anything.</p>
    {!preview ? <Form label="Check duplicates" onSubmit={async x => setPreview(await call('prospect-capture/preview', { ...handoff, ...x }))}>
      <Field label="Name" name="name" defaultValue={handoff.name} />
      <Field label="Email" name="email" type="email" required={false} defaultValue={handoff.email} />
      <Field label="Phone" name="phone" required={false} defaultValue={handoff.phone} />
      <Field label="Location" name="location" required={false} defaultValue={handoff.location} />
      <Field label="Headline" name="headline" required={false} defaultValue={handoff.headline} />
      <Field label="Source page URL" name="sourceURL" defaultValue={handoff.sourceURL} wide />
      <Field label="Add to" name="vacancy" defaultValue={destinations.poolAllowed ? 'pool' : ''} options={[...(destinations.poolAllowed ? [{ value: 'pool', label: 'Native talent pool' }] : []), ...destinations.jobs.map((j: D) => ({ value: j.id, label: j.title }))]} />
      <Field label="Basis for keeping their details" name="consentBasis" options={[{ value: 'manual', label: 'Other recorded basis' }, { value: 'talent-pool', label: 'They asked to join the talent pool' }, { value: 'referral', label: 'Referral with their agreement' }]} />
      <Field label="Consent basis evidence" name="consentNote" type="textarea" wide />
      <Check name="talentPool" label="They agreed to contact about other roles" />
    </Form> : <>
      <article className="card"><h2>{preview.fields.name}</h2><p>{[preview.fields.email, preview.fields.phone, preview.fields.location, preview.fields.headline].filter(Boolean).join(' · ')}</p><p className="wrap">Source: {preview.fields.sourceURL}</p><p>Consent basis: {preview.fields.consentBasis} · {preview.fields.consentNote}</p><p>Destination: {destinations.jobs.find((j: D) => j.id === preview.fields.vacancy)?.title ?? 'Native talent pool'}</p></article>
      <h2>Duplicate review</h2><p>Only matches you already have contact authority to read are shown. A match grants no access. Existing details are preserved; people are never merged.</p>
      <Form label="Confirm prospect" onSubmit={async x => {
        const decisions = preview.duplicates.map((d: D) => ({ id: d.id, decision: x['duplicate-' + d.id] }))
        const saved = await call('prospect-capture/confirm', { ...preview.fields, expires: preview.expires, token: preview.token, decisions, confirmed: x.confirmed })
        setPreview(null); clearHandoff(); setDone(saved)
      }}>
        {preview.duplicates.length === 0 && <p>No matches within your current contact authority.</p>}
        {preview.duplicates.map((d: D) => <Field key={d.id} name={'duplicate-' + d.id} label={d.name + ' · ' + d.reasons.join(', ')} options={[{ value: 'existing', label: 'Use this existing person without changing their details' }, { value: 'distinct', label: 'Different person: keep separate' }]} />)}
        <Check name="confirmed" label="I reviewed the details, consent basis and every visible duplicate" />
      </Form><button className="secondary" onClick={() => setPreview(null)}>Edit details</button>
    </>}
    <button className="secondary" onClick={close}>Cancel capture</button>
  </section>
}

export function CaptureSettings() {
  return <section className="card" aria-label="Prospect capture settings"><h2>Prospect capture</h2><p>Load the unpacked extension from the installation source's extensions directory in Chromium's extension settings. Sign in here before capturing. Use this installation origin in the popup.</p><p>Supports explicit selection or typed fields from ordinary web pages. LinkedIn, inbox add-ons, Edge and packaged distribution are not qualified.</p></section>
}
