import { useEffect, useState } from 'react'
import type { PageProps } from './app'
import { when } from './format'
import { call, Field, Form, Status, Table, type D } from './shared'

// DISP-001: the reason list and rejection templates (admins), the close form every
// rejection or withdrawal goes through, and the state of each scheduled rejection email.

const GROUP: D = { rejected: 'We rejected them', withdrew: 'They withdrew' }

export const reasonOptions = (w: D, group: 'rejected' | 'withdrew') =>
  (w.rejectionReasons ?? []).filter((r: D) => r.group === group && !r.retired).map((r: D) => ({ value: r.id, label: r.label }))
const templateOptions = (w: D) => (w.rejectionTemplates ?? []).filter((t: D) => !t.retired).map((t: D) => ({ value: t.id, label: t.name }))

/** The email choice of a rejection: none, now, or after a number of business days. */
export function EmailChoice({ w }: { w: D }) {
  const templates = templateOptions(w)
  if (!templates.length) return <p className="hint">No rejection templates yet, so no email is scheduled. An admin adds them under People and settings.</p>
  return <>
    <Field label="Rejection email" name="send" defaultValue="none" options={[{ value: 'none', label: 'No email' }, { value: 'now', label: 'Send now' }, { value: 'delay', label: 'After some business days' }]} />
    <Field label="Template" name="template" required={false} options={templates} />
    <Field label="Business days to wait" name="businessDays" type="number" required={false} defaultValue={2} hint="Monday to Friday in the business time zone; public holidays still count." />
  </>
}

export const emailBody = (x: D) => x.send && x.send !== 'none' ? { send: x.send, template: x.template, businessDays: x.send === 'delay' ? Number(x.businessDays) : undefined } : { send: 'none' }

/** Reject or record a withdrawal: a reason from the employer's list, an optional note, and the email choice. */
export function CloseForm({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  return <details><summary>Reject or record a withdrawal</summary>
    <Form label="Close application" compact reset onSubmit={x => {
      const to = x.why.startsWith('withdrew:') ? 'withdrawn' : 'rejected'
      return mutate('move', { application: app.id, to, closeReason: x.why.slice(x.why.indexOf(':') + 1), reason: x.note, ...(to === 'rejected' ? emailBody(x) : {}) })
    }}>
      <Field label="Why it closes" name="why" options={(['rejected', 'withdrew'] as const).flatMap(g => reasonOptions(w, g).map((o: D) => ({ value: `${g}:${o.value}`, label: `${GROUP[g]} · ${o.label}` })))} />
      <Field label="Note for the history (optional)" name="note" required={false} />
      <EmailChoice w={w} />
    </Form>
  </details>
}

const STATE: D = { scheduled: ['neutral', 'scheduled'], 'due-not-sent': ['warn', 'due, not sent'], canceled: ['neutral', 'canceled'] }

/** Each rejection email of an application, with its honest state: Lodge has no candidate mailbox until COM-001 connects one. */
export function RejectionEmails({ app, w }: { app: D; w: D }) {
  const emails = (w.rejectionEmails ?? []).filter((m: D) => m.application === app.id)
  if (!emails.length) return null
  return <section aria-label="Rejection emails"><h3>Rejection emails</h3><ul className="plain">{emails.map((m: D) => <li key={m.id}>
    <Status tone={STATE[m.state][0]}>{STATE[m.state][1]}</Status> “{m.templateName}” to {m.to} · {m.state === 'canceled' ? `${m.canceledReason}, ${when(m.canceledAt)}` : `send time ${when(m.sendAt)}`}
    {m.state === 'due-not-sent' && <small> Lodge sends no email until a candidate mailbox is connected (COM-001); nothing has gone to the candidate.</small>}
    <details><summary>{m.subject}</summary><p className="pre">{m.body}</p></details>
  </li>)}</ul></section>
}

/** Admins keep the reason list and the templates; admins and managers read rejection reasons by job. */
export function RejectionSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const list: D[] = w.rejectionReasons ?? [], active = list.filter(r => !r.retired)
  const save = (next: D[]) => mutate('rejection-reasons', { reasons: next.map(r => ({ id: r.id, label: r.label, group: r.group })) })
  const [report, setReport] = useState<D>()
  useEffect(() => { call('reports/rejections').then(setReport).catch(() => setReport(undefined)) }, [w])
  return <section aria-label="Rejection reasons and templates">
    <h2>Rejection reasons and templates</h2>
    {(['rejected', 'withdrew'] as const).map(g => <div key={g}><h3>{GROUP[g]}</h3>
      <Table heads={['Reason', '']}>{active.filter(r => r.group === g).map(r => <tr key={r.id}><td>{r.label}</td><td><Form label="Retire" compact onSubmit={() => save(active.filter(x => x.id !== r.id))} /></td></tr>)}</Table></div>)}
    <Form label="Add reason" compact reset onSubmit={x => save([...active, { label: x.label, group: x.group }])}>
      <Field label="New reason" name="label" />
      <Field label="Group" name="group" options={[{ value: 'rejected', label: GROUP.rejected }, { value: 'withdrew', label: GROUP.withdrew }]} />
    </Form>
    <h3>Rejection templates</h3>
    <Table heads={['Template', 'Subject', '']} empty="No rejection templates yet.">{(w.rejectionTemplates ?? []).filter((t: D) => !t.retired).map((t: D) => <tr key={t.id}><td>{t.name}</td><td>{t.subject}</td>
      <td><Form label="Retire" compact onSubmit={() => mutate('rejection-template', { ...t, retired: true })} /></td></tr>)}</Table>
    <Form label="Save template" reset onSubmit={x => mutate('rejection-template', { name: x.name, subject: x.subject, body: x.body })}>
      <Field label="Template name" name="name" />
      <Field label="Subject" name="subject" />
      <Field label="Message" name="body" type="textarea" wide hint="Merge fields: {candidate_name}, {job_title}, {business_name}. Editing a template never changes an email already scheduled." />
    </Form>
    {report && <><h3>Rejection reasons by job</h3>
      <Table heads={['Job', 'Group', 'Reason', 'Closed']} empty="No closed applications yet.">{report.jobs.flatMap((j: D) => [...j.rejected, ...j.withdrew].map((r: D) => <tr key={j.id + (r.reason ?? r.group)}><td>{j.title}</td><td>{r.groupLabel}</td><td>{r.label}{r.retired ? ' (retired)' : ''}</td><td>{r.count}</td></tr>))}</Table>
      <p className="hint">{report.definitions}</p></>}
  </section>
}
