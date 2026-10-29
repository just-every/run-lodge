import { useState } from 'react'
import type { PageProps } from './app'
import { Check, Field, Form, type D } from './shared'
import { person } from './names'
import { when } from './format'

function Evidence({ row, follow }: { row: D; follow: PageProps['follow'] }) {
  return <>
    <p>{row.signature.label}. {row.signature.kind === 'outside' && 'Human attestation only; not provider-verified.'}</p>
    <p>{row.terms.title} · {row.terms.salary.currency} {(row.terms.salary.amount / 100).toFixed(2)} per {row.terms.salary.period} · Start {row.terms.startDate} · {row.approved ? 'Current terms approved' : 'Approval needs review'}</p>
    <ul>{row.fields.map((f: D) => <li key={f.key}>{f.label}: {f.missing ? 'Missing' : f.value}</li>)}</ul>
    <p>Handoff incomplete. Background checks unknown. Destination employee readback unknown. No employee creation is verified.</p>
    <button className="link" onClick={() => follow('/app?application=' + encodeURIComponent(row.application))}>Open source application</button>
    <details><summary>Signature artifacts and exact sources</summary>
      <p>Offer revision <code>{row.offerRevision}</code>. Approved terms fingerprint <code>{row.termsVersion}</code>.</p>
      {row.approvedDocumentSha256 && <p>Approved document digest <code>{row.approvedDocumentSha256}</code>.</p>}
      {row.signature.method && <p>Attested method: {row.signature.method}. Recorded differences: {row.signature.differences || 'None stated'}.</p>}
      {row.signature.artifacts.map((f: D) => <p key={f.document}>{f.name} · {f.intact ? 'Stored bytes match' : 'Artifact needs review'} · <code>{f.sha256}</code></p>)}
      {row.sources.map((s: D) => <p key={s.kind + s.id}>{s.kind} <code>{s.id}</code> · Revision <code>{s.revision}</code></p>)}
    </details>
    <ul>{row.issues.map((issue: string) => <li key={issue}>{issue}</li>)}</ul>
  </>
}

export function HandoffExceptions({ w, mutate, follow }: Pick<PageProps, 'w' | 'mutate' | 'follow'>) {
  const view = w.handoffExceptions, proposals = w.proposals.filter((p: D) => p.workflow === 'handoff-exception')
  if (!view?.preflights.length && !view?.cases.length && !proposals.length) return null
  const owners = w.members.filter((m: D) => m.active && !m.agent)
  return <section aria-label="Handoff exceptions"><h2>Handoff exceptions</h2>
    <p>Your external coding agent can propose ownership from the local preflight. A human reviews the exact sources and proposed next action. Field corrections use the existing application and job controls; legal terms, pay and start dates retain their existing approval requirements.</p>
    <details><summary>Current local preflights</summary>{view.preflights.map((row: D) => <article className="card" key={row.offer} aria-label={'Handoff preflight for ' + row.name}><h3>{row.name}</h3><Evidence row={row} follow={follow} /></article>)}</details>
    {proposals.map((p: D) => <article className="card" key={p.id} aria-label={'Handoff proposal for ' + p.handoff.name}>
      <h3>{p.summary}</h3><p>Agent-authored proposal · {p.status}</p><Evidence row={p.handoff} follow={follow} />
      <p>Proposed owner: {person(w, p.owner)} · Deadline {when(p.deadline)}.</p><p>Next action: {p.nextAction}</p>
      {p.status === 'proposed' && !w.actor.agent && p.approver === w.actor.email && <Form label="Review handoff ownership" onSubmit={values => mutate('decide-proposal', { id: p.id, ...values })}>
        <Field label="Handoff decision" name="decision" options={[{ value: 'accepted', label: 'Approve local ownership' }, { value: 'rejected', label: 'Reject proposal' }]} />
        <Field label="Handoff review reason" name="reason" />
      </Form>}
      {p.reason && <p>Review reason: {p.reason}</p>}
    </article>)}
    {view.cases.map((c: D) => <article className="card" key={c.id} aria-label={'Owned handoff for ' + c.evidence.name}>
      <h3>{c.evidence.name} · Local exception</h3><p>{c.status === 'stopped' ? 'Explicitly stopped' : c.reviewRequired ? 'Owner authority needs review' : c.overdue ? 'Overdue and unresolved' : 'Owned and unresolved'} · Handoff incomplete.</p>
      <p>Owner: {person(w, c.owner)} · Deadline {when(c.deadline)}</p><p>Next action: {c.nextAction}</p>
      {c.stale && <p role="status">Sources changed. Review the current local preflight before recording progress.</p>}
      <details><summary>Ownership and progress history</summary>{c.history.map((event: D, index: number) => <p key={index}>{when(event.at)} · {person(w, event.by)} · {event.status} · Owner {person(w, event.owner)} · Deadline {when(event.deadline)} · {event.nextAction} · {event.reason}</p>)}</details>
      {!w.actor.agent && <Form key={c.revision} label="Record handoff progress" onSubmit={values => mutate('handoff-progress', { ...values, id: c.id, revision: c.revision, sources: view.preflights.find((p: D) => p.offer === c.offer)?.sources })}>
        <Field label="Exception owner" name="owner" defaultValue={c.owner} options={owners.map((m: D) => ({ value: m.email, label: m.name }))} />
        <Field label="Exception deadline" name="deadline" defaultValue={c.deadline} hint="Use an exact time with a zone, such as 2037-01-10T17:00:00Z." />
        <Field label="Exception next action" name="nextAction" defaultValue={c.nextAction} />
        <Field label="Local exception status" name="status" defaultValue={c.status} options={[{ value: 'owned', label: 'Owned and unresolved' }, { value: 'stopped', label: 'Explicitly stopped' }]} />
        <Field label="Progress reason" name="reason" />
      </Form>}
    </article>)}
  </section>
}

export function HandoffSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const [selected, setSelected] = useState('')
  const jobs = w.vacancies.filter((v: D) => v.manages && ['settings', 'offers', 'contact'].every(p => v.permissions.includes(p)))
  if (w.actor.agent || !jobs.length) return null
  const view = w.handoffExceptions, policy = view?.policies.find((p: D) => p.vacancy === selected)
  return <section className="card" aria-label="Handoff preflight settings"><h2>Handoff preflight fields</h2>
    <p>Select the administrative fields your team checks locally. This creates no provider connection or permission to create an employee.</p>
    <label>Handoff job<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose…</option>{jobs.map((j: D) => <option key={j.id} value={j.id}>{j.title}</option>)}</select></label>
    {selected && <Form key={selected + policy?.revision} label="Save handoff fields" onSubmit={values => mutate('handoff-policy', { vacancy: selected, revision: policy?.revision ?? null, fields: Object.keys(view.fields).filter(key => values[key]) })}>
      {Object.entries(view.fields).map(([key, label]) => <Check key={key} name={key} label={String(label)} defaultChecked={policy?.fields.includes(key) ?? key === 'phone'} />)}
    </Form>}
    {policy && <p>Administrative handoff fields saved.</p>}
  </section>
}
