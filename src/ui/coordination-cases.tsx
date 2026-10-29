import type { PageProps } from './app'
import { person } from './names'
import { when } from './format'
import { Field, Form, Status, type D } from './shared'

const labels: D = { open: 'Open', 'review-required': 'Review required', stopped: 'Stopped', completed: 'Confirmed native completion' }

function ActionFields({ row, owners }: { row: D; owners: D[] }) {
  return <>
    <Field label="Current human recruiter" name="owner" defaultValue={row.owner ?? ''} options={owners.map(m => ({ value: m.email, label: m.name }))} />
    <Field label="Next action" name="nextAction" defaultValue={row.nextAction} />
    <Field label="Deadline with time zone" name="deadline" defaultValue={row.deadline ?? ''} hint="Include a time zone, for example 2030-10-08T12:00:00Z." />
  </>
}

export function FeedbackCaseProposal({ p, w, mutate }: Pick<PageProps, 'w' | 'mutate'> & { p: D }) {
  const row = w.coordination.cases.find((c: D) => c.id === p.case)
  if (!row) return null
  return <article className="card feedback-case" aria-label="Feedback case proposal">
    <p className="eyebrow">Agent-authored feedback action · {p.status}</p>
    <h2>{p.summary}</h2>
    <p>{row.candidateName} · {row.title} · {person(w, row.panellist)}</p>
    <p>Proposed by {person(w, p.proposedBy)}. Human reviewer: {person(w, p.approver)}.</p>
    <p>Action: {p.input.action}{p.input.owner ? ' · recruiter: ' + person(w, p.input.owner) : ''}</p>
    {p.input.nextAction && <p>Next action: {p.input.nextAction} · deadline: {when(p.input.deadline)}</p>}
    {p.input.reason && <p>Stop reason: {p.input.reason}</p>}
    <p>This action sends no notice and makes no hiring decision. Completion requires a current native submitted scorecard; an agent assertion or a task cannot confirm it.</p>
    <details><summary>Exact source revisions</summary>{p.sources.map((s: D) => <p key={s.kind}>{s.kind}: <code>{s.id}</code> · revision <code>{s.revision}</code></p>)}</details>
    {p.status === 'proposed' && !w.actor.agent && p.approver === w.actor.email && <Form label="Review feedback action" onSubmit={values => mutate('decide-proposal', { id: p.id, ...values })}>
      <Field label="Feedback action decision" name="decision" options={[{ value: 'approved', label: 'Approve exact action' }, { value: 'rejected', label: 'Reject action' }]} />
      <Field label="Feedback review reason" name="reason" />
    </Form>}
    {p.reason && <p>{p.reason}</p>}
  </article>
}

/** Operational case work in the existing review surface; no scheduling or contact policy is enabled here. */
export function CoordinationCases({ w, mutate, follow }: Pick<PageProps, 'w' | 'mutate' | 'follow'>) {
  const rows: D[] = w.coordination.cases
  const missing = w.coordination.missingScorecards.filter((fact: D) => !rows.some(row => row.interview === fact.interview && row.panellist === fact.interviewer))
  if (!rows.length && !missing.length) return null
  const owners = w.members.filter((m: D) => m.active && !m.agent && (m.owner || m.roles.some((r: string) => ['admin', 'manager'].includes(r))))
  return <section aria-label="Native feedback cases" className="feedback-case">
    <h2>Native feedback cases</h2>
    <p>Track missing feedback with a current human recruiter. These local cases do not verify candidate replies, calendar bookings or connected logistics. Scorecard content stays private until release. No new notices are sent.</p>
    {!w.actor.agent && missing.map((fact: D) => <div key={fact.interview + fact.interviewer} className="card">
      <p>{w.applications.find((app: D) => app.id === fact.application)?.candidateName} · {fact.title} · waiting for {person(w, fact.interviewer)}</p>
      <Form label="Open feedback case" onSubmit={() => mutate('coordination-discover', { application: fact.application, interview: fact.interview, panellist: fact.interviewer })} />
    </div>)}
    {rows.map(row => <article key={row.id} aria-label={'Feedback case for ' + row.candidateName} className="card feedback-case">
      <h3>{row.candidateName} · {row.title}</h3>
      <p><Status tone={row.status === 'completed' ? 'good' : row.overdue || row.status === 'review-required' ? 'warn' : 'neutral'}>{row.overdue ? 'Overdue · unresolved' : labels[row.status]}</Status></p>
      <p>Responsible panellist: {person(w, row.panellist)} · recruiter: {row.owner ? person(w, row.owner) : 'Human review required'}</p>
      <p>{row.reason}</p>
      {row.nextAction && <p>Next action: {row.nextAction} · deadline: {when(row.deadline)}</p>}
      {row.confirmation && <p>Submitted feedback confirmed at {when(row.confirmation.submittedAt)}. Content remains under its existing release controls.</p>}
      <button className="link" onClick={() => follow('/app?application=' + row.application)}>Open application</button>
      {!w.actor.agent && !['completed', 'stopped'].includes(row.status) && <>
        <details><summary>{row.owner ? 'Review ownership and next action' : 'Approve human ownership'}</summary>
          <Form key={row.sources.find((s: D) => s.kind === 'coordination-case')?.revision} label="Save reviewed ownership" onSubmit={values => mutate('coordination-case', { id: row.id, sources: row.sources, action: 'assign', ...values })}>
            <ActionFields row={row} owners={owners} />
          </Form>
        </details>
        {row.status === 'open' && <Form label="Reconcile native submission" onSubmit={() => mutate('coordination-case', { id: row.id, sources: row.sources, action: 'reconcile' })} />}
        <details><summary>Stop this local case</summary><Form label="Stop feedback case" onSubmit={values => mutate('coordination-case', { id: row.id, sources: row.sources, action: 'stop', ...values })}><Field label="Reason for stopping" name="reason" /></Form></details>
      </>}
      <details><summary>Progress history</summary><ol className="history">{row.history.map((event: D, i: number) => <li key={i}><strong>{event.event}</strong><span>{when(event.at)} · {event.by ? person(w, event.by) : 'Native status readback'}</span>{event.reason && <span>{event.reason}</span>}{event.owner && <span>Recruiter: {person(w, event.owner)}</span>}{event.nextAction && <span>{event.nextAction} · {when(event.deadline)}</span>}</li>)}</ol></details>
    </article>)}
  </section>
}
