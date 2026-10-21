import { useState } from 'react'
import type { PageProps } from './app'
import { amount, pay, when } from './format'
import { Icon } from './icons'
import { Avatar, Check, Field, fileFrom, Form, readFile, Status, Table, type D } from './shared'

/** Frozen submission material shared by the portal and the employer's review. */
export function AgencySubmission({ submission: s }: { submission: D }) {
  if (s.feesOnly) return <AgencyFees fees={s.fees ?? []} />
  return <>
    <p className="meta">Submitted {when(s.submittedAt)} · <Status>{s.outcome}</Status> <Status>{s.progress}</Status></p>
    <dl className="terms"><dt>Email</dt><dd>{s.email}</dd>{s.phone && <><dt>Phone</dt><dd>{s.phone}</dd></>}
      <dt>Summary</dt><dd className="prose">{s.summary || 'No summary supplied.'}</dd><dt>Consent note</dt><dd>{s.consentNote}</dd></dl>
    {s.files?.length > 0 && <ul>{s.files.map((f: D) => <li key={f.id}><a href={'/api/lodge/agency/file/' + encodeURIComponent(f.id)}>{f.name}</a> <small>{f.mediaType} · {f.bytes} bytes</small></li>)}</ul>}
    {s.feedback && <p><strong>Feedback to agency:</strong> {s.feedback}</p>}
    {s.interviews?.length > 0 && <><h4>Shared interviews</h4><ul>{s.interviews.map((i: D, n: number) => <li key={n}>{when(i.start)} – {when(i.end)} · {i.format}</li>)}</ul></>}
    <AgencyFees fees={s.fees ?? []} />
  </>
}

export function AgencyFees({ fees }: { fees: D[] }) {
  if (!fees.length) return null
  return <><h4>Employer-recorded fees</h4><Table heads={['Milestone', 'Amount (USD)', 'Status']}>{fees.map((f: D) => <tr key={f.id}><td>{f.label}</td><td>{amount(f.amountCents)} USD</td><td>{f.status}</td></tr>)}</Table></>
}

function SubmissionForm({ job, mutate }: { job: D; mutate: PageProps['mutate'] }) {
  return <details><summary>Submit a candidate for {job.title}</summary>
    <Form label="Submit candidate" reset onSubmit={async (x, form) => {
      if (!x.confirmed) throw new Error('Confirm the candidate agreed to this submission.')
      const resume = fileFrom(form, 'resume')
      await mutate('agency-submit', { vacancy: job.id, name: x.name, email: x.email, phone: x.phone, summary: x.summary, consentNote: x.consentNote, confirmed: true, resume: resume ? await readFile(resume) : undefined })
    }}>
      <Field label="Candidate name" name="name" /><Field label="Candidate email" name="email" type="email" />
      <Field label="Candidate phone" name="phone" required={false} />
      <Field label="Candidate summary" name="summary" type="textarea" wide required={false} />
      <Field label="Consent note" name="consentNote" type="textarea" wide />
      <label>Resume<input type="file" name="resume" /></label>
      <Check name="confirmed" label="The candidate agreed to this submission and sharing these details and resume with this employer." />
    </Form>
  </details>
}

/** An agency receives its portal projection only, never the employer workspace. */
export function AgencyPortal({ w, mutate, reload, notice }: Pick<PageProps, 'w' | 'mutate' | 'reload'> & { notice: string }) {
  const [signOutError, setSignOutError] = useState('')
  const portal = w.agencyPortal
  async function signOut() {
    setSignOutError('')
    try {
      const response = await fetch('/auth/signout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (!response.ok) throw new Error('Lodge could not be reached to sign out; try again.')
      location.href = '/signin'
    } catch (e) { setSignOutError((e as Error).message) }
  }
  return <div className="shell">
    <aside className="rail">
      <div className="rail-top"><a className="lockup" href="/app"><img src="/brand/mark.svg" alt="" width="46" height="31" /><strong data-rer-name>Lodge</strong></a><p className="business">{portal.name}</p></div>
      <nav aria-label="Workspace"><a href="/app" aria-current="page"><Icon name="vacancies" /><span>Agency portal</span></a></nav>
      <div className="me"><Avatar name={w.actor.name} /><p><strong>{w.actor.name}</strong><small>Agency</small></p></div>
      <div className="sign-out"><button className="link" onClick={signOut}>Sign out</button>{signOutError && <p role="alert">{signOutError}</p>}</div>
    </aside>
    <div className="work"><header className="topbar"><Form label="Refresh" compact onSubmit={reload} /><a href="/api/lodge/agency/export">Export agency records (JSON)</a></header>
      <main><p aria-live="polite" className="notice">{notice}</p><div className="page">
        <h1>Agency portal</h1><p className="hint">Times shown in {portal.timeZone}.</p>
        <h2>Invited jobs</h2>
        {!portal.jobs.length && <p className="empty">No invited jobs.</p>}
        {portal.jobs.map((job: D) => <section className="card" key={job.id} aria-label={job.title}>
          <h3>{job.title}</h3><p className="meta">{[job.location, pay(job.compensation)].filter(Boolean).join(' · ')}</p>
          <p className="prose">{job.description}</p><p><strong>Fee terms:</strong> {job.feeTerms || 'Not recorded.'}</p>
          <SubmissionForm job={job} mutate={mutate} />
        </section>)}
        <h2>Your submissions</h2>
        {!portal.submissions.length && <p className="empty">No submissions yet.</p>}
        {portal.submissions.map((s: D) => <section className="card" key={s.id} aria-label={s.feesOnly ? 'Placement fee milestones' : 'Submission: ' + s.name}>
          {s.feesOnly ? <h3>Placement fee milestones</h3> : <><h3>{s.name}</h3><p>{portal.jobs.find((j: D) => j.id === s.vacancy)?.title ?? 'Previously invited job'}</p></>}
          <AgencySubmission submission={s} />
        </section>)}
      </div></main>
      <footer className="shell-foot">Fees are employer records in USD. Lodge does not make payments.</footer>
    </div>
  </div>
}
