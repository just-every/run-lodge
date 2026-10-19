import type { PageProps } from './app'
import { day, money } from './format'
import { person, sentence, tone } from './names'
import { cents, Field, Form, memberOptions, Status, type D } from './shared'

const purpose = (p: string) => sentence(p.replace(/-/g, ' '))

function approvalState(x: D, w: D) {
  if (x.approvedNow) return <Status tone="good">approved</Status>
  if (x.approval?.status === 'pending' && x.approval.version === x.version) return <Status tone="warn">awaiting {person(w, x.approval.approver)}</Status>
  if (x.approval && x.approval.version !== x.version) return <Status>changed since approval request</Status>
  return <Status>{x.approval?.status ?? 'draft'}</Status>
}

export function Messages({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  const list = w.messages.filter((m: D) => m.application === app.id)
  return <section className="card">
    <h3>Messages to the candidate</h3>
    <p className="hint">Lodge sends nothing. An approved message downloads as an email file to send from your own mailbox.</p>
    {list.map((m: D) => <article key={m.id} className="card"><h4>{m.subject} {approvalState(m, w)}</h4><p>To {m.to} · {purpose(m.purpose)}</p><p className="pre">{m.body}</p>
      {m.approvedNow ? <a href={`/api/lodge/download/message/${m.id}`}>Download approved message (.eml)</a>
        : <Form label="Request approval" compact onSubmit={x => mutate('request-message-approval', { id: m.id, approver: x.approver })}><Field label="Approver" name="approver" options={memberOptions(w.members, 'manager')} /></Form>}
      <details><summary>Edit (needs approval again)</summary><Form label="Save message" onSubmit={x => mutate('message', { id: m.id, application: app.id, purpose: m.purpose, to: x.to, subject: x.subject, body: x.body })}>
        <Field label="To" name="to" defaultValue={m.to} /><Field label="Subject" name="subject" defaultValue={m.subject} /><Field label="Message" name="body" type="textarea" wide defaultValue={m.body} />
      </Form></details>
    </article>)}
    <details><summary>Draft a message</summary><Form label="Save draft" reset onSubmit={x => mutate('message', { application: app.id, purpose: x.purpose, subject: x.subject, body: x.body })}>
      <Field label="Purpose" name="purpose" options={['acknowledgement', 'interview-invitation', 'availability-request', 'reminder', 'rejection', 'offer', 'other'].map(p => ({ value: p, label: purpose(p) }))} />
      <Field label="Subject" name="subject" /><Field label="Message" name="body" type="textarea" wide />
    </Form></details>
  </section>
}

export function Offers({ app, v, w, mutate }: { app: D; v?: D; w: D; mutate: PageProps['mutate'] }) {
  const list = w.offers.filter((o: D) => o.application === app.id)
  return <section className="card">
    <h3>Offer</h3>
    {list.map((o: D) => <article key={o.id} className="card">
      <h4>{o.title} · {money(o.salary)} · starts {day(o.startDate)}{o.opening && ` · opening ${v?.openings?.find((x: D) => x.id === o.opening)?.code ?? ''}`} {o.status === 'draft' ? approvalState(o, w) : <Status tone={tone(o.status)}>{o.status}</Status>}</h4>
      {o.rangeWarning && <p className="warn">{o.rangeWarning}.</p>}
      {o.terms && <p className="pre">{o.terms}</p>}
      <p><a href={`/api/lodge/download/packet/${o.id}`}>Approval packet (JSON)</a>{o.status === 'accepted' && <> · <a href={`/api/lodge/download/handoff/${o.id}`}>HR handoff (JSON)</a></>}</p>
      {o.status === 'draft' && <>
        {!o.approvedNow && <Form label="Request offer approval" compact onSubmit={x => mutate('request-offer-approval', { id: o.id, approver: x.approver })}><Field label="Approver" name="approver" options={memberOptions(w.members, 'approver')} /></Form>}
        <Form label="Record outcome" compact onSubmit={x => mutate('offer-outcome', { id: o.id, outcome: x.outcome, reason: x.reason })}>
          <Field label="Outcome" name="outcome" options={[{ value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' }, { value: 'withdrawn', label: 'Withdrawn by us' }]} />
          <Field label="Note" name="reason" />
        </Form>
      </>}
    </article>)}
    {app.status === 'active' && !list.some((o: D) => o.status === 'draft') && <details><summary>Prepare an offer</summary><Form label="Save offer" reset onSubmit={x => mutate('offer', { application: app.id, title: x.title, startDate: x.startDate, terms: x.terms, opening: x.opening || undefined, salary: { currency: x.currency.toUpperCase(), amount: cents(x.amount), period: x.period } })}>
      <Field label="Job title" name="title" defaultValue={v?.title} />
      <Field label="Start date" name="startDate" type="date" />
      <Field label="Currency" name="currency" defaultValue={v?.compensation?.currency ?? 'USD'} />
      <Field label="Pay" name="amount" type="number" />
      <Field label="Pay period" name="period" defaultValue={v?.compensation?.period ?? 'year'} options={[{ value: 'year', label: 'per year' }, { value: 'month', label: 'per month' }, { value: 'hour', label: 'per hour' }]} />
      <Field label="Other terms" name="terms" type="textarea" wide required={false} />
      {(v?.openings ?? []).some((o: D) => o.status === 'open') && <Field label="Opening it fills" name="opening" defaultValue={v!.openings.find((o: D) => o.status === 'open').id} options={v!.openings.filter((o: D) => o.status === 'open').map((o: D) => ({ value: o.id, label: o.code }))} />}
    </Form></details>}
  </section>
}
