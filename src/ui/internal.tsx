import type { PageProps } from './app'
import { when } from './format'
import { person } from './names'
import { Check, Field, Form, Table, type D } from './shared'

// ATTR-005: the internal job board every member sees, the job's internal-only
// switch for the people who run it, and the admins' manager-notice policy.

export function InternalJobs({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const jobs = (w.internalBoard ?? []) as D[]
  const notices = (w.internalNotices ?? []) as D[]
  if (!jobs.length && !notices.length) return null
  return <section className="card" aria-label="Internal jobs">
    <h2>Internal jobs</h2>
    <p className="hint">Open roles you can apply to as an employee. Only the job’s hiring team and the hiring admins see your application.</p>
    <ul className="list rich internal-jobs">{jobs.map(j => <li key={j.id}><span><strong>{j.title}</strong><small>{[j.department, j.location, j.internalOnly ? 'Internal only' : 'Also on the careers page', j.applied ? `You applied ${when(j.applied)}` : ''].filter(Boolean).join(' · ')}</small></span>
      {!j.applied && j.californiaNotice && <details><summary>California applicant privacy notice (version {j.californiaNotice.version})</summary><dl>{j.californiaNotice.categories.map((c: D) => <div key={c.category}><dt>{c.category}</dt><dd>{c.collected} Used for: {c.purposes} {c.retention}</dd></div>)}</dl><p>{j.californiaNotice.saleStatement}</p></details>}
      {!j.applied && <Form label={'Apply to ' + j.title} compact onSubmit={() => mutate('apply-internal', { vacancy: j.id, cpraNoticeVersion: j.californiaNotice?.version })} />}</li>)}</ul>
    {notices.length > 0 && <><h3>Your reports’ internal applications</h3><ul className="plain">{notices.map(n => <li key={n.id}>{n.who} applied to {n.title} · {when(n.at)}</li>)}</ul></>}
  </section>
}

export function VacancyInternal({ v, mutate }: { v: D; mutate: PageProps['mutate'] }) {
  return <Form label="Save who sees this job" compact onSubmit={x => mutate('vacancy-internal', { id: v.id, internalOnly: x.internalOnly === true })}>
    <Check name="internalOnly" label="Internal only: employees see it in Lodge; never on the careers page, embed or job boards" defaultChecked={v.internalOnly === true} />
  </Form>
}

export function InternalSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const people = (w.members as D[]).filter(m => m.active && !m.agent)
  return <section aria-label="Internal applications">
    <h2>Internal applications</h2>
    <Form label="Save internal policy" compact onSubmit={x => mutate('internal-policy', { notifyManager: x.notifyManager === true })}>
      <Check name="notifyManager" label="Tell an internal applicant’s manager (who they report to) that they applied" defaultChecked={w.internalPolicy?.notifyManager === true} />
    </Form>
    <Table heads={['Member', 'Reports to']} empty="No members yet.">{people.map(m => <tr key={m.email}><td>{m.name}</td><td>{m.reportsTo ? person(w, m.reportsTo) : '—'}</td></tr>)}</Table>
    <Form label="Save reporting line" reset compact onSubmit={x => mutate('reports-to', { email: x.email, reportsTo: x.reportsTo })}>
      <Field label="Member" name="email" options={people.map(m => ({ value: m.email, label: m.name }))} />
      <Field label="Reports to" name="reportsTo" required={false} options={people.map(m => ({ value: m.email, label: m.name }))} />
    </Form>
  </section>
}
