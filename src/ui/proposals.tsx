import { HandoffExceptions } from './handoff-exceptions'
import { CandidateUpdates } from './candidate-updates'
import { SourcingDraft } from './sourcing-proposals'
import { DelayAnalysis, DelayDraft } from './delay-analysis'
import type { PageProps } from './app'
import { count, person, sentence, tone } from './names'
import { when } from './format'
import { Empty, Field, Form, Status, type D } from './shared'

export function Proposals({ w, mutate, follow }: PageProps) {
  const open = w.proposals.filter((p: D) => !['handoff-exception', 'delay-diagnosis', 'candidate-update', 'sourcing-research'].includes(p.workflow) && p.status === 'proposed')
  const done = w.proposals.filter((p: D) => !['handoff-exception', 'delay-diagnosis', 'candidate-update', 'sourcing-research'].includes(p.workflow) && p.status !== 'proposed')
  return <div className="page">
    <h1>Agent proposals</h1>
    <p className="hint">A coding agent signed in as its own Lodge member reads the same records you can and proposes exact changes through the API (see API.md). Nothing changes until a person approves; approval re-checks that every record it read is unchanged and runs the changes with the approver’s own permissions. No model runs inside Lodge.</p>
    <CandidateUpdates w={w} mutate={mutate} follow={follow} />
    <HandoffExceptions w={w} mutate={mutate} follow={follow} />
    {w.proposals.filter((p: D) => p.workflow === 'sourcing-research').map((p: D) => <SourcingDraft key={p.id} p={p} w={w} mutate={mutate} />)}
    <DelayAnalysis w={w} follow={follow} />
    {w.proposals.filter((p: D) => p.workflow === 'delay-diagnosis').map((p: D) => <DelayDraft key={p.id} p={p} w={w} mutate={mutate} follow={follow} />)}
    {!open.length && !w.proposals.some((p: D) => ['delay-diagnosis', 'candidate-update', 'sourcing-research'].includes(p.workflow) && p.status === 'proposed') && <Empty icon="proposals" title="No proposals waiting.">When an agent member proposes changes for you, they wait here until you approve or reject them.</Empty>}
    {open.map((p: D) => <article key={p.id} className="card">
      <p className="eyebrow">{sentence(p.workflow.replace(/-/g, ' '))}</p>
      <h2>{p.summary}</h2>
      <p className="muted">From {person(w, p.proposedBy)} · {when(p.proposedAt)} · read {count(p.sources.length, 'record')}</p>
      {p.missing.length > 0 && <p className="warn">Missing, not invented: {p.missing.join(', ')}.</p>}
      {p.rationale && <p className="pre">{p.rationale}</p>}
      <details><summary>The exact changes ({p.changes.length})</summary><ol className="changes">{p.changes.map((c: D, i: number) => <li key={i}><strong>{c.op}</strong><pre>{JSON.stringify(c.input, null, 2)}</pre></li>)}</ol></details>
      {p.citations.length > 0 && <><h3>Cited passages</h3><ul>{p.citations.map((c: D, i: number) => <li key={i}>{c.criterion}: “{c.quote}”</li>)}</ul></>}
      <Form label="Record decision" onSubmit={x => mutate('decide-proposal', { id: p.id, decision: x.decision, reason: x.reason })}>
        <Field label="Decision" name="decision" options={[{ value: 'approved', label: 'Approve and apply' }, { value: 'rejected', label: 'Reject' }]} />
        <Field label="Reason" name="reason" />
      </Form>
    </article>)}
    {done.length > 0 && <><h2>Decided</h2><ul>{done.map((p: D) => <li key={p.id}>{p.summary} · <Status tone={tone(p.status)}>{p.status}</Status> by {person(w, p.decidedBy)}</li>)}</ul></>}
  </div>
}
