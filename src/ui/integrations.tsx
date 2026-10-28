import { useEffect, useState } from 'react'
import { call, Check, Field, Form, type D } from './shared'

/** A small Settings form using the existing workspace controls. */
export function Integrations() {
  const [view, setView] = useState<D>(), [issued, setIssued] = useState<D>(), [error, setError] = useState('')
  async function reload() { setView(await call('integrations')) }
  useEffect(() => { reload().catch(e => setError(e.message)); return () => { setIssued(undefined) } }, [])
  const manage = async (path: string, input: D) => {
    setIssued(undefined)
    const result = await call('integrations' + path, input)
    setIssued(result); await reload()
  }
  return <section className="card" aria-label="Application integrations">
    <h2>Application integrations</h2>
    <p>Read-only access to selected jobs, bounded by your current hiring permissions and authorizing sign-in. App credentials never approve, change records or read protected material.</p>
    {error && <p role="alert">{error}</p>}
    {view && <>
      <Form label="Create app credential" onSubmit={x => manage('', { name: x.name, jobs: [x.job], fields: ['identity', 'contact'].filter(f => x[f]) })}>
        <Field label="Integration name" name="name" />
        <Field label="Integration job" name="job" options={view.jobs.map((j: D) => ({ value: j.id, label: j.title }))} />
        <Check label="Allow candidate names" name="identity" />
        <Check label="Allow current contact details" name="contact" />
      </Form>
      {issued?.token && <section aria-label="New app credential"><h3>Save this credential now</h3><p>Shown once. Keep it in your application’s private configuration.</p><label>App credential<input readOnly type="password" autoComplete="off" value={issued.token} onFocus={e => e.currentTarget.select()} /></label><button onClick={() => setIssued(undefined)}>Dismiss credential</button></section>}
      <h3>Your integrations</h3>
      {!view.credentials.length && <p>No app credentials created.</p>}
      {view.credentials.map((credential: D) => <section key={credential.id} aria-label={'Integration ' + credential.name}>
        <h4>{credential.name}</h4>
        <p>{credential.revokedAt ? 'Revoked' : 'Authorized'} · Jobs: {credential.jobs.map((id: string) => view.jobs.find((j: D) => j.id === id)?.title ?? 'Unavailable job').join(', ')} · Fields: application summary{credential.fields.map((f: string) => ', ' + f).join('')}</p>
        {!credential.revokedAt && <><Form label={'Rotate ' + credential.name} onSubmit={() => manage('/' + credential.id + '/rotate', { revision: credential.revision })} /><Form label={'Revoke ' + credential.name} onSubmit={() => manage('/' + credential.id + '/revoke', { revision: credential.revision })} /></>}
      </section>)}
    </>}
  </section>
}
