import type { PageProps } from './app'
import { person, sentence } from './names'
import { Field, Form, memberOptions, Status, Table, when, type D } from './shared'
import { Interviews } from './interviews'
import { ScorecardForm, Scorecards } from './scorecards'
import { Messages, Offers } from './decisions'
import { Documents } from './documents'

const stageName = (v: D | undefined, id: string) => id === 'hired' || id === 'rejected' || id === 'withdrawn' ? sentence(id) : v?.stages.find((s: D) => s.id === id)?.name ?? id ?? 'Received'
const OUTCOMES: D = { disqualified: 'disqualified', 'open-in-source': 'still open in Workable' }

function Detail({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  const v = w.vacancies.find((x: D) => x.id === app.vacancy)
  const c = w.candidates.find((x: D) => x.id === app.candidate) ?? { name: app.candidateName }
  const imported = w.importedHistory
  return <section className="record" aria-label={`Application of ${c.name}`}>
    <h2>{c.name} · {v?.title} <Status tone={app.status === 'active' ? 'good' : 'neutral'}>{app.status === 'active' ? stageName(v, app.stage) : sentence(app.status)}</Status></h2>
    <p className="meta">{[c.email, c.phone, c.location].filter(Boolean).join(' · ') || 'Contact details are visible to the hiring team only.'}</p>
    <div className="split"><div>
    {c.headline && <p>{c.headline}</p>}
    {app.coverNote && <details><summary>Cover note</summary><p className="pre">{app.coverNote}</p></details>}
    {app.imported && <p className="hint">Imported from Workable: source stage “{app.sourceStage}”, {OUTCOMES[app.outcome] ?? app.outcome}{app.disqualificationReason ? ` (${app.disqualificationReason})` : ''}.</p>}
    <h3>History</h3>
    <ol className="history">{app.history.map((e: D) => <li key={e.id}><strong>{stageName(v, e.to)}</strong><span>{when(e.at)} · {person(w, e.actor)}</span><span>{e.reason}</span></li>)}</ol>
    {app.manages && app.status === 'active' && <>
      <h3>Move</h3>
      <Form label="Move" compact reset onSubmit={x => mutate('move', { application: app.id, to: x.to, reason: x.reason })}>
        <Field label="Move to" name="to" options={[...(v?.stages ?? []).filter((s: D) => s.id !== app.stage).map((s: D) => ({ value: s.id, label: s.name })), { value: 'rejected', label: 'Not progressing (close)' }, { value: 'withdrawn', label: 'Candidate withdrew (close)' }]} />
        <Field label="Reason (kept in the history)" name="reason" />
      </Form>
      <Form label="Save reviewers" compact onSubmit={x => mutate('assign-reviewers', { application: app.id, reviewers: x.reviewers.split(',').map((r: string) => r.trim()).filter(Boolean) })}>
        <Field label="Reviewers (emails, comma separated)" name="reviewers" required={false} defaultValue={app.reviewers.join(', ')} hint={'Interviewers available: ' + memberOptions(w.members, 'interviewer').map(m => m.value).join(', ')} />
      </Form>
    </>}
    <Documents app={app} w={w} mutate={mutate} />
    <ScorecardForm app={app} v={v} w={w} mutate={mutate} />
    {['notes', 'ratings', 'messages'].some(k => imported[k].some((n: D) => n.application === app.id)) && <><h3>Imported history</h3><ul>
      {imported.notes.filter((n: D) => n.application === app.id).map((n: D) => <li key={n.id}>Comment · {n.createdAt}: {n.body}</li>)}
      {imported.ratings.filter((n: D) => n.application === app.id).map((n: D) => <li key={n.id}>Rating · {n.stage}: {n.verdict} {n.scoreCard}</li>)}
      {imported.messages.filter((n: D) => n.application === app.id).map((n: D) => <li key={n.id}>{n.direction} · {n.createdAt}: {n.subject}</li>)}
    </ul></>}
    </div><aside aria-label="Interviews, scorecards and decisions">
    <Interviews app={app} v={v} w={w} mutate={mutate} />
    <Scorecards app={app} v={v} w={w} mutate={mutate} />
    {app.manages && <><Messages app={app} w={w} mutate={mutate} /><Offers app={app} v={v} w={w} mutate={mutate} /></>}
    </aside></div>
  </section>
}

export function Applications({ w, mutate, open, setOpen }: PageProps & { open: string | null; setOpen: (id: string | null) => void }) {
  const app = w.applications.find((a: D) => a.id === open)
  const byVacancy = w.vacancies.filter((v: D) => w.applications.some((a: D) => a.vacancy === v.id))
  return <>
    <h1>Applications</h1>
    {app && <Detail app={app} w={w} mutate={mutate} />}
    {!w.applications.length && <p className="empty">No applications you can see yet.</p>}
    {byVacancy.map((v: D) => <section key={v.id}><h2>{v.title}</h2>
      <Table heads={['Candidate', 'Stage', 'Received', 'Panel', '']}>{w.applications.filter((a: D) => a.vacancy === v.id).map((a: D) => <tr key={a.id}>
        <td>{a.candidateName}</td><td>{a.status === 'active' ? stageName(v, a.stage) : sentence(a.status)}</td><td>{when(a.submittedAt) || a.submittedAt}</td>
        <td>{a.panel ? `${a.panel.filter((p: D) => p.submitted).length}/${a.panel.length} scorecards` : ''}</td>
        <td><button aria-label={'Open ' + a.candidateName} onClick={() => setOpen(a.id)}>Open</button></td></tr>)}</Table></section>)}
  </>
}
