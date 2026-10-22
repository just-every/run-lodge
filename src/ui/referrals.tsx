import { useState } from 'react'
import { Avatar } from './shared'
import { Icon } from './icons'
import type { PageProps } from './app'
import { when, amount } from './format'
import { Check, Field, fileFrom, Form, readFile, Status, type D } from './shared'

function Questions({ questions }: { questions: D[] }) {
  return <>{questions.map(q => <label key={q.question}>{q.text}{q.type === 'file' ? <input type="file" name={'answer-' + q.question} required={q.required} />
    : q.type === 'multiple-choice' ? <select name={'answer-' + q.question} multiple required={q.required}>{q.options.map((o: string) => <option key={o}>{o}</option>)}</select>
      : q.type === 'yes-no' || q.type === 'single-choice' ? <select name={'answer-' + q.question} required={q.required}><option value="">Choose…</option>{(q.type === 'yes-no' ? ['yes', 'no'] : q.options).map((o: string) => <option key={o}>{o}</option>)}</select>
        : q.type === 'long-text' ? <textarea name={'answer-' + q.question} required={q.required} maxLength={8000} />
          : <input name={'answer-' + q.question} type={q.type === 'number' || q.type === 'date' ? q.type : 'text'} required={q.required} maxLength={q.type === 'short-text' ? 300 : undefined} />}</label>)}</>
}
async function readAnswers(job: D, form: HTMLFormElement) {
  const data = new FormData(form), answers: D = {}
  for (const q of job.questions ?? []) {
    const key = 'answer-' + q.question
    if (q.type === 'file') { const f = fileFrom(form, key); if (f) answers[q.question] = await readFile(f) }
    else answers[q.question] = q.type === 'multiple-choice' ? data.getAll(key) : data.get(key)
  }
  return answers
}
function Milestones({ rows }: { rows: D[] }) {
  return <>{rows.map(m => <p key={m.id}>{m.label} · {amount(m.amountCents)} USD · {m.status === 'paid' ? 'paid (recorded by the employer)' : m.status}</p>)}</>
}
/** Mounted in the existing shell for members and the employee-only portal. */
export function Referrals({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const p = w.referrals
  if (!p) return null
  return <section aria-label="Employee referrals" className="card">
    <h2>Employee referrals</h2>
    <p className="hint">Refer someone who has agreed to share their details and resume. Updates appear here when the hiring team shares them. {p.emailAvailable ? 'With job alerts on, new jobs and shared updates on your referrals are also emailed to you; turning alerts off stops both the emails and the alerts here.' : 'Email updates are unavailable: this installation has no mail set up, so alerts and updates appear here only.'}</p>
    <Form label="Save referral job alerts" compact onSubmit={x => mutate('referral-alerts', { enabled: x.enabled === true })}>
      <Check name="enabled" label="Send me job opportunity alerts" defaultChecked={p.enabled} />
    </Form>
    {p.alerts?.length > 0 && <section aria-label="Referral job alerts"><h3>Job opportunity alerts</h3><ul>{p.alerts.map((x: D) => <li key={x.id}>{x.title} · {when(x.at)}</li>)}</ul></section>}
    <h3>Jobs accepting referrals</h3>
    {!p.jobs.length && <p className="empty">No jobs currently accepting referrals.</p>}
    {p.jobs.map((job: D) => <details key={job.id}><summary>Refer someone for {job.title}</summary><p>{job.location}</p><p className="prose">{job.description}</p>
      <Form label="Submit referral" reset onSubmit={async (x, form) => {
        const resume = fileFrom(form, 'resume')
        if (!resume) throw new Error('A resume is required.')
        await mutate('referral-submit', { vacancy: job.id, name: x.name, email: x.email, phone: x.phone, consentNote: x.consentNote, confirmed: x.confirmed === true, resume: await readFile(resume), answers: await readAnswers(job, form) })
      }}>
        <Field label="Candidate name" name="name" /><Field label="Candidate email" name="email" type="email" /><Field label="Candidate phone" name="phone" required={false} />
        <Field label="Candidate permission statement" name="consentNote" type="textarea" wide />
        <label>Resume<input type="file" name="resume" required /></label>
        <Questions questions={job.questions ?? []} />
        <Check name="confirmed" label="The candidate permitted this referral and sharing these details and resume with this employer." />
      </Form>
    </details>)}
    <h3>Your referrals</h3>
    {!p.submissions.length && <p className="empty">No referrals submitted yet.</p>}
    {p.submissions.map((r: D) => <section key={r.id} aria-label={'Referral: ' + r.name} className="card">
      <h4>{r.name}</h4><p>{r.email} · Submitted {when(r.submittedAt)}</p><p><Status>{r.status}</Status>{r.sharedAt && <> · Shared {when(r.sharedAt)}</>}</p>
      <p>{r.consentNote}</p><ul>{r.files.map((f: D) => <li key={f.id}><a href={'/api/lodge/referral/file/' + encodeURIComponent(f.id)}>{f.name}</a></li>)}</ul>
      <Milestones rows={r.milestones ?? []} />
    </section>)}
    <p><a href="/api/lodge/referral/export">Export your referrals (JSON)</a></p><p className="hint">Bonus milestones are employer records. Lodge does not run payroll or make payments.</p>
  </section>
}
/** Recruiter controls stay inside the existing vacancy workspace. */
export function ReferralReview({ w, v, mutate }: Pick<PageProps, 'w' | 'mutate'> & { v: D }) {
  const rows = (w.referralReviews ?? []).filter((r: D) => r.vacancy === v.id)
  if (!v.manages) return null
  return <section aria-label="Referral reconciliation" className="card"><h2>Referral reconciliation</h2>
    {!rows.length && <p className="empty">No employee referrals for this job.</p>}
    {rows.map((r: D) => <section key={r.id} aria-label={'Review referral: ' + r.name} className="card"><h3>{r.name}</h3>
      <p>{r.email} · Referred by {r.employee} · {r.outcome}</p><p>{r.consentNote}</p>
      <ul>{r.files.map((f: D) => <li key={f.id}><a href={'/api/lodge/referral/file/' + f.id}>{f.name}</a></li>)}</ul>
      {r.outcome === 'Under review' && <Form label="Record referral reconciliation" onSubmit={x => mutate('referral-review', { ...x, id: r.id, creditEmployee: x.creditEmployee === true })}>
        <Field label="Referral decision" name="outcome" options={['accepted', 'duplicate', 'declined'].map(value => ({ value, label: value }))} />
        <Field label="Existing candidate (leave blank to create a new candidate)" name="candidate" required={false} options={(w.candidates ?? []).filter((c: D) => c.email).map((c: D) => ({ value: c.id, label: c.name + ' · ' + c.email }))} />
        <Field label="Reconciliation reason" name="reason" type="textarea" wide />
        <Check name="creditEmployee" label="Explicitly credit this employee on an existing application" />
        <Field label="Credit change reason" name="creditReason" required={false} />
      </Form>}
      <Form label="Share referral status" compact onSubmit={x => mutate('referral-progress', { id: r.id, progress: x.progress })}>
        <Field label="Status visible to employee" name="progress" defaultValue={r.progress ?? ''} options={['received', 'in progress', 'closed', 'hired'].map(value => ({ value, label: value }))} />
      </Form>
      <Milestones rows={r.milestones ?? []} />
      {r.creditedHire && <details><summary>Record employer-approved bonus milestone</summary><Form label="Record bonus milestone" onSubmit={x => mutate('referral-bonus', { ...x, id: r.id, amountCents: Number(x.amountCents), approved: x.approved === true })}>
        <Field label="Approved bonus milestone" name="label" /><Field label="Approved USD bonus (cents)" name="amountCents" type="number" />
        <Field label="Employer-recorded bonus state" name="status" options={[['approved', 'approved'], ['due', 'due'], ['paid', 'paid (recorded by the employer)']].map(([value, label]) => ({ value, label }))} />
        <Check name="approved" label="The employer approved this bonus milestone" />
      </Form></details>}
    </section>)}
  </section>
}

/** Employee identities use the established portal shell and receive no hiring workspace. */
export function ReferralPortal({ w, mutate, reload, notice }: Pick<PageProps, 'w' | 'mutate' | 'reload'> & { notice: string }) {
  const [error, setError] = useState('')
  async function signOut() {
    try { const response = await fetch('/auth/signout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error('Could not sign out; try again.'); location.href = '/signin' }
    catch (e) { setError((e as Error).message) }
  }
  return <div className="shell"><aside className="rail"><div className="rail-top"><a className="lockup" href="/app"><img src="/brand/mark.svg" alt="" width="46" height="31" /><strong data-rer-name>Lodge</strong></a><p className="business">{w.referralPortal.name}</p></div>
    <nav aria-label="Workspace"><a href="/app" aria-current="page"><Icon name="people" /><span>Employee referrals</span></a></nav>
    <div className="me"><Avatar name={w.actor.name} /><p><strong>{w.actor.name}</strong><small>Employee</small></p></div><div className="sign-out"><button className="link" onClick={signOut}>Sign out</button>{error && <p role="alert">{error}</p>}</div>
  </aside><div className="work"><header className="topbar"><Form compact label="Refresh" onSubmit={reload} /></header><main><p aria-live="polite" className="notice">{notice}</p><div className="page"><h1>Referral portal</h1><p className="hint">Times shown in {w.referralPortal.timeZone}.</p><Referrals w={w} mutate={mutate} /></div></main></div></div>
}
