import type { PageProps } from './app'
import { day, money, pay, when } from './format'
import { KINDS, person, tone } from './names'
import { Empty, Field, Form, Status, type D } from './shared'

function Terms({ x, w }: { x: D; w: D }) {
  const t = x.terms
  if (x.subjectKind === 'vacancy') return <dl className="terms"><dt>Role</dt><dd>{t.title} · {t.department} · {t.location}</dd><dt>Pay</dt><dd>{pay(t.compensation)}</dd><dt>Headcount</dt><dd>{t.headcount}</dd><dt>Manager</dt><dd>{person(w, t.manager)}</dd>
    <dt>Stages</dt><dd>{t.stages.map((s: D) => s.name).join(' → ')}</dd><dt>Rubric v{t.rubric?.version}</dt><dd><ul>{t.rubric?.criteria.map((c: D) => <li key={c.id}>{c.name}: {c.description}</li>)}</ul></dd><dt>Interviews</dt><dd>{t.plan.map((p: D) => p.name).join(', ')}</dd></dl>
  if (x.subjectKind === 'offer') return <dl className="terms"><dt>Offer</dt><dd>{t.title} · {money(t.salary)} · starts {day(t.startDate)}</dd><dt>Terms</dt><dd className="pre">{t.terms || 'none'}</dd><dd><a href={`/api/lodge/download/packet/${x.subjectId}`}>Open approval packet</a></dd></dl>
  return <dl className="terms"><dt>To</dt><dd>{t.to}</dd><dt>Subject</dt><dd>{t.subject}</dd><dt>Message</dt><dd className="pre">{t.body}</dd></dl>
}

function Decision({ x, mutate, label }: { x: D; mutate: PageProps['mutate']; label: string }) {
  return <Form label={label} onSubmit={v => mutate('decide-approval', { id: x.id, decision: v.decision, reason: v.reason, version: x.version })}>
    <Field label="Decision" name="decision" options={[{ value: 'approved', label: 'Approve these exact terms' }, { value: 'rejected', label: 'Reject' }]} />
    <Field label="Reason" name="reason" />
  </Form>
}

/** Pending approvals: who must approve each one; the form goes to that person, and the owner may override it as the owner. */
export function Approvals({ w, mutate }: PageProps) {
  const me = w.actor.email
  const pending = w.approvals.filter((x: D) => x.status === 'pending')
  const rest = w.approvals.filter((x: D) => x.status !== 'pending')
  return <div className="page">
    <h1>Approvals</h1>
    {!pending.length && <Empty icon="approvals" title="Nothing is waiting for you.">Vacancies, offers and messages sent for approval appear here with their exact terms.</Empty>}
    {pending.map((x: D) => {
      const yours = x.approver === me
      return <article key={x.id} id={'approval-' + x.id} className="card approval-card">
        <header className="approval-head"><h2>{KINDS[x.subjectKind]}: {x.terms.title ?? x.terms.subject}</h2><Status tone={yours ? 'alert' : 'warn'}>{yours ? 'waiting on you' : `waiting on ${person(w, x.approver)}`}</Status></header>
        <p className="muted">Requested by {person(w, x.requestedBy)} · {when(x.requestedAt)} · approver {person(w, x.approver)}</p>
        <Terms x={x} w={w} />
        {x.currentVersion !== x.version ? <p className="warn">This changed after approval was requested. It needs a new request.</p>
          : yours ? <Decision x={x} mutate={mutate} label="Record decision" />
            : w.actor.owner && <details><summary>Decide as the owner instead of {person(w, x.approver)}</summary><p className="hint">An owner’s decision overrides the named approver and is recorded as yours.</p><Decision x={x} mutate={mutate} label="Record owner’s decision" /></details>}
      </article>
    })}
    {rest.length > 0 && <><h2>History</h2><ul>{rest.map((x: D) => <li key={x.id}>{KINDS[x.subjectKind]} · {x.terms.title ?? x.terms.subject} · <Status tone={tone(x.status)}>{x.status}</Status> · {person(w, x.decidedBy ?? x.approver)} {x.reason ? `· “${x.reason}”` : ''}</li>)}</ul></>}
  </div>
}
