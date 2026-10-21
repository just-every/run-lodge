import { useState } from 'react'
import type { PageProps } from './app'
import { day } from './format'
import { Check, Field, Form, Status, Table, type D } from './shared'

// MIG-008: move an imported job's still-open applications into a live job. Preview first (it writes nothing), then
// approve that exact preview; undo removes what nobody has touched.

/** The owner's cutover tool, on the move-in screen. */
export function Cutover({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const sources = w.vacancies.filter((v: D) => v.imported && w.applications.some((a: D) => a.vacancy === v.id && a.status === 'imported' && a.outcome === 'open-in-source'))
  const targets = w.vacancies.filter((v: D) => !v.imported && v.manages && ['draft', 'open'].includes(v.status))
  const [job, setJob] = useState(sources[0]?.id ?? ''), [target, setTarget] = useState(''), [shown, setShown] = useState<D | null>(null), [draft, setDraft] = useState<D | null>(null)
  const source = sources.find((v: D) => v.id === job), live = targets.find((v: D) => v.id === target)
  const stages = [...new Set(w.applications.filter((a: D) => a.vacancy === job && a.status === 'imported' && a.outcome === 'open-in-source').map((a: D) => a.sourceStage as string))] as string[]
  const cutovers = (w.cutovers ?? []) as D[]
  if (!sources.length && !cutovers.length) return null
  const body = (x: D) => ({
    importedJob: job, target, stages: Object.fromEntries(stages.map((name, i) => [name, x['stage' + i]]).filter(([, id]) => id)), approval: x.approval, contactBasis: x.contactBasis,
    ...(x.contactBasis === 'application' ? { attest: x.attest === true, contactNote: x.contactNote } : {}), ...(x.sourceUrl ? { sourceUrl: x.sourceUrl } : {}),
  })
  return <section className="card" aria-label="Cutover">
    <h2>Move open applications into a live job</h2>
    <p className="hint">Prepare the live job first (stages, rubric, interview plan and terms). Lodge previews what moves and writes nothing; approving that exact preview creates live applications, sends nothing and leaves the imported record as history.</p>
    {sources.length > 0 && <>
      <label>Imported job<select value={job} onChange={e => { setJob(e.target.value); setShown(null) }}>{sources.map((v: D) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
      <label>Live job<select value={target} onChange={e => { setTarget(e.target.value); setShown(null) }}><option value="">Choose…</option>{targets.map((v: D) => <option key={v.id} value={v.id}>{v.title} ({v.status})</option>)}</select></label>
      {live && <Form label="Preview cutover" onSubmit={async x => { const b = body(x); setDraft(b); setShown(await mutate('cutover-preview', b)) }}>
        {stages.map((name, i) => <Field key={name} label={`Source stage “${name}” becomes`} name={'stage' + i} options={live.stages.map((s: D) => ({ value: s.id, label: s.name }))} />)}
        <Field label="The job’s approval" name="approval" defaultValue="fresh" options={[{ value: 'fresh', label: 'Needs a fresh approval before it publishes' }, ...(String(source?.sourceApproval).toLowerCase() === 'approved' ? [{ value: 'adopt', label: 'Adopt the source’s approval of these exact terms' }] : [])]} />
        <Field label="Contacting these people" name="contactBasis" defaultValue="none" options={[{ value: 'none', label: 'Not contactable until a basis is recorded' }, { value: 'application', label: 'They applied at the source; continuing is permitted' }]} />
        <Field label="How they applied and why contacting them is permitted (if permitted)" name="contactNote" type="textarea" required={false} wide />
        <Check label="I confirm continuing these applications is permitted" name="attest" />
        <Field label="Old job web address (keeps old links working)" name="sourceUrl" type="url" required={false} />
      </Form>}
      {shown && draft && <section className="card" aria-label="Cutover preview">
        <h3>Preview</h3>
        <p>{shown.counts.moving} to move · {shown.counts.setAside} set aside · {shown.counts.closedHistory} closed and kept as history · nothing is sent</p>
        <Table heads={['Person', 'Source stage', 'Result']}>{[...shown.moving.map((m: D) => <tr key={m.from}><td>{m.name}</td><td>{m.sourceStage}</td><td>{live?.stages.find((s: D) => s.id === m.stage)?.name}</td></tr>), ...shown.setAside.map((m: D) => <tr key={m.from}><td>{m.name}</td><td>{m.sourceStage}</td><td>Set aside: {m.reason}</td></tr>)]}</Table>
        <button className="primary" disabled={!shown.counts.moving} onClick={() => mutate('cutover', { ...draft, fingerprint: shown.fingerprint }).then(() => setShown(null))}>Approve this cutover</button>
      </section>}
    </>}
    {cutovers.length > 0 && <><h3>Cutovers</h3>
      <Table heads={['Job', 'Moved', 'State', '']}>{cutovers.map(c => <tr key={c.id}><td>{w.vacancies.find((v: D) => v.id === c.target)?.title ?? 'Live job'}</td><td>{c.moved.length} · {day(c.at)}</td><td><Status tone={c.status === 'active' ? 'good' : 'neutral'}>{c.status === 'active' ? 'live' : `undone (${c.undone.removed.length} removed, ${c.undone.kept.length} kept live)`}</Status></td><td>{c.status === 'active' && <button onClick={() => mutate('cutover-undo', { id: c.id })}>Undo</button>}</td></tr>)}</Table></>}
  </section>
}
