import type { PageProps } from './app'
import { person } from './names'
import { Field, Form, memberOptions, Status, type D } from './shared'

const shown = (v: unknown) => Array.isArray(v) ? v.join(', ') : v === 'yes' ? 'Yes' : v === 'no' ? 'No' : String(v)
function describe(r: D, v: D) {
  const x = r.versions.at(-1), w = x.when
  const when = w.equals ? `answers ${w.equals.map(shown).join(' or ')}` : w.min !== undefined || w.below !== undefined ? [w.min !== undefined && `at least ${w.min}`, w.below !== undefined && `below ${w.below}`].filter(Boolean).join(' and ') : [w.onOrAfter && `on or after ${w.onOrAfter}`, w.onOrBefore && `on or before ${w.onOrBefore}`].filter(Boolean).join(' and ')
  const then = x.then.kind === 'route' ? `move to ${v.stages.find((s: D) => s.id === x.then.stage)?.name}` : x.then.kind === 'assign' ? `assign ${x.then.reviewer}` : x.then.kind === 'tag' ? `tag “${x.then.tag}”` : `propose rejection: ${x.then.reason}`
  return `“${x.questionText}” ${when} → ${then}`
}

/** SCREEN-002 on a job: its rules, the rule-matches queue, and for admins rule authoring, automatic approval and preview-and-apply. */
export function Rules({ v, w, mutate }: { v: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const rules = (w.screeningRules ?? []).filter((r: D) => r.vacancy === v.id)
  const queue = (w.ruleMatches ?? []).filter((m: D) => m.vacancy === v.id && m.status === 'queued')
  const objective = (v.questions ?? []).map((x: D) => (w.questions ?? []).find((q: D) => q.id === x.question)).filter((q: D) => q?.versions.at(-1).objective)
  if (!rules.length && !(w.canAuthorRules && objective.length)) return null
  const name = (id: string) => w.applications.find((a: D) => a.id === id)?.candidateName ?? 'Candidate'
  return <section className="screening" aria-label="Screening rules">
    <h3>Screening rules</h3>
    {rules.map((r: D) => <article key={r.id} className="card"><h4>{r.name} <Status>{`version ${r.versions.length}`}</Status>{r.auto?.version === r.versions.length && <> <Status tone="warn">rejects automatically (approved by {person(w, r.auto.approvedBy)})</Status></>}</h4><p>{describe(r, v)}</p>
      {w.canAuthorRules && <div className="actions">
        {r.versions.at(-1).then.kind === 'propose-reject' && r.auto?.version !== r.versions.length && <Form label="Approve automatic rejection" compact onSubmit={() => mutate('approve-auto-reject', { id: r.id })} />}
        <Form label="Preview on earlier applications" compact onSubmit={async () => { const p = await mutate('preview-rule', { id: r.id }); if (p.applications.length && confirm(`${p.applications.length} earlier applications match. Apply the rule to them?`)) await mutate('apply-rule', { id: r.id, applications: p.applications.map((x: D) => x.application) }) }} />
      </div>}
    </article>)}
    {queue.length > 0 && <><h4>Rule matches ({queue.length})</h4>
      <ul>{queue.map((m: D) => <li key={m.id}>{name(m.application)} · {m.ruleName} v{m.version} · “{m.question}” (v{m.questionVersion}) answered {shown(m.answer)} · {m.intakePath} · {m.reason}
        <div className="actions"><Form label="Confirm rejection" compact onSubmit={() => mutate('decide-rule-matches', { id: m.id, decision: 'confirm' })} />
        <Form label="Dismiss" compact onSubmit={x => mutate('decide-rule-matches', { id: m.id, decision: 'dismiss', reason: x.why })}><Field label="Why the rule does not apply" name="why" /></Form></div></li>)}</ul>
      <Form label="Confirm the whole queue" compact onSubmit={() => mutate('decide-rule-matches', { vacancy: v.id, all: true, decision: 'confirm' })} /></>}
    {w.canAuthorRules && objective.length > 0 && <details><summary>Add a rule</summary>
      <Form label="Save rule" reset onSubmit={x => mutate('screening-rule', { vacancy: v.id, name: x.name, question: x.question, when: { equals: x.equals ? x.equals.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined, min: x.min, below: x.below }, then: { kind: x.kind, stage: x.stage || undefined, reviewer: x.reviewer || undefined, tag: x.tag || undefined, reason: x.because || undefined } })}>
        <Field label="Rule name" name="name" />
        <Field label="Screening question" name="question" options={objective.map((q: D) => ({ value: q.id, label: q.versions.at(-1).text }))} />
        <Field label="Matching answers (yes, no or choices, comma-separated)" name="equals" required={false} />
        <Field label="At least (numbers)" name="min" type="number" required={false} />
        <Field label="Below (numbers)" name="below" type="number" required={false} />
        <Field label="Then" name="kind" options={[{ value: 'propose-reject', label: 'Propose rejection (queue)' }, { value: 'route', label: 'Move to a stage' }, { value: 'assign', label: 'Assign a reviewer' }, { value: 'tag', label: 'Tag' }]} />
        <Field label="Stage to move to" name="stage" required={false} options={v.stages.map((s: D) => ({ value: s.id, label: s.name }))} />
        <Field label="Reviewer to assign" name="reviewer" required={false} options={memberOptions(w.members, 'interviewer')} />
        <Field label="Tag to add" name="tag" required={false} />
        <Field label="Rejection wording" name="because" required={false} />
      </Form></details>}
  </section>
}
