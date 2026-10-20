import type { PageProps } from '../app'
import { Field, Form, readFile, type D, type Mutate } from '../shared'
import { decodeResume } from './decode'
import { ResumeReview } from './review'

function Upload({ multiple, jobs, mutate }: { multiple: boolean; jobs: D[]; mutate: Mutate }) {
 return <Form label={multiple ? 'Upload resume batch' : 'Upload one resume'} onSubmit={async (x, form) => {
  const files = (form.elements.namedItem('files') as HTMLInputElement).files
  if (!files?.length) throw new Error('Choose at least one resume')
  const errors: string[] = []
  for (const file of Array.from(files)) {
   try {
    if (file.size > 1000000) throw new Error('Files may be at most 1 MB')
    const row = await mutate('resume-upload', { file: await readFile(file), vacancy: x.vacancy || undefined })
    if (row.status === 'uploaded') await decodeResume(row, mutate)
   } catch (error) { errors.push(file.name + ': ' + (error as Error).message) }
  }
  if (errors.length) throw new Error(errors.join('; ') + '. Uploaded originals remain in the review list.')
 }}>
  <Field label="Apply reviewed resumes to vacancy" name="vacancy" required={false} options={jobs.map(v => ({ value: v.id, label: v.title }))} />
  <label>{multiple ? 'Resume batch (PDF, DOCX or text)' : 'One resume (PDF, DOCX or text)'}<input name="files" type="file" required multiple={multiple} accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" /></label>
 </Form>
}

export function ResumeIntake({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
 const admin = w.actor.owner || w.actor.roles.includes('admin')
 const jobs = w.vacancies.filter((v: D) => v.manages && v.permissions.includes('contact') && v.status === 'open')
 if (!admin && !jobs.length) return null
 const rows: D[] = w.resumeIntakes ?? [], pending = rows.filter(r => r.status !== 'committed')
 return <details><summary>Resume intake: individual or bulk</summary>
  <section aria-label="Resume intake">
   <p>Upload PDF, DOCX or UTF-8 text resumes, up to 1 MB each. Originals are saved before decoding, including unreadable files. Review and confirm each person before creating candidates and applications. Batches keep each file separately.</p>
   <p>Uncommitted originals become unavailable at their deadline and are deleted by hourly maintenance. New uploads are kept for {w.resumeIntakePolicy.retentionDays} days.</p>
   {admin && <>
    <Form label="Save pending resume retention" onSubmit={x => mutate('resume-intake-settings', x)}>
     <Field label="Keep new uncommitted resumes (days)" name="retentionDays" type="number" defaultValue={w.resumeIntakePolicy.retentionDays} hint="Applies to new uploads. Each saved resume keeps its displayed deadline." />
    </Form>
    <p>Pending resumes whose uploader no longer has permission: {w.orphanedResumeIntakeCount}. Only their count is available; their contents remain private.</p>
    {w.orphanedResumeIntakeCount > 0 && <Form label="Discard inaccessible pending resumes" onSubmit={() => mutate('resume-discard-orphaned', {})} />}
   </>}
   <h2>Individual resume</h2><Upload multiple={false} jobs={jobs} mutate={mutate} />
   <h2>Bulk resume importer</h2><Upload multiple jobs={jobs} mutate={mutate} />
   {!admin && <p className="hint">Choose one of the vacancies you run. Only an owner or hiring admin can add candidates without a vacancy.</p>}
   <h2>Saved resumes awaiting review ({pending.length})</h2>
   {pending.map(row => <ResumeReview key={row.id} row={row} admin={admin} mutate={mutate} />)}
   {rows.some(r => r.status === 'committed') && <details><summary>Committed resumes</summary>{rows.filter(r => r.status === 'committed').map(row => {
    const doc = w.documents.find((d: D) => d.id === row.id), candidate = w.candidates.find((c: D) => c.id === row.candidate)
    const facts = w.resumeExtractions.find((r: D) => r.document === row.id)
    return <article key={row.id} className="card"><p>Committed: {doc?.name} · {candidate?.name} · <a href={'/api/lodge/download/resume-intake/' + row.id}>Download original: {doc?.name}</a></p>
     {facts && <details><summary>Reviewed resume facts</summary>{['employment', 'education', 'skills'].map(key => <p key={key} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{key}: {facts.corrections[key] || 'Not provided'}</p>)}</details>}
    </article>
   })}</details>}
  </section>
 </details>
}
