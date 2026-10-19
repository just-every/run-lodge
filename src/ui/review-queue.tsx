import { DocumentViewer } from './document-viewer'
import type { PageProps } from './app'
import { recent, when } from './format'
import { count, person } from './names'
import { Field, Form, Status, type D } from './shared'
import { Answers } from './questions'
import { EmailChoice, emailBody, reasonOptions } from './rejections'

// REVIEW-001: a job's review queue, one application at a time. People who run the job advance, reject with a
// DISP-001 reason or skip; an assigned reviewer records yes, no or maybe for them.

const VIEW: D = { yes: 'Yes', no: 'No', maybe: 'Maybe' }
const said = (r: D) => r.recommendation ? `recommends ${VIEW[r.recommendation]}${r.note ? `: ${r.note}` : ''}` : r.decision === 'skip' ? 'skipped' : r.decision === 'advance' ? 'advanced' : 'rejected'

export function ReviewQueue({ v, w, mutate, open }: { v: D; open: (id: string) => void } & Pick<PageProps, 'w' | 'mutate'>) {
  const q = (w.reviewQueues ?? []).find((x: D) => x.vacancy === v.id)
  if (!q?.remaining) return null
  const app = w.applications.find((a: D) => a.id === q.queue[0])
  if (!app) return null
  const next = v.stages[1]
  const resumes = w.documents.filter((d: D) => (d.application === app.id || (d.candidate === app.candidate && !d.application)) && d.kind === 'resume')
  const reviews = q.reviews.filter((r: D) => r.application === app.id)
  return <section className="card review-queue" aria-label="Review queue">
    <h3>Review queue <Status>{count(q.remaining, 'application')} to review</Status></h3>
    <h4><button className="link" onClick={() => open(app.id)}>{app.candidateName}</button></h4>
    <p className="meta">{[app.source, `received ${when(app.submittedAt) || app.submittedAt}`].filter(Boolean).join(' · ')}</p>
    {resumes.length > 0 ? <p>Resume: {resumes.map((d: D) => <a key={d.id} href={`/api/lodge/download/document/${d.id}`}>{d.name}</a>)}</p> : <p className="hint">No resume on file.</p>}
    <DocumentViewer documents={resumes} />
    <Answers app={app} />
    {reviews.length > 0 && <ul className="plain">{reviews.map((r: D) => <li key={r.id}>{person(w, r.by)} {said(r)} · {recent(r.at)}</li>)}</ul>}
    {q.manages ? <div className="actions">
      {next && <Form label={`Advance to ${next.name}`} compact onSubmit={x => mutate('review-decision', { application: app.id, decision: 'advance', reason: x.why })}><Field label="Why they move on (optional)" name="why" required={false} /></Form>}
      <Form label="Skip for now" compact onSubmit={() => mutate('review-decision', { application: app.id, decision: 'skip' })} />
      <details><summary>Reject</summary>
        <Form label="Reject from the queue" compact onSubmit={x => mutate('review-decision', { application: app.id, decision: 'reject', closeReason: x.why, reason: x.note, ...emailBody(x) })}>
          <Field label="Why it closes" name="why" options={reasonOptions(w, 'rejected')} />
          <Field label="Note for the history (optional)" name="note" required={false} />
          <EmailChoice w={w} />
        </Form>
      </details>
    </div> : <Form label="Record for the recruiter" compact onSubmit={x => mutate('review-recommendation', { application: app.id, recommendation: x.view, note: x.note })}>
      <Field label="Should they move forward?" name="view" options={Object.entries(VIEW).map(([value, label]) => ({ value, label }))} />
      <Field label="Note for the recruiter (optional)" name="note" required={false} />
    </Form>}
  </section>
}
