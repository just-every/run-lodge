import type { PageProps } from './app'
import { Field, Form, memberOptions, type D } from './shared'
import { EmailChoice, emailBody, reasonOptions } from './rejections'

export function SandboxRules({ box, w, mutate }: { box: D } & Pick<PageProps, 'w' | 'mutate'>) {
  if (!w.canAuthorRules) return <p>A hiring admin changes screening rules; your existing rules remain in this trial.</p>
  const questions = box.config.questions.map((q: D) => w.questions.find((x: D) => x.id === q.question)).filter((q: D) => q?.versions.at(-1).objective)
  return <section aria-label="Sandbox screening rules"><h3>Trial screening rules and stage actions</h3>
    {box.config.rules.map((r: D) => { const x = r.versions.at(-1); return <p key={r.id}>{r.name} · version {x.version} · {x.questionText} · {x.then.kind}{x.then.stage ? ': ' + box.config.stages.find((s: D) => s.id === x.then.stage)?.name : x.then.tag ? ': ' + x.then.tag : ''}</p> })}
    {!questions.length ? <p>Attach an objective screening question in the trial configuration to author a rule.</p> : <Form label="Save trial rule" reset onSubmit={x => mutate('sandbox-edit', { id: box.id, edits: [{ op: 'screening-rule', input: { id: x.rule || undefined, name: x.name, question: x.question, active: x.active !== 'false',
      when: { equals: x.equals ? x.equals.split(',').map((s: string) => s.trim()) : undefined, min: x.min, below: x.below, onOrAfter: x.onOrAfter || undefined, onOrBefore: x.onOrBefore || undefined },
      then: { kind: x.kind, stage: x.stage || undefined, reviewer: x.reviewer || undefined, tag: x.tag || undefined, reason: x.reason || undefined, closeReason: x.closeReason || undefined, ...(x.kind === 'propose-reject' ? emailBody(x) : {}) } } }] })}>
      <Field label="Rule to change (blank creates a rule)" name="rule" required={false} options={box.config.rules.map((r: D) => ({ value: r.id, label: r.name }))} />
      <Field label="Rule name" name="name" />
      <Field label="Rule enabled" name="active" defaultValue="true" options={[{ value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }]} />
      <Field label="Objective screening question" name="question" options={questions.map((q: D) => ({ value: q.id, label: q.versions.at(-1).text }))} />
      <Field label="Matching answers (comma-separated)" name="equals" required={false} />
      <Field label="At least" name="min" type="number" required={false} /><Field label="Below" name="below" type="number" required={false} />
      <Field label="On or after" name="onOrAfter" type="date" required={false} /><Field label="On or before" name="onOrBefore" type="date" required={false} />
      <Field label="Stage action" name="kind" options={[{ value: 'route', label: 'Route to stage' }, { value: 'assign', label: 'Assign reviewer' }, { value: 'tag', label: 'Add tag' }, { value: 'propose-reject', label: 'Queue rejection for review' }]} />
      <Field label="Route to stage" name="stage" required={false} options={box.config.stages.map((s: D) => ({ value: s.id, label: s.name }))} />
      <Field label="Assign reviewer" name="reviewer" required={false} options={memberOptions(w.members, 'interviewer')} />
      <Field label="Trial tag" name="tag" required={false} /><Field label="Rejection reason" name="reason" required={false} />
      <Field label="Listed rejection reason" name="closeReason" required={false} options={reasonOptions(w, 'rejected')} /><EmailChoice w={w} />
    </Form>}
  </section>
}
