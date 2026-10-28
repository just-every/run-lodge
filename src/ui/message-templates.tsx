import { useState } from 'react'
import { Check, Field, Form, type D } from './shared'
import type { PageProps } from './app'

/** Reusable draft configuration uses the existing job settings authority. */
export function MessageTemplates({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const jobs = w.vacancies.filter((v: D) => v.manages && v.permissions.includes('contact') && v.permissions.includes('settings') && !v.imported && v.status !== 'closed')
  const [jobId, setJobId] = useState(''), [templateId, setTemplateId] = useState(''), [language, setLanguage] = useState('en')
  const job = jobs.find((v: D) => v.id === jobId) ?? jobs[0]
  const templates = (w.messageTemplates ?? []).filter((t: D) => t.vacancy === job?.id)
  const template = templates.find((t: D) => t.id === templateId)
  const version = template?.versions.filter((v: D) => v.language === language).at(-1)
  if (w.actor.agent || !jobs.length) return null
  return <section className="card" aria-label="Message template settings">
    <h2>Message templates</h2>
    <p>Review reusable drafts in each application language. Creating drafts requires a filled recipient preview; each exact message still needs approval. Nothing is sent.</p>
    <label>Template job<select value={job.id} onChange={e => { setJobId(e.target.value); setTemplateId('') }}>{jobs.map((v: D) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
    <label>Template to review<select value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">New template</option>{templates.map((t: D) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Application language<input value={language} onChange={e => setLanguage(e.target.value)} placeholder="en or es" /></label>
    <Form key={job.id + ':' + templateId + ':' + language + ':' + (template?.versions.at(-1)?.version ?? 0)} label="Save reviewed template" onSubmit={async x => {
      const saved = await mutate('message-template', { ...x, vacancy: job.id, id: template?.id, version: template?.versions.at(-1)?.version, language })
      setTemplateId(saved.id)
    }}>
      <Field label="Template name" name="name" defaultValue={template?.name} />
      <Field label="Template subject" name="subject" defaultValue={version?.subject} wide />
      <Field label="Template message" name="body" type="textarea" defaultValue={version?.body} wide />
      <p>Allowed fields: {'{candidate_name}'}, {'{job_title}'}, {'{business_name}'}, {'{candidate_phone}'}. A missing value refuses that recipient.</p>
      <Check label="I reviewed this exact text in the stated application language" name="reviewed" />
    </Form>
    {template && <details><summary>Reviewed language versions</summary>{template.versions.map((v: D) => <article key={v.version}>
      <h3>{v.language} · version {v.version}</h3><p>{v.subject}</p><p className="pre">{v.body}</p><p>Reviewed by {v.reviewedBy} at {v.reviewedAt}</p>
    </article>)}</details>}
  </section>
}
