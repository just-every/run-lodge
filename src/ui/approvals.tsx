import type { PageProps } from './app'
import { day, money, pay, when } from './format'
import { KINDS, person, tone } from './names'
import { Field, Form, Status, type D } from './shared'

function Terms({ x, w }: { x: D; w: D }) {
  const t = x.terms
  if (x.subjectKind === 'vacancy') return <dl className="terms"><dt>Role</dt><dd>{t.title} · {t.department} · {t.location}</dd><dt>Pay</dt><dd>{pay(t.compensation)}</dd><dt>Headcount</dt><dd>{t.headcount}</dd><dt>Manager</dt><dd>{person(w, t.manager)}</dd>
    <dt>Stages</dt><dd>{t.stages.map((s: D) => s.name).join(' → ')}</dd><dt>Rubric v{t.rubric?.version}</dt><dd><ul>{t.rubric?.criteria.map((c: D) => <li key={c.id}>{c.name}: {c.description}</li>)}</ul></dd><dt>Interviews</dt><dd>{t.plan.map((p: D) => p.name).join(', ')}</dd></dl>
  if (x.subjectKind === 'offer') return <dl className="terms"><dt>Offer</dt><dd>{t.title} · {money(t.salary)} · starts {day(t.startDate)}</dd><dt>Terms</dt><dd className="pre">{t.terms || 'none'}</dd><dd><a href={`/api/lodge/download/packet/${x.subjectId}`}>Open approval packet</a></dd></dl>
  return <dl className="terms"><dt>To</dt><dd>{t.to}</dd><dt>Subject</dt><dd>{t.subject}</dd><dt>Message</dt><dd className="pre">{t.body}</dd></dl>
}

export function Approvals({ w, mutate }: PageProps) {
  const me = w.actor.email
  const waiting = w.approvals.filter((x: D) => x.status === 'pending' && (x.approver === me || w.actor.owner))
  const rest = w.approvals.filter((x: D) => !waiting.includes(x))
  return <div className="page">
    <h1>Approvals</h1>
    {!waiting.length && <p className="empty">Nothing is waiting for you.</p>}
    {waiting.map((x: D) => <article key={x.id} className="card"><h2>{KINDS[x.subjectKind]} approval requested by {person(w, x.requestedBy)}</h2><p>{when(x.requestedAt)}</p>
      <Terms x={x} w={w} />
      {x.currentVersion !== x.version ? <p className="warn">This changed after approval was requested. It needs a new request.</p>
        : <Form label="Record decision" onSubmit={v => mutate('decide-approval', { id: x.id, decision: v.decision, reason: v.reason, version: x.version })}>
          <Field label="Decision" name="decision" options={[{ value: 'approved', label: 'Approve these exact terms' }, { value: 'rejected', label: 'Reject' }]} />
          <Field label="Reason" name="reason" />
        </Form>}
    </article>)}
    {rest.length > 0 && <><h2>History</h2><ul>{rest.map((x: D) => <li key={x.id}>{KINDS[x.subjectKind]} · {x.terms.title ?? x.terms.subject} · <Status tone={tone(x.status)}>{x.status}</Status> · {person(w, x.decidedBy ?? x.approver)} {x.reason ? `· “${x.reason}”` : ''}</li>)}</ul></>}
  </div>
}
