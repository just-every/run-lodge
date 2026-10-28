import type { PageProps } from './app'
import { day, money, pay, when } from './format'
import { KINDS, person, tone } from './names'
import { Empty, Field, Form, memberOptions, Status, type D } from './shared'

function Terms({ x, w }: { x: D; w: D }) {
  const t = x.terms
  if (x.subjectKind === 'vacancy') return <dl className="terms"><dt>Role</dt><dd>{t.title} · {t.department} · {t.location}</dd><dt>Pay</dt><dd>{pay(t.compensation)}</dd>{t.payRanges?.length > 0 && <><dt>Pay by location</dt><dd><ul>{t.payRanges.map((r: D) => <li key={r.officeId}>{w.offices?.find((o: D) => o.id === r.officeId)?.name ?? r.officeId}: {pay(r.compensation)}</li>)}</ul></dd></>}{t.benefits && <><dt>Benefits and bonus</dt><dd className="pre">{t.benefits}</dd></>}<dt>Headcount</dt><dd>{t.headcount}</dd><dt>Manager</dt><dd>{person(w, t.manager)}</dd>
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
      const step = x.chain?.steps.findIndex((step: D, index: number) => !step.approvers.every((email: string) => x.decisions.some((d: D) => d.step === index && d.approver === email && d.decision === 'approved')))
      const waiting = x.waitingApprovers ?? [x.approver]
      const yours = waiting.includes(me)
      return <article key={x.id} id={'approval-' + x.id} className="card approval-card">
        <header className="approval-head"><h2>{KINDS[x.subjectKind]}: {x.terms.title ?? x.terms.subject}</h2><Status tone={yours ? 'alert' : 'warn'}>{yours ? 'waiting on you' : `waiting on ${waiting.map((email: string) => person(w, email)).join(' and ')}`}</Status></header>
        <p className="muted">Requested by {person(w, x.requestedBy)} · {when(x.requestedAt)} · {x.chain ? 'configured headcount chain' : 'approver ' + person(w, x.approver)}</p>
        {x.chain && <section aria-label="Headcount approval chain"><h3>Headcount approval chain</h3><p>Chain version {x.chain.version.slice(0, 8)}</p><ol>{x.chain.steps.map((item: D, index: number) => <li key={index}>Step {index + 1}: {item.approvers.map((email: string) => { const d = x.decisions.find((d: D) => d.step === index && d.approver === email); return person(w, email) + ': ' + (d ? d.decision + (d.onBehalfOf ? ' by ' + person(w, d.by) + ' on behalf of ' + person(w, d.onBehalfOf) : '') + ' (' + d.reason + ')' : index === step ? 'waiting' : 'not started') }).join('; ')}</li>)}</ol><p>Every named person must approve these exact terms. One rejection stops the chain.</p></section>}
        {x.delegations?.length > 0 && <p>Delegated review: {x.delegations.map((d: D) => person(w, d.delegate) + ' on behalf of ' + person(w, d.approver)).join('; ')}. Delegation and current job authority are checked again before a decision.</p>}
        {x.stepDueAt && <p>Step {step + 1} escalation due {when(x.stepDueAt)} · {x.timeZone}. Business days are Monday to Friday; public holidays are not excluded.</p>}
        {x.escalations?.filter((e: D) => e.step === step).map((e: D) => <p key={e.step} role="status">Escalated to {person(w, e.owner)} at {when(e.at)}. Required approvers can still decide; escalation creates no substitute approval.</p>)}
        <Terms x={x} w={w} />
        {x.currentVersion !== x.version ? <p className="warn">This changed after approval was requested. It needs a new request.</p>
          : yours ? <Decision x={x} mutate={mutate} label="Record decision" />
            : w.actor.owner && !x.chain && <details><summary>Decide as the owner instead of {person(w, x.approver)}</summary><p className="hint">An owner’s decision overrides the named approver and is recorded as yours.</p><Decision x={x} mutate={mutate} label="Record owner’s decision" /></details>}
      </article>
    })}
    {rest.length > 0 && <><h2>History</h2><ul>{rest.map((x: D) => <li key={x.id}>{KINDS[x.subjectKind]} · {x.terms.title ?? x.terms.subject} · <Status tone={tone(x.status)}>{x.status}</Status> · {person(w, x.decidedBy ?? x.approver)} {x.chain && <ol>{x.decisions.map((d: D, index: number) => <li key={index}>Step {d.step + 1}: {person(w, d.approver)} · {d.decision}{d.onBehalfOf ? ' by ' + person(w, d.by) + ' on behalf of ' + person(w, d.onBehalfOf) : ''} · {d.reason}</li>)}</ol>}{x.reason ? `· “${x.reason}”` : ''}</li>)}</ul></>}
  </div>
}

/** An approver can change only their own out-of-office routing. */
export function ApprovalSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  if (w.actor.agent || !(w.actor.owner || w.actor.roles.includes('approver'))) return null
  const d = w.approvalDelegation
  return <section className="card" aria-label="Approval delegation settings"><h2>Out-of-office approvals</h2>
    <p>Delegate your headcount reviews to another human approver for inclusive dates in the business time zone. Each delegate also needs current approval permission on the job. Changing or ending delegation requires a new request for unfinished delegated reviews.</p>
    {d?.active && <p>Delegating to {person(w, d.delegate)} from {day(d.from)} through {day(d.through)} · {d.timeZone}.</p>}
    <Form label="Save approval delegation" key={d?.version ?? 'new'} onSubmit={v => mutate('approval-delegation', v)}>
      <Field label="Delegate approver" name="delegate" defaultValue={d?.delegate} options={memberOptions(w.members.filter((m: D) => !m.agent && m.email !== w.actor.email), 'approver')} />
      <Field label="First day away" name="from" type="date" defaultValue={d?.from} />
      <Field label="Last day away" name="through" type="date" defaultValue={d?.through} />
    </Form>
    {d?.active && <Form label="End approval delegation" compact onSubmit={() => mutate('approval-delegation', { active: false })} />}
  </section>
}
