import type { PageProps } from './app'
import { Check, Field, Form, memberOptions, type D } from './shared'

export const offerReference = (value: string) => { if (!value) return undefined; const [id, version] = value.split('@'); return { id, version: Number(version) } }
export const offerReferenceValue = (ref?: D) => ref ? `${ref.id}@${ref.version}` : ''
export const offerTemplateOptions = (w: D) => (w.offerTemplates ?? []).flatMap((t: D) => t.versions.map((v: D) => ({ value: `${t.id}@${v.version}`, label: `${v.name ?? t.name} · version ${v.version}` })))

function TemplateForm({ w, mutate, template }: Pick<PageProps, 'w' | 'mutate'> & { template?: D }) {
  const latest = template?.versions.at(-1)
  return <Form label={template ? 'Save reviewed version' : 'Create reviewed offer template'} reset={!template} onSubmit={x => mutate('offer-template', { id: template?.id, name: x.name, body: x.body, contingencies: x.contingencies, normalApprover: x.normalApprover, exceptionApprover: x.exceptionApprover, reviewed: x.reviewed === true })}>
    <Field label="Offer template name" name="name" defaultValue={template?.name} />
    <Field label="Document template" name="body" type="textarea" wide defaultValue={latest?.body} hint="Merge fields: {{candidateName}}, {{title}}, {{location}}, {{employmentType}}, {{pay}}, {{startDate}}, {{bonus}}, {{equity}}, {{contingencies}}, {{terms}}" />
    <Field label="Employer-reviewed contingencies" name="contingencies" type="textarea" wide defaultValue={latest?.contingencies} required={false} />
    <Field label="Normal offer approver" name="normalApprover" defaultValue={latest?.normalApprover} options={memberOptions(w.members, 'approver')} />
    <Field label="Compensation exception approver" name="exceptionApprover" defaultValue={latest?.exceptionApprover} options={memberOptions(w.members, 'approver')} />
    <Check name="reviewed" label="I confirm the employer has reviewed this template and its contingencies" />
  </Form>
}

export function OfferTemplates({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  if (!w.actor.owner && !w.actor.roles.includes('admin')) return null
  return <section className="card" aria-label="Offer templates">
    <h2>Offer templates</h2>
    <p className="hint">Each review saves a version. Existing offers and job defaults keep the version chosen for them. Lodge prepares documents; it sends nothing.</p>
    {(w.offerTemplates ?? []).map((t: D) => <details key={t.id}><summary>{t.name} · version {t.versions.at(-1).version}</summary><TemplateForm w={w} mutate={mutate} template={t} /></details>)}
    <details><summary>New offer template</summary><TemplateForm w={w} mutate={mutate} /></details>
  </section>
}

export function JobOfferTemplate({ v, w, mutate }: Pick<PageProps, 'w' | 'mutate'> & { v: D }) {
  if (!w.offerTemplates?.length) return null
  return <details><summary>Offer document default</summary><Form label="Save offer document default" compact onSubmit={x => mutate('job-offer-template', { id: v.id, offerTemplate: offerReference(x.offerTemplate) ?? null })}>
    <Field label="Reviewed offer template for this job" name="offerTemplate" required={false} defaultValue={offerReferenceValue(v.offerTemplate)} options={offerTemplateOptions(w)} />
  </Form></details>
}
