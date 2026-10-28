import { offerReference, offerReferenceValue, offerTemplateOptions } from './offer-templates'
import type { PageProps } from './app'
import { Field, Form, type D } from './shared'

// REQ-002: job templates kept by the owner and hiring admins. A job started
// from one copies it as it reads then; editing a template never changes a job.

const criteriaText = (criteria: D[]) => criteria.map(c => `${c.name}: ${c.description}`).join('\n')
const parseCriteria = (value: string, current: D[]) => value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [name, ...rest] = l.split(':'); return { id: current.find(c => c.name === name.trim())?.id, name: name.trim(), description: rest.join(':').trim() } })

export function Templates({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const admin = w.actor.owner || w.actor.roles.includes('admin')
  if (!admin || !w.jobTemplates?.length) return null
  return <section className="card" aria-label="Job templates">
    <h2>Job templates</h2>
    <p className="hint">A new job copies its template as it reads then; editing a template never changes jobs already started from it.</p>
    <ul>{w.jobTemplates.map((t: D) => {
      const rubric = t.rubrics.at(-1)
      return <li key={t.id}><strong>{t.name}</strong> · {t.stages.map((st: D) => st.name).join(' → ')} · rubric version {rubric.version} · {t.plan.length} interviews · {t.questions.length} questions · {t.rules.length} rules{t.approvalChain && <p>Headcount approval: {t.approvalChain.steps.map((step: D) => step.approvers.join(' and ')).join(' → ')}. New jobs need their own decisions.</p>}
        <details><summary>Edit {t.name}</summary><Form label="Save template" onSubmit={x => mutate('job-template', { id: t.id, name: x.name, offerTemplate: offerReference(x.offerTemplate) ?? null, criteria: parseCriteria(x.criteria, rubric.criteria) })}>
          <Field label="Reviewed offer template in this setup" name="offerTemplate" required={false} defaultValue={offerReferenceValue(t.offerTemplate)} options={offerTemplateOptions(w)} />
          <Field label="Template name" name="name" defaultValue={t.name} />
          <Field label={`Rubric for ${t.name} (a line each as “Name: the evidence it looks for”)`} name="criteria" type="textarea" wide defaultValue={criteriaText(rubric.criteria)} />
        </Form></details></li>
    })}</ul>
  </section>
}

/** On a job: clone it, or (admins) keep its setup as a template. */
export function JobCopies({ v, w, mutate, select }: { v: D; w: D; mutate: PageProps['mutate']; select: (id: string) => void }) {
  const admin = w.actor.owner || w.actor.roles.includes('admin')
  return <details><summary>Clone or keep as a template</summary>
    <p className="hint">A clone copies the terms and setup, never candidates, approvals or openings, and needs its own approval.</p>
    <Form label="Clone this job" compact onSubmit={async x => select((await mutate('clone-vacancy', { id: v.id, title: x.title || undefined })).id)}>
      <Field label="Title of the clone" name="title" required={false} defaultValue={v.title} />
    </Form>
    {admin && <Form label="Save as template" compact onSubmit={x => mutate('job-template', { name: x.name, fromVacancy: v.id })}>
      <Field label="Template name" name="name" />
    </Form>}
  </details>
}
