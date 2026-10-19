import { useEffect, useState } from 'react'
import type { PageProps } from './app'
import { person } from './names'
import { when } from './format'
import { call, Field, Form, Status, type D } from './shared'

const LABELS: D = { 'strong-no': 'Strong no', no: 'No', yes: 'Yes', 'strong-yes': 'Strong yes' }

/** One interview's kit, opened from its calendar invitation: what to ask, what it assesses, and its own scorecard. */
export function Kit({ id, w, mutate, close }: { id: string; w: D; mutate: PageProps['mutate']; close: () => void }) {
  const [kit, setKit] = useState<D>(), [error, setError] = useState('')
  const load = () => call('kit/' + id).then(setKit, e => setError(e.message))
  useEffect(() => { load() }, [id])
  if (error) return <div className="page narrow"><h1>Interview kit</h1><p role="alert">{error}</p><button onClick={close}>Back to the workspace</button></div>
  if (!kit) return <div className="page narrow"><p>Opening the interview kit…</p></div>
  const card = kit.scorecard, open = !card || card.status !== 'submitted'
  return <div className="page narrow">
    <p><button className="link" onClick={close}>Back to the workspace</button></p>
    <h1>Interview kit: {kit.interview.title.split(':')[0]}</h1>
    <p className="lead">{kit.candidate.name} · {kit.vacancy.title}{kit.interview.start ? ` · ${when(kit.interview.start)}` : ''} · {kit.interview.durationMinutes} min{kit.interview.location ? ` · ${kit.interview.location}` : ''}</p>
    {kit.purpose && <section className="card"><h2>Purpose</h2><p className="pre">{kit.purpose}</p></section>}
    <section className="card"><h2>What this interview assesses</h2><ul>{kit.focus.map((c: D) => <li key={c.id}><strong>{c.name}</strong>: {c.description}</li>)}</ul></section>
    <section className="card"><h2>Questions</h2>{kit.questions.length ? <ol>{kit.questions.map((q: D, i: number) => <li key={i}><strong>{q.text}</strong>{q.guidance && <p className="hint">{q.guidance}</p>}</li>)}</ol> : <p className="empty">No questions written for this interview.</p>}</section>
    <section className="card"><h2>Resume and documents</h2>{kit.resume.length ? <ul>{kit.resume.map((d: D) => <li key={d.id}><a href={`/api/lodge/download/document/${d.id}`}>{d.name}</a></li>)}</ul> : <p className="empty">No documents you can open.</p>}</section>
    {kit.feedback && <section className="card"><h2>Released feedback</h2><p>{Object.entries(kit.feedback.counts).map(([r, n]) => `${LABELS[r]} ${n}`).join(' · ')}</p></section>}
    <section className="card"><h2>Your scorecard for this interview</h2>
      {!open && <p>{LABELS[card.recommendation]} <Status tone="good">submitted {when(card.submittedAt)}</Status></p>}
      {open && kit.interview.participants.includes(w.actor.email) && <Form label="Save scorecard" onSubmit={async x => { await mutate('scorecard', { application: kit.application, interview: kit.interview.id, submit: x.submit === true, recommendation: x.recommendation || undefined, takeaways: x.takeaways, ratings: Object.fromEntries(kit.focus.map((k: D) => [k.id, x['rating-' + k.id] || null])), evidence: Object.fromEntries(kit.focus.map((k: D) => [k.id, x['evidence-' + k.id]])) }); await load() }}>
        {kit.focus.map((k: D) => <fieldset key={k.id} className="wide"><legend>{k.name}</legend>
          <Field label={`Kit rating for ${k.name} (1–4)`} name={'rating-' + k.id} required={false} defaultValue={card?.ratings?.[k.id] ?? ''} options={['1', '2', '3', '4'].map(n => ({ value: n, label: n }))} />
          <Field label={`Kit evidence for ${k.name}`} name={'evidence-' + k.id} type="textarea" required={false} defaultValue={card?.evidence?.[k.id]} /></fieldset>)}
        <Field label="Overall call" name="recommendation" required={false} defaultValue={card?.recommendation ?? ''} options={Object.entries(LABELS).map(([value, label]) => ({ value, label: label as string }))} />
        <Field label="Your take-aways" name="takeaways" type="textarea" required={false} defaultValue={card?.takeaways} />
        <label className="check wide"><input type="checkbox" name="submit" /> Submit this interview’s scorecard</label>
      </Form>}
      {open && !kit.interview.participants.includes(w.actor.email) && <p className="empty">Panel: {kit.interview.participants.map((p: string) => person(w, p)).join(', ')}.</p>}
    </section>
  </div>
}
