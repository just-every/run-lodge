import type { PageProps } from './app'
import { Check, Field, Form, Status, type D } from './shared'
import { EMPLOYMENT_TYPES } from '../lodge/core/labels'

const addressFields = [['streetAddress', 'Street address'], ['addressLocality', 'City'], ['addressRegion', 'State or region'], ['postalCode', 'Postal code'], ['addressCountry', 'Country code']] as const

/** Structured publication is configured in Settings, alongside other reviewed disclosures. */
export function JobPostingSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const jobs: D[] = w.vacancies.filter((v: D) => v.jobPostingSettings?.length)
  if (!jobs.length) return null
  return <section className="card" aria-label="Structured job listing settings" id="job-posting-settings">
    <h2>Structured job listings</h2>
    <p>Choose a live careers post and review its exact content and complete metadata. Incomplete, changed or expired reviews withhold structured publication. Local markup does not establish live Google admission or indexing.</p>
    {jobs.map(v => v.jobPostingSettings.map((setting: D) => {
      const p = v.posts.find((post: D) => post.id === setting.post), m = setting.review?.metadata ?? {}
      return <details key={p.id} id={'job-posting-' + p.id}>
        <summary>Review listing “{p.title}”</summary>
        <p><Status tone={setting.published ? 'good' : 'neutral'}>{setting.published ? 'Structured listing published' : setting.review?.enabled ? 'Structured listing withheld' : 'Structured listing off'}</Status></p>
        <p><strong>{p.title}</strong> · {EMPLOYMENT_TYPES[v.employmentType]}<br />{p.description}</p>
        <p style={{ whiteSpace: 'pre-line' }}>{setting.pay}</p>
        {setting.eligible && <p><a href={'/jobs/' + p.slug}>Preview public post</a></p>}
        {setting.review && <p>Last review by {setting.review.reviewedBy} at {setting.review.reviewedAt}.</p>}
        {setting.eligible ? <Form key={setting.source + (setting.review?.reviewedAt ?? '')} label="Review and publish structured listing" onSubmit={x => mutate('review-job-posting', {
          vacancy: v.id, post: p.id, source: setting.source, reviewed: x.reviewed,
          metadata: { employerName: x.employerName, employerUrl: x.employerUrl, datePosted: x.datePosted, validThrough: x.validThrough, employmentType: x.employmentType,
            applicantCountries: String(x.applicantCountries ?? '').split(',').map(s => s.trim()).filter(Boolean),
            addresses: p.locations.map((officeId: string) => Object.fromEntries([['officeId', officeId], ...addressFields.map(([field]) => [field, x[officeId + '-' + field]])])),
          },
        })}>
          <Field label="Employer name" name="employerName" defaultValue={m.employerName} hint={'Must match the visible business name: ' + w.business.name} />
          <Field label="Employer website" name="employerUrl" type="url" defaultValue={m.employerUrl} />
          <Field label="Original posting date" name="datePosted" type="date" defaultValue={m.datePosted} />
          <Field label="Listing expiry date" name="validThrough" type="date" defaultValue={m.validThrough} />
          <Field label="Reviewed employment type" name="employmentType" defaultValue={m.employmentType} options={Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => ({ value, label }))} />
          {v.workMode === 'remote' && <Field label="Remote applicant country codes" name="applicantCountries" defaultValue={m.applicantCountries?.join(', ')} hint="Explicit two-letter country codes, separated by commas." />}
          {p.locations.map((id: string) => {
            const address = m.addresses?.find((x: D) => x.officeId === id) ?? {}
            return <fieldset className="wide" key={id}><legend>{w.offices.find((o: D) => o.id === id)?.name ?? id}</legend>
              {addressFields.map(([field, label]) => <Field key={field} label={label} name={id + '-' + field} defaultValue={address[field]} />)}
            </fieldset>
          })}
          <Check name="reviewed" label="The employer reviewed the exact post, approved pay, employment type, addresses and dates" />
        </Form> : <p>Publish an approved public careers post with current pay and complete wording before reviewing structured metadata.</p>}
        {setting.review?.enabled && <Form compact label="Turn off structured listing" onSubmit={() => mutate('review-job-posting', { vacancy: v.id, post: p.id, source: setting.source, enabled: false })} />}
      </details>
    }))}
  </section>
}
