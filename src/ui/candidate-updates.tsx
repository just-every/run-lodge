import { useState } from 'react'
import type { PageProps } from './app'
import { Field, Form, type D } from './shared'
import { times } from '../lodge/core/time'

function UpdateEvidence({ update, follow }: { update: D; follow: PageProps['follow'] }) {
  const t = times(update.timeZone)
  return <>
    <p>{update.kind === 'recorded-rejection' ? 'Human rejection already recorded; existing DISP-001 email remains unsent.' : 'Native response-window evidence; no progression or rejection is proposed.'}</p>
    <p>{update.anchor.label}: {t.stamped(update.anchor.at)}. Deadline: {t.stamped(update.dueAt)} · {update.businessDays} business days · {update.overdue ? 'Overdue window' : 'Window still open'}.</p>
    <p>Mailbox correspondence unknown. Delivery unverified. This draft and an EML download never establish that the candidate was kept informed.</p>
    <p><button className="link" onClick={() => follow('/app?application=' + encodeURIComponent(update.application))}>Open source application</button></p>
    <details><summary>Window rules and source revisions</summary><p>{update.rule}</p>{update.sources.map((s: D) => <p key={s.kind + s.id}>{s.kind} <code>{s.id}</code> · Revision <code>{s.revision}</code></p>)}</details>
    <h4>{update.subject}</h4><p className="pre">{update.body}</p>
    <p>Reviewed application language: {update.templateDraft.language} · template version {update.templateDraft.version}.</p>
  </>
}

export function CandidateUpdates({ w, mutate, follow }: Pick<PageProps, 'w' | 'mutate' | 'follow'>) {
  const report = w.candidateUpdates
  if (!report) return null
  const packets = w.proposals.filter((p: D) => p.workflow === 'candidate-update')
  if (!report.policies.length && !packets.length) return null
  return <section aria-label="Candidate update review"><h2>Candidate update review</h2>
    <p>Your coding agent reads recorded windows through the authenticated candidate-updates API and authors proposals using reviewed text. A human accepts an unsent draft, then requests separate exact-text message approval. No automatic send is enabled.</p>
    <details><summary>Recorded response windows</summary>
      {!report.cases.length && <p>No eligible native response windows with reviewed text.</p>}
      {report.cases.map((update: D) => <article key={update.application} aria-label={'Response window for ' + update.name} className="card"><h3>{update.name}</h3><UpdateEvidence update={update} follow={follow} /></article>)}
    </details>
    {packets.map((p: D) => <article className="card" key={p.id} aria-label={'Update proposal for ' + p.update.name}>
      <h3>{p.summary}</h3><p>Agent-authored update · {p.status} · unsent</p>
      <UpdateEvidence update={p.update} follow={follow} />
      {p.status === 'proposed' && !w.actor.agent && p.approver === w.actor.email && <Form label="Review candidate update" onSubmit={values => mutate('decide-proposal', { id: p.id, ...values })}>
        <Field label="Update decision" name="decision" options={[{ value: 'accepted', label: 'Accept into unsent draft' }, { value: 'rejected', label: 'Reject draft' }]} />
        <Field label="Update review reason" name="reason" />
      </Form>}
      {p.results?.length > 0 && <p><button className="link" onClick={() => follow('/app?application=' + encodeURIComponent(p.update.application))}>Review unsent message</button> · Exact-text approval still required. No delivery or completion verified.</p>}
      {p.reason && <p>Review reason: {p.reason}</p>}
    </article>)}
  </section>
}

/** Response promises and text selection are configuration, kept under Settings. */
export function CandidateUpdateSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const [selected, setSelected] = useState('')
  if (w.actor.agent) return null
  const jobs = w.vacancies.filter((v: D) => v.manages && v.permissions.includes('contact') && v.permissions.includes('settings') && v.status !== 'closed' && !v.imported)
  if (!jobs.length) return null
  const policy = w.candidateUpdates?.policies.find((p: D) => p.vacancy === selected)
  const templates = w.messageTemplates.filter((t: D) => t.vacancy === selected)
  return <section className="card" aria-label="Candidate response window settings"><h2>Candidate response windows</h2>
    <p>These promises measure native recorded events. They do not monitor a mailbox or authorize sending. Review status and rejection text in Message templates first; rejection text must match the already scheduled DISP-001 email exactly.</p>
    <label>Response window job<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose…</option>{jobs.map((v: D) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
    {selected && <Form key={selected + ':' + policy?.revision} label="Save response window" onSubmit={values => mutate('candidate-update-policy', { ...values, vacancy: selected, revision: policy?.revision ?? null, businessDays: Number(values.businessDays) })}>
      <Field label="Response window business days" name="businessDays" type="number" defaultValue={policy?.businessDays ?? 5} />
      <Field label="Response window time zone" name="timeZone" defaultValue={policy?.timeZone ?? w.business.timeZone} />
      <Field label="Reviewed status template" name="statusTemplate" defaultValue={policy?.statusTemplate} options={templates.filter((t: D) => t.versions.every((v: D) => v.purpose === 'other')).map((t: D) => ({ value: t.id, label: t.name }))} />
      <Field label="Reviewed rejection template" name="rejectionTemplate" defaultValue={policy?.rejectionTemplate} options={templates.filter((t: D) => t.versions.every((v: D) => v.purpose === 'rejection')).map((t: D) => ({ value: t.id, label: t.name }))} />
      <p>{w.candidateUpdates?.rule}</p>
    </Form>}
    {policy && <p>Response window saved · version {policy.version}. Sending remains unconnected.</p>}
  </section>
}
