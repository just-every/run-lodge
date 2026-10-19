import type { PageProps } from './app'
import { person } from './names'
import { Field, Form, Status, memberOptions, type D } from './shared'

const people = (w: D) => memberOptions(w.members.filter((m: D) => !m.agent))
const recruiter = (w: D) => w.actor.owner || w.actor.roles.some((r: string) => ['admin', 'manager'].includes(r))

function due(t: D, today: string) {
  if (t.due < today) return <Status tone="alert">overdue · {t.due}</Status>
  if (t.due === today) return <Status tone="warn">due today</Status>
  return <Status>due {t.due}</Status>
}

/** Home: the follow-ups and tasks the actor owns, those they set for others, and a new task for recruiters. */
export function Tasks({ w, mutate, go }: Pick<PageProps, 'w' | 'mutate' | 'go'>) {
  const me = w.actor.email, today = new Date().toLocaleDateString('en-CA', { timeZone: w.business?.timeZone || 'UTC' })
  const open = w.tasks.filter((t: D) => t.status === 'open'), mine = open.filter((t: D) => t.owner === me), set = open.filter((t: D) => t.owner !== me)
  const who = (t: D) => t.application ? w.applications.find((a: D) => a.id === t.application)?.candidateName : w.candidates.find((c: D) => c.id === t.candidate)?.name
  const row = (t: D, owner: boolean) => <li key={t.id}><span><strong>{t.note}</strong><small>{[who(t), t.kind === 'task' ? 'task' : 'follow-up', owner ? (t.createdBy !== me ? 'from ' + person(w, t.createdBy) : '') : 'for ' + person(w, t.owner)].filter(Boolean).join(' · ')}</small></span>{due(t, today)}
    {t.application && <button className="link" onClick={() => go('Applications', { app: t.application, job: undefined })}>Open</button>}
    <button onClick={() => mutate('complete-task', { id: t.id })}>Done</button></li>
  if (!mine.length && !set.length && !recruiter(w)) return null
  return <section className="card"><h2>Your follow-ups and tasks</h2>
    {mine.length ? <ul className="list rich">{mine.map((t: D) => row(t, true))}</ul> : <p className="empty">Nothing on your list.</p>}
    {set.length > 0 && <><h3>Set for others</h3><ul className="list rich">{set.map((t: D) => row(t, false))}</ul></>}
    {recruiter(w) && <details><summary>New task</summary><Form label="Add task" reset onSubmit={x => mutate('task', { kind: 'task', note: x.note, due: x.due, owner: x.owner })}>
      <Field label="Task" name="note" hint="For example: call references" /><Field label="Due" name="due" type="date" /><Field label="Owner" name="owner" defaultValue={me} options={people(w)} />
    </Form></details>}
  </section>
}

/** On an application: set a follow-up (or, for recruiters, a task) with a date, note and owner. */
export function FollowUp({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  if (app.status !== 'active') return null
  return <details><summary>Set a follow-up</summary><Form label="Save follow-up" reset onSubmit={x => mutate('task', { application: app.id, kind: x.kind || 'follow-up', note: x.note, due: x.due, owner: x.owner })}>
    <Field label="Note" name="note" /><Field label="Due" name="due" type="date" /><Field label="Owner" name="owner" defaultValue={w.actor.email} options={people(w)} />
    {recruiter(w) && <Field label="Kind" name="kind" required={false} defaultValue="follow-up" options={[{ value: 'follow-up', label: 'Follow-up reminder' }, { value: 'task', label: 'Task' }]} />}
  </Form></details>
}
