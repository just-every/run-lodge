import type { PageProps } from './app'
import { person } from './names'
import { when } from './format'
import { Check, Field, Form, Status, type D } from './shared'
import { FollowUp } from './tasks'

const STAGE = (v: D | undefined, id: string) => v?.stages?.find((s: D) => s.id === id)?.name ?? id

/** One feed line in words: what happened to the candidate, by whom. Scorecards show as submitted, never their content. */
function line(e: D, w: D) {
  const v = w.vacancies.find((x: D) => x.id === w.applications.find((a: D) => a.id === e.application)?.vacancy)
  if (e.kind === 'stage') return `${person(w, e.actor)} moved ${STAGE(v, e.from)} → ${STAGE(v, e.to)}: ${e.reason}`
  if (e.kind === 'email') return `${person(w, e.actor)} ${e.state} an email: ${e.subject}`
  if (e.kind === 'interview') return `${e.title.split(':')[0]} ${e.status}${e.start ? ' for ' + when(e.start) : ''}`
  if (e.kind === 'scorecard') return `${person(w, e.actor)} ${e.corrected ? 'corrected' : 'submitted'} a scorecard`
  if (e.kind === 'offer') return `Offer ${e.status}: ${e.title}`
  return ''
}

/** The candidate's activity feed with the team's shared notes in it, and a note of your own. */
export function Notes({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  const feed = w.activity.filter((e: D) => e.candidate === app.candidate)
  const me = w.actor.email
  return <section className="card">
    <h3>Notes and activity</h3>
    <Form label="Add note" reset onSubmit={x => mutate('team-note', { application: app.id, text: x.text, private: x.private === true })}>
      <Field label="Note for the hiring team" name="text" type="textarea" wide />
      <Check label="Private to admins and this job’s hiring managers" name="private" />
    </Form>
    <FollowUp app={app} w={w} mutate={mutate} />
    {!feed.length && <p className="empty">Nothing has happened on this candidate yet.</p>}
    <ul className="list">{feed.map((e: D, i: number) => e.kind === 'note'
      ? <li key={e.note}><article className="card"><h4>{person(w, e.actor)} · {when(e.at)}{e.private && <> <Status tone="warn">private</Status></>}{e.edited && <> <Status>edited</Status></>}</h4><p className="pre">{e.text}</p>
        {w.teamNotes.find((n: D) => n.id === e.note)?.author === me && <details><summary>Edit</summary><Form label="Save note" onSubmit={x => mutate('team-note', { id: e.note, text: x.text })}><Field label="Note" name="text" type="textarea" wide defaultValue={e.text} /></Form></details>}</article></li>
      : <li key={i}><small>{when(e.at)}</small> {line(e, w)}</li>)}</ul>
  </section>
}
