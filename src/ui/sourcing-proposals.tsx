import { useState } from 'react'
import type { PageProps } from './app'
import { Check, Field, Form, type D } from './shared'

export function SourcingSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const [jobId, setJobId] = useState(''), [criteria, setCriteria] = useState<string[]>([])
  const jobs = w.vacancies.filter((v: D) => v.manages && v.approvedNow && v.status === 'open')
  const job = jobs.find((v: D) => v.id === jobId) ?? jobs[0]
  if (w.actor.agent || !(w.actor.owner || w.actor.roles.includes('admin')) || !job) return null
  const templates = w.messageTemplates.filter((t: D) => t.vacancy === job.id)
  return <section className="card" aria-label="Sourcing research settings"><h2>Prior-pool research criteria</h2>
    <p>Select job-related criteria and reviewed language for an external agent. Only consented native pool records may be researched. No campaign or sending is enabled.</p>
    <label>Sourcing role<select value={job.id} onChange={e => { setJobId(e.target.value); setCriteria([]) }}>{jobs.map((v: D) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
    <Form key={job.id} label="Save sourcing criteria" onSubmit={values => mutate('sourcing-brief', { ...values, vacancy: job.id, criteria })}>
      <fieldset><legend>Job-related criteria</legend>{job.rubrics.at(-1).criteria.map((c: D) => <label key={c.id}><input type="checkbox" checked={criteria.includes(c.id)} onChange={e => setCriteria(e.target.checked ? [...criteria, c.id] : criteria.filter(id => id !== c.id))} />{c.name}: {c.description}</label>)}</fieldset>
      <Field label="Sourcing template" name="template" options={templates.map((t: D) => ({ value: t.id, label: t.name }))} />
      <Field label="Reviewed outreach language" name="language" defaultValue="en" />
      <Check label="I reviewed these criteria, template and language" name="reviewed" />
    </Form>
    {(w.sourcingBriefs ?? []).filter((b: D) => b.vacancy === job.id).map((b: D) => <p key={b.id}>Selected {b.criteria.map((c: D) => c.name).join(', ')} · {b.language}<details><summary>Agent brief reference</summary><code>{b.id}</code></details></p>)}
  </section>
}

export function SourcingDraft({ p, w, mutate }: Pick<PageProps, 'w' | 'mutate'> & { p: D }) {
  return <article className="card" aria-label="Sourcing research draft"><p className="eyebrow">Agent-authored research packet · {p.status}</p>
    <h2>{p.summary}</h2><p>{p.research.boundary}</p>
    {p.stale && <p role="status">Sources changed. Request a fresh packet before keeping this draft.</p>}
    <h3>Human-selected criteria</h3><ul>{p.research.criteria.map((c: D) => <li key={c.id}>{c.name}: {c.description}</li>)}</ul>
    <h3>Recorded facts</h3><p>Exact source passages, not verified experience or a suitability assessment. People choose whom to interview.</p>
    {p.claims.map((c: D, i: number) => <section key={i}><h4>{c.criterionName}</h4><blockquote>{c.text}</blockquote><details><summary>Inspect cited source</summary>
      <p>{c.source.label} · {c.source.kind} · <code>{c.source.id}</code></p><p>Revision <code>{c.source.revision}</code> · Field {c.source.field}</p>
      <p className="pre">{p.research.passages.find((x: D) => x.kind === c.source.kind && x.id === c.source.id && x.field === c.source.field)?.text}</p>
    </details></section>)}
    <details><summary>Consent and retention evidence</summary><p>Talent-pool permission: recorded · Basis {p.research.permission.basis} · Recorded {p.research.permission.at} · Retain through {p.research.permission.retainUntil} · Contact preference {p.research.permission.contactPreference}.</p></details>
    <h3>Individual outreach draft</h3><p>Unsent · human-selected language {p.research.template.language} · reviewed template version {p.research.template.version}</p>
    <p><strong>{p.outreach.subject}</strong></p><p className="pre">{p.outreach.body}</p>
    <details><summary>Template review provenance</summary><p>Reviewed {p.research.template.reviewedAt} by {p.research.template.reviewedBy}</p><p>Template <code>{p.research.template.id}</code> · Revision <code>{p.research.template.revision}</code></p></details>
    {p.status === 'proposed' && !w.actor.agent && w.actor.email === p.approver && <Form label="Record sourcing review" onSubmit={values => mutate('decide-proposal', { id: p.id, ...values })}>
      <Field label="Sourcing draft decision" name="decision" options={[{ value: 'kept', label: 'Keep draft only' }, { value: 'rejected', label: 'Reject draft' }]} />
      <Field label="Sourcing review reason" name="reason" />
    </Form>}
    {p.reason && <p>Review reason: {p.reason}</p>}
  </article>
}
