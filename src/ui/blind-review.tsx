import type { PageProps } from './app'
import { when } from './format'
import { person } from './names'
import { Check, Field, Form, type D } from './shared'

/** Job managers choose where identities stay hidden and where review reveals them. */
export function BlindReviewSettings({ v, mutate }: { v: D } & Pick<PageProps, 'mutate'>) {
  if (!v.manages) return null
  const settings = v.blindReview
  return <section className="card" aria-label="Blind review settings">
    <details>
      <summary>Blind review settings</summary>
      <p>Reviewers see an application code and redacted resume text in the selected stages. Recruiters retain their full records. Original files and images are unavailable to blind reviewers until reveal.</p>
      <p className="hint">Leaving a blind stage records a reveal. Returning blinds the view again, but cannot undo what someone has already learned.</p>
      <Form key={JSON.stringify(settings)} label="Save blind review" compact onSubmit={x => {
        const stages = v.stages.filter((s: D) => x[`stage-${s.id}`]).map((s: D) => s.id)
        if (x.enabled && !stages.length) throw new Error('Choose at least one blind stage.')
        if (stages.includes(x.revealStage)) throw new Error('The reveal stage must be outside the blind stages.')
        return mutate('blind-review', { id: v.id, enabled: x.enabled, stages, revealStage: x.revealStage })
      }}>
        <Check label="Enable blind review" name="enabled" defaultChecked={settings?.enabled === true} />
        <fieldset><legend>Blind stages</legend>{v.stages.map((s: D) => <Check key={s.id} label={s.name} name={`stage-${s.id}`} defaultChecked={settings?.stages.includes(s.id) === true} />)}</fieldset>
        <Field label="Reveal stage" name="revealStage" defaultValue={settings?.revealStage} options={v.stages.map((s: D) => ({ value: s.id, label: s.name }))} />
      </Form>
    </details>
  </section>
}

const lines = (value: string) => value.split(/\r?\n/).map(x => x.trim()).filter(Boolean)

/** Values are deliberately entered afresh: a blind reader never receives the identity list. */
export function BlindIdentityValues({ app, v, mutate }: { app: D; v?: D } & Pick<PageProps, 'mutate'>) {
  if (!v?.manages) return null
  return <section aria-label="Blind identity values">
    <details>
      <summary>Blind identity values</summary>
      <p>Enter the recorded schools and graduation years to redact from this candidate’s resume text. Saving replaces the previous lists; blank fields clear them.</p>
      <Form label="Save identity redactions" compact reset onSubmit={x => mutate('blind-identity', { application: app.id, schools: lines(x.schools), years: lines(x.years) })}>
        <Field label="Schools to redact (one per line)" name="schools" type="textarea" required={false} />
        <Field label="Graduation years to redact (one per line)" name="years" type="textarea" required={false} />
      </Form>
    </details>
  </section>
}

export function BlindResume({ app }: { app: D }) {
  return <section className="reading-page" aria-label="Blind review resume">
    <h3>Redacted resume</h3>
    <p className="hint">Blind review is active. Original files and images are unavailable until reveal. Returning to a blind stage hides identity again, but cannot undo a prior reveal.</p>
    {app.resumeText ? <p className="pre document-text">{app.resumeText}</p> : <p className="hint">No resume text on file.</p>}
  </section>
}

export function BlindReveals({ app, v, w }: { app: D; v?: D; w: D }) {
  if (!app.reveals?.length) return null
  return <section aria-label="Identity reveal history">
    <h3>Identity reveal history</h3>
    <p className="hint">Returning to a blind stage cannot undo these prior reveals.</p>
    <ol className="history">{app.reveals.map((r: D, index: number) => {
      const stage = v?.stages.find((s: D) => s.id === r.to)
      return <li key={index}>
        <strong>Identity revealed{stage ? ` on entering ${stage.name}` : ''}</strong>
        <span>{when(r.at)} · {person(w, r.email)}</span>
      </li>
    })}</ol>
  </section>
}
