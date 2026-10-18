import { useState, type FormEvent } from 'react'
import type { PageProps } from '../app'
import { since, when } from '../format'
import { person, sentence } from '../names'
import { Field, Form, memberOptions, Status, type D } from '../shared'
import { Exception } from './exception'
import { lastMove, openProposals, proposalApplication, stageName } from './facts'

const OUTCOMES: D = { disqualified: 'disqualified', 'open-in-source': 'still open in Workable' }

/** Advance to the next stage or reject, each with the reason the history keeps; any other move sits behind it. */
function Decide({ app, v, w, mutate }: { app: D; v?: D; w: D; mutate: PageProps['mutate'] }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const at = v?.stages.findIndex((s: D) => s.id === app.stage) ?? -1, next = v?.stages[at + 1]
  const jobs = w.vacancies.filter((j: D) => j.manages && j.status === 'open' && j.id !== app.vacancy)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget, to = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value
    setBusy(true); setError('')
    try { await mutate('move', { application: app.id, to, reason: (form.elements.namedItem('reason') as HTMLInputElement).value }); form.reset() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <section className="decide">
    <h3>Decide</h3>
    <form className="bare" onSubmit={submit}>
      <label>Reason (kept in the history)<input name="reason" required /></label>
      <div className="form-end">{next && <button className="primary" name="to" value={next.id} disabled={busy}>Advance to {next.name}</button>}<button className="secondary" name="to" value="rejected" disabled={busy}>Reject</button>{error && <p role="alert">{error}</p>}</div>
    </form>
    <details><summary>Other moves</summary>
      <Form label="Move" compact reset onSubmit={x => mutate('move', { application: app.id, to: x.to, reason: x.reason })}>
        <Field label="Move to" name="to" options={[...(v?.stages ?? []).filter((s: D) => s.id !== app.stage).map((s: D) => ({ value: s.id, label: s.name })), { value: 'rejected', label: 'Not progressing (close)' }, { value: 'withdrawn', label: 'Candidate withdrew (close)' }]} />
        <Field label="Reason (kept in the history)" name="reason" />
      </Form>
      {jobs.length > 0 && <Form label="Transfer" compact reset onSubmit={x => mutate('transfer', { application: app.id, vacancy: x.vacancy, reason: x.reason })}>
        <Field label="Transfer to another job" name="vacancy" options={jobs.map((j: D) => ({ value: j.id, label: j.title }))} />
        <Field label="Reason (optional)" name="reason" required={false} />
      </Form>}
    </details>
  </section>
}

export function RecordOverview({ app, v, c, w, mutate }: { app: D; v?: D; c: D; w: D; mutate: PageProps['mutate'] }) {
  const imported = w.importedHistory
  const waiting = openProposals(w).filter((p: D) => proposalApplication(p) === app.id)
  const active = app.status === 'active'
  return <>
    {waiting.length > 0 && <Exception proposals={waiting} app={app} v={v} w={w} mutate={mutate} />}
    <p className="record-status"><Status tone={active ? 'good' : 'neutral'}>{active ? stageName(v, app.stage) : stageName(v, app.status)}</Status>{active && <span className="muted">for {since(lastMove(app))} · received {when(app.submittedAt) || app.submittedAt}</span>}</p>
    <p className="meta">{[c.email, c.phone, c.location].filter(Boolean).join(' · ') || 'Contact details are visible to the hiring team only.'}</p>
    {c.headline && <p>{c.headline}</p>}
    {app.coverNote && <details><summary>Cover note</summary><p className="pre">{app.coverNote}</p></details>}
    {app.imported && <p className="hint">Imported from Workable: source stage “{app.sourceStage}”, {OUTCOMES[app.outcome] ?? app.outcome}{app.disqualificationReason ? ` (${app.disqualificationReason})` : ''}.</p>}
    {app.manages && active && <Decide app={app} v={v} w={w} mutate={mutate} />}
    {app.manages && ['rejected', 'withdrawn'].includes(app.status) && <Form label="Reopen" compact reset onSubmit={x => mutate('reopen', { application: app.id, to: x.to, reason: x.reason })}>
      <Field label="Reopen into" name="to" options={(v?.stages ?? []).map((s: D) => ({ value: s.id, label: s.name }))} />
      <Field label="Reason (kept in the history)" name="reason" />
    </Form>}
    <h3>History</h3>
    <ol className="history">{app.history.map((e: D) => <li key={e.id}><strong>{e.reopened ? 'Reopened into ' : ''}{stageName(v, e.to)}</strong><span>{when(e.at)} · {person(w, e.actor)}</span><span>{e.reason}</span></li>)}</ol>
    {app.earlier?.map((x: D) => <details key={x.application}><summary>Earlier on {x.title}</summary><ol className="history">{x.history.map((e: D) => <li key={e.id}><strong>{stageName(w.vacancies.find((j: D) => j.id === x.vacancy), e.to)}</strong><span>{when(e.at)} · {person(w, e.actor)}</span><span>{e.reason}</span></li>)}</ol></details>)}
    {app.manages && active && <Form label="Save reviewers" compact onSubmit={x => mutate('assign-reviewers', { application: app.id, reviewers: x.reviewers.split(',').map((r: string) => r.trim()).filter(Boolean) })}>
      <Field label="Reviewers (emails, comma separated)" name="reviewers" required={false} defaultValue={app.reviewers.join(', ')} hint={'Interviewers available: ' + memberOptions(w.members, 'interviewer').map(m => m.value).join(', ')} />
    </Form>}
    {['notes', 'ratings', 'messages'].some(k => imported[k].some((n: D) => n.application === app.id)) && <><h3>Imported history</h3><ul className="plain">
      {imported.notes.filter((n: D) => n.application === app.id).map((n: D) => <li key={n.id}>Comment · {n.createdAt}: {n.body}</li>)}
      {imported.ratings.filter((n: D) => n.application === app.id).map((n: D) => <li key={n.id}>Rating · {n.stage}: {n.verdict} {n.scoreCard}</li>)}
      {imported.messages.filter((n: D) => n.application === app.id).map((n: D) => <li key={n.id}>{sentence(n.direction)} · {n.createdAt}: {n.subject}</li>)}
    </ul></>}
  </>
}
