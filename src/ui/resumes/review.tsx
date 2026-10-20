import { Check, Field, Form, type D, type Mutate } from '../shared'
import { extractedValues, type ResumeExtraction } from '../../lodge/resumes/extraction'
import { decodeResume } from './decode'

const labels: Record<string, string> = { name: 'Name', email: 'Email', phone: 'Phone', employment: 'Employment', education: 'Education', skills: 'Skills' }

export function ResumeReview({ row, admin, mutate }: { row: D; admin: boolean; mutate: Mutate }) {
 const initial = row.review?.fields ?? (row.extraction ? extractedValues(row.extraction as ResumeExtraction) : {})
 return <article className="card" aria-label={'Resume review: ' + row.name}>
  <h3>{row.name}</h3>
  <p>Uncommitted original expires: <time dateTime={row.expiresAt}>{new Date(row.expiresAt).toLocaleString()}</time></p>
  <p><a href={'/api/lodge/download/resume-intake/' + row.id}>Download original: {row.name}</a> · {row.size} bytes</p>
  {row.status === 'uploaded' ? <><p>Original saved. Decode it to start reviewing.</p><Form label="Decode saved original" onSubmit={() => decodeResume(row, mutate)} /></> : <>
   {row.parseError && <p role="alert">{row.parseError}. The original is saved. Enter the missing details below to keep this file with a candidate.</p>}
   {row.extraction && <details><summary>Extracted fields and source passages</summary>
    <p className="hint">Literal text extracted locally. Review against the original. Uncertain or missing fields need your confirmation. No protected-trait inference or suitability score.</p>
    {Object.entries(labels).map(([key, label]) => {
     const found = row.extraction[key], facts: D[] = Array.isArray(found) ? found : [found]
     return <section key={key}><h4>{label}</h4>{facts.length ? facts.map((f, i) => <div key={i}><p>{f.value || 'Not found'} {f.uncertain && <strong>· Uncertain: {f.reason}</strong>}</p>{f.passage && <blockquote style={{ overflowWrap: 'anywhere' }}>{f.passage}</blockquote>}</div>) : <p>Not found · Uncertain: review the original.</p>}</section>
    })}
   </details>}
   {row.sourceText && <details><summary>Decoded source text</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.sourceText}</p></details>}
   <Form key={row.review?.token ?? row.parsedAt} label="Review corrected details" onSubmit={x => mutate('resume-preview', { id: row.id, ...x })}>
    <Field label="Candidate name" name="name" defaultValue={initial.name} />
    <Field label="Candidate email" name="email" type="email" defaultValue={initial.email} required={false} />
    <Field label="Candidate phone" name="phone" defaultValue={initial.phone} required={false} />
    <Field label="Employment" name="employment" type="textarea" wide defaultValue={initial.employment} required={false} />
    <Field label="Education" name="education" type="textarea" wide defaultValue={initial.education} required={false} />
    <Field label="Skills" name="skills" type="textarea" wide defaultValue={initial.skills} required={false} />
    <Field label="Source (where they came from)" name="source" defaultValue={initial.source ?? ''} />
    <Field label="Basis for keeping their details" name="consentBasis" defaultValue={initial.consentBasis ?? ''} options={[{ value: 'application', label: 'They applied' }, { value: 'referral', label: 'Referral with their agreement' }, { value: 'talent-pool', label: 'They asked to join the talent pool' }, { value: 'manual', label: 'Other (explain below)' }]} />
    <Field label="Note about consent" name="consentNote" defaultValue={initial.consentNote} required={false} />
    <Field label="Keep until (business retention if blank)" name="retainUntil" type="date" defaultValue={initial.retainUntil} required={false} />
    <Check name="talentPool" label="They agreed to be contacted about other roles" defaultChecked={initial.talentPool} />
   </Form>
   {row.review && <section aria-label={'Confirm resume: ' + row.name}>
    <h4>Confirm the reviewed details</h4>
    <dl>{Object.entries(labels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.review.fields[key] || 'Not provided'}</dd></div>)}</dl>
    <p className="hint">Changing a field above requires a new review. Choosing an existing person attaches this original and keeps their current details. An existing active application is reused. Different-people decisions require an owner or hiring admin, as in duplicate review.</p>
    {!row.review.duplicates.length && <p>No matching email, name or phone in candidates you can contact.</p>}
    <Form key={row.review.token} label="Commit reviewed resume" onSubmit={x => mutate('resume-commit', { id: row.id, token: row.review.token, confirmed: x.confirmed, duplicates: row.review.duplicates.map((d: D, i: number) => ({ candidate: d.candidate, decision: x['decision-' + i], reason: x['reason-' + i] })) })}>
     {row.review.duplicates.map((d: D, i: number) => <fieldset key={d.candidate} className="wide"><legend>Possible duplicate: {d.name} · {d.reasons.join(', ')}</legend>
      <Field label={'Decision for ' + d.name} name={'decision-' + i} options={[{ value: 'existing', label: 'Same person: use existing candidate' }, ...(admin ? [{ value: 'distinct', label: 'Different people: create a separate candidate' }] : [])]} />
      <Field label={'Reason for ' + d.name} name={'reason-' + i} />
     </fieldset>)}
     <Check name="confirmed" label="I checked the original, corrected the details and decided every duplicate suggestion" />
    </Form>
   </section>}
  </>}
 </article>
}
