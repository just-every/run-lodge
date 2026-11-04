import type { PageProps } from './app'
import { Check, Field, Form, type D } from './shared'

const boundary = 'Local evidence only. Not submitted to or approved by Checkr. No provider order, result or hiring decision is created.'

export function BackgroundAuthorizationSettings({ w, nav, mutate }: PageProps) {
  const app = w.applications.find((a: D) => a.id === nav.app)
  if (!app || !w.backgroundAuthorizations?.editable.includes(app.id)) return null
  const r = w.backgroundAuthorizations.records.find((r: D) => r.application === app.id), v = r?.versions.at(-1)
  return <section className="card" aria-label="Background authorization settings"><h2>Background authorization settings</h2><p>Optional request for {app.candidateName}. {boundary} The employer must record legal and retention review before presenting the exact wording.</p>
    <Form key={app.id + ':' + (v?.version ?? 0)} label="Review and present authorization" onSubmit={x => mutate('background-authorization-review', { ...x, application: app.id, version: v?.version ?? 0 })}>
      <Field label="Employer disclosure" name="disclosure" type="textarea" defaultValue={v?.disclosure} wide />
      <Field label="Employer authorization" name="authorization" type="textarea" defaultValue={v?.authorization} wide />
      <Field label="Purpose" name="purpose" defaultValue={v?.purpose} />
      <Field label="Intended check scope" name="checkScope" defaultValue={v?.checkScope} />
      <Field label="Reviewed application language" name="language" defaultValue={app.language ?? 'en'} />
      <Field label="Employer legal review record" name="legalReview" type="textarea" />
      <Field label="Retention review record" name="retentionReview" type="textarea" />
      <Check label="Employer reviewed this exact disclosure and authorization" name="reviewed" />
    </Form><p><a href={'/app?application=' + app.id}>Back to application</a></p>
  </section>
}

export function BackgroundAuthorization({ app, w }: { app: D; w: D }) {
  const view = w.backgroundAuthorizations
  if (!view) return null
  const r = view.records.find((r: D) => r.application === app.id)
  if (!r && !view.editable.includes(app.id)) return null
  return <section className="card" aria-label="Background authorization"><h3>Background authorization</h3><p>{boundary}</p>
    {view.editable.includes(app.id) && <p><a href={'/app?settings=background-authorization&application=' + app.id}>Background authorization settings</a></p>}
    {!r ? <p>No request presented.</p> : <><p>Current response: {r.state}{r.historical ? ' · Historical restored evidence' : ''}</p>
      {r.versions.map((v: D) => <details key={v.version}><summary>Disclosure and authorization version {v.version}</summary><p>Reviewed language: {v.language}</p><p>Purpose: {v.purpose}</p><p>Intended check scope: {v.checkScope}</p><p className="pre">{v.disclosure}</p><p className="pre">{v.authorization}</p><p>Legal review: {v.legalReview}</p><p>Retention review: {v.retentionReview}</p><p>Reviewed {v.reviewedAt}</p><ul>{r.history.filter((e: D) => e.version === v.version).map((e: D) => <li key={e.responseId}>{e.action} · {e.at}</li>)}</ul></details>)}
      <p>Included in the authorized candidate access export. No local record authorizes an order.</p></>}
  </section>
}
