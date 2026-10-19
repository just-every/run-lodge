import type { PageProps } from './app'
import { person } from './names'
import { when } from './format'
import { Field, Form, Status, type D } from './shared'

const KINDS: D = { evidence: 'Evidence', agreement: 'Interviewers agree', disagreement: 'Interviewers disagree', gap: 'Nobody assessed', question: 'Question to resolve' }

/** COORD-006: the debrief brief for the people who run the job, each statement with the passages it quotes. */
export function Debriefs({ app, v, w, mutate }: { app: D; v?: D; w: D; mutate: PageProps['mutate'] }) {
  const briefs = (w.debriefs ?? []).filter((d: D) => d.application === app.id)
  if (!app.manages || !briefs.length) return null
  const criterion = (id: string) => v?.rubrics?.flatMap((r: D) => r.criteria).find((k: D) => k.id === id)?.name ?? ''
  return <section className="card" aria-label="Debrief brief">
    <h3>Debrief brief</h3>
    <p className="hint">Prepared from released scorecards only. Every statement quotes an interviewer; it carries no combined score or recommendation and never moves the candidate.</p>
    {briefs.map((d: D) => <article key={d.id} className="card">
      <h4>Prepared by {person(w, d.preparedBy)}{d.preparedByAgent ? ` for ${person(w, d.preparedFor)}` : ''} · {when(d.preparedAt)} <Status tone={d.status === 'kept' ? 'good' : 'neutral'}>{d.status === 'kept' ? 'kept' : 'draft'}</Status>{d.stale && <> <Status tone="warn">a quoted scorecard was corrected</Status></>}</h4>
      {d.statements.map((x: D, i: number) => <div key={i} className="statement">
        <p><strong>{KINDS[x.kind]}{x.criterion ? ` · ${criterion(x.criterion)}` : ''}</strong>: {x.text}</p>
        {x.citations.map((c: D, j: number) => <blockquote key={j}>“{c.quote}” <a href={'#scorecard-' + c.scorecard}>{person(w, c.author)}, {c.field === 'takeaways' ? 'key take-aways' : `${criterion(c.criterion)} rated ${c.rating ?? 'not rated'}`}{c.version > 1 ? `, version ${c.version}` : ''}</a></blockquote>)}
      </div>)}
      {d.status === 'draft' && <>
        <details><summary>Edit the brief</summary>
          <Form label="Save the brief" onSubmit={x => mutate('edit-debrief', { id: d.id, statements: d.statements.map((s: D, i: number) => ({ ...s, text: x['statement-' + i] })).filter((s: D) => s.text.trim()) })}>
            {d.statements.map((s: D, i: number) => <Field key={i} label={`Brief statement ${i + 1}: ${KINDS[s.kind]}`} name={'statement-' + i} type="textarea" wide required={false} defaultValue={s.text} hint="Clear it to drop the statement; its quotes must still support what remains" />)}
          </Form>
        </details>
        <div className="actions">
          <Form label="Keep this brief" compact onSubmit={() => mutate('decide-debrief', { id: d.id, decision: 'keep' })} />
          <Form label="Discard this brief" compact onSubmit={() => mutate('decide-debrief', { id: d.id, decision: 'discard' })} />
        </div>
      </>}
    </article>)}
  </section>
}
