import type { PageProps } from './app'
import { AgencySubmission } from './agency-portal'
import { call, Check, Field, Form, Status, type D } from './shared'

const PROGRESS = ['Submitted', 'In review', 'Interviewing', 'Offer', 'Hired', 'Not progressing', 'Withdrawn']
const OUTCOMES = ['Accepted-credited', 'Not accepted: duplicate', 'Not accepted']
const options = (values: string[]) => values.map(value => ({ value, label: value }))

function SubmissionReview({ submission: s, w, mutate }: { submission: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const application = w.applications.find((a: D) => a.id === s.application)
  return <article className="card" aria-label={'Agency submission: ' + s.name}>
    <h4>{s.name}</h4><AgencySubmission submission={s} />
    {s.outcome === 'Under review' && <details><summary>Review ownership and submission</summary>
      <p className="hint">Choose a new or existing candidate explicitly. Lodge does not merge candidates automatically.</p>
      <Form label="Record agency review" onSubmit={x => mutate('agency-review', { id: s.id, outcome: x.outcome, reason: x.reason, candidate: x.outcome === 'Accepted-credited' && x.candidate !== 'new' ? x.candidate : undefined })}>
        <Field label="Submission outcome" name="outcome" options={options(OUTCOMES)} />
        <Field label="Candidate for acceptance" name="candidate" defaultValue="new" options={[{ value: 'new', label: 'Create a new candidate' }, ...w.candidates.map((c: D) => ({ value: c.id, label: `${c.name} (${c.email || 'no email'})` }))]} />
        <Field label="Reason for review decision" name="reason" type="textarea" wide />
      </Form>
    </details>}
    <details><summary>Share progress and agency feedback</summary>
      <Form key={JSON.stringify([s.progress, s.feedback, s.interviews])} label="Save agency progress" onSubmit={x => mutate('agency-progress', { id: s.id, progress: x.progress, feedback: x.feedback, interviews: s.interviews ?? [] })}>
        <Field label="Progress visible to agency" name="progress" defaultValue={s.progress} options={options(PROGRESS)} />
        <Field label="Feedback addressed to agency" name="feedback" type="textarea" wide required={false} defaultValue={s.feedback} />
      </Form>
    </details>
    {s.outcome === 'Accepted-credited' && application?.status === 'hired' && <details><summary>Record a fee milestone</summary>
      <p className="hint">Employer-recorded fees only; this records a milestone, not a payment.</p>
      <Form label="Record fee milestone" reset onSubmit={x => mutate('agency-fee', { id: s.id, fee: x.fee || undefined, label: x.label, amountCents: Number(x.amountCents), status: x.status })}>
        {s.fees?.length > 0 && <Field label="Update an existing milestone (optional)" name="fee" required={false} options={s.fees.map((f: D) => ({ value: f.id, label: f.label }))} />}
        <Field label="Fee milestone" name="label" />
        <Field label="Amount (USD cents)" name="amountCents" type="number" hint="For example, 125050 records USD 1,250.50." />
        <Field label="Fee status" name="status" options={options(['agreed', 'due', 'paid'])} />
      </Form>
    </details>}
  </article>
}

function Agency({ agency: a, v, w, mutate }: { agency: D; v: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const grant = a.jobs.find((j: D) => j.vacancy === v.id)
  const submissions = a.submissions.filter((s: D) => s.vacancy === v.id)
  return <section aria-label={a.name}>
    <h4>{a.name} <Status tone={a.active ? 'good' : 'neutral'}>{a.active ? 'active' : 'revoked'}</Status></h4><p>{a.email}</p>
    <details><summary>Edit agency access</summary>
      <Form key={JSON.stringify([a.name, a.email, a.active])} label="Save agency access" onSubmit={x => mutate('agency', { id: a.id, email: x.email, name: x.name, active: x.active === true })}>
        <Field label="Agency name" name="name" defaultValue={a.name} /><Field label="Agency email" name="email" type="email" defaultValue={a.email} />
        <Check name="active" label="Agency access active" defaultChecked={a.active} />
      </Form>
    </details>
    {a.active && <Form key={JSON.stringify(grant)} label="Save job invitation and fee terms" onSubmit={x => mutate('agency-job', { agency: a.id, vacancy: v.id, active: x.active === true, feeTerms: x.feeTerms })}>
      <Check name="active" label={`Agency invited to ${v.title}`} defaultChecked={grant?.active} />
      <Field label="Agreed fee terms for this job" name="feeTerms" type="textarea" wide required={false} defaultValue={grant?.feeTerms} />
    </Form>}
    {w.actor.owner && a.active && <Form label="Invite agency to sign in" compact onSubmit={() => call('invite', { email: a.email })} />}
    {submissions.map((s: D) => <SubmissionReview key={s.id} submission={s} w={w} mutate={mutate} />)}
  </section>
}

/** Only the owner and hiring admins on a job they run reach this section. */
export function Agencies({ v, w, mutate }: { v: D } & Pick<PageProps, 'w' | 'mutate'>) {
  return <section aria-label="Agency collaboration">
    <h3>Agency collaboration</h3>
    {(w.agencies ?? []).map((a: D) => <Agency key={a.id} agency={a} v={v} w={w} mutate={mutate} />)}
    <details><summary>Add an agency</summary>
      <p className="hint">Saving creates agency-only membership. Invite the agency to this job with agreed fee terms, then the owner can invite them to sign in.</p>
      <Form label="Create agency membership" reset onSubmit={x => mutate('agency', { email: x.email, name: x.name, active: true })}>
        <Field label="Agency name" name="name" /><Field label="Agency email" name="email" type="email" />
      </Form>
    </details>
  </section>
}
