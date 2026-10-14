import type { PageProps } from './app'
import { person } from './names'
import { Field, Form, Status, when, type D } from './shared'

const LABELS: D = { 'strong-no': 'Strong no', no: 'No', yes: 'Yes', 'strong-yes': 'Strong yes' }

interface Props { app: D; v?: D; w: D; mutate: PageProps['mutate'] }

/** What the actor's own scoring of this application stands on: the rubric, their card and their part on the panel. */
function scoring({ app, v, w }: Props) {
  const rubric = v?.rubrics?.find((r: D) => r.version === app.rubricVersion)
  const me = w.actor.email
  const mine = w.scorecards.find((c: D) => c.application === app.id && c.author === me && !c.interview) ?? w.scorecards.find((c: D) => c.application === app.id && c.author === me)
  const onPanel = app.reviewers.includes(me) || w.interviews.some((i: D) => i.application === app.id && i.participants.includes(me)) || app.manages
  return { rubric, me, mine, writing: !app.imported && onPanel && app.status === 'active' && rubric && mine?.status !== 'submitted' }
}

/** The rail: the panel's progress, the cards the actor may read, and releasing feedback. */
export function Scorecards(props: Props) {
  const { app, w, mutate } = props
  if (app.imported) return null
  const { rubric, me, mine } = scoring(props)
  const others = w.scorecards.filter((c: D) => c.application === app.id && c.author !== me)
  return <section className="card">
    <h3>Scorecards</h3>
    {app.panel && <p>Panel: {app.panel.map((p: D) => `${person(w, p.email)} ${p.submitted ? '✓ submitted' : '· waiting'}`).join('; ') || 'nobody assigned yet'}. {app.feedbackReleased ? 'Feedback is visible to the panel.' : 'Each scorecard stays private to its author until you release feedback.'}</p>}
    {!app.panel && !others.length && mine?.status !== 'submitted' && <p className="empty">No scorecards you can see yet.</p>}
    {others.map((c: D) => <article key={c.id} className="card"><h4>{person(w, c.author)} · {LABELS[c.recommendation]} <Status tone={c.status === 'submitted' ? 'good' : 'neutral'}>{c.status}</Status></h4><ul>{rubric?.criteria.map((k: D) => <li key={k.id}>{k.name}: {c.ratings[k.id] ?? 'not rated'}{c.evidence[k.id] ? ` · ${c.evidence[k.id]}` : ''}</li>)}</ul>{c.notes && <p className="pre">{c.notes}</p>}</article>)}
    {mine?.status === 'submitted' && <article className="card"><h4>Your scorecard · {LABELS[mine.recommendation]} <Status tone="good">submitted {when(mine.submittedAt)}</Status></h4><ul>{rubric?.criteria.map((k: D) => <li key={k.id}>{k.name}: {mine.ratings[k.id] ?? 'not rated'} · {mine.evidence[k.id]}</li>)}</ul></article>}
    {app.manages && !app.feedbackReleased && <Form label="Release feedback to the panel" compact onSubmit={x => mutate('release-feedback', { application: app.id, reason: x.reason })}><Field label="Reason (required if someone has not submitted)" name="reason" required={false} /></Form>}
  </section>
}

/** Beside the record: the actor's own scorecard while they write it, and their private interview notes. */
export function ScorecardForm(props: Props) {
  const { app, w, mutate } = props
  const { rubric, mine, writing } = scoring(props)
  if (!writing) return null
  const notes = w.notes.filter((n: D) => n.application === app.id)
  return <section className="scoring">
    <h3>Your scorecard <span className="nowrap">(rubric version {rubric.version})</span></h3>
    <Form label="Save scorecard" onSubmit={x => mutate('scorecard', { application: app.id, interview: mine?.interview ?? undefined, submit: x.submit === true, recommendation: x.recommendation || undefined, notes: x.notes, ratings: Object.fromEntries(rubric.criteria.map((k: D) => [k.id, x['rating-' + k.id] || null])), evidence: Object.fromEntries(rubric.criteria.map((k: D) => [k.id, x['evidence-' + k.id]])) })}>
      {rubric.criteria.map((k: D) => <fieldset key={k.id} className="wide"><legend>{k.name}</legend><p className="hint">{k.description}</p>
        <Field label={`Rating for ${k.name} (1–4, blank if not assessed)`} name={'rating-' + k.id} required={false} defaultValue={mine?.ratings[k.id] ?? ''} options={['1', '2', '3', '4'].map(n => ({ value: n, label: n }))} />
        <Field label={`Evidence for ${k.name}`} name={'evidence-' + k.id} type="textarea" required={false} defaultValue={mine?.evidence[k.id]} /></fieldset>)}
      <Field label="Recommendation" name="recommendation" required={false} defaultValue={mine?.recommendation ?? ''} options={Object.entries(LABELS).map(([value, label]) => ({ value, label: label as string }))} />
      <Field label="Other notes" name="notes" type="textarea" required={false} defaultValue={mine?.notes} />
      <label className="check wide"><input type="checkbox" name="submit" /> Submit (you cannot change it afterwards)</label>
    </Form>
    <h3>Your private interview notes</h3>
    {notes.map((n: D) => <p key={n.id} className="pre card">{n.text}</p>)}
    <Form label="Save notes" compact reset onSubmit={x => mutate('note', { application: app.id, text: x.text })}><Field label="Notes (only you see these; a feedback draft may quote them)" name="text" type="textarea" wide /></Form>
  </section>
}
