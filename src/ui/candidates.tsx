import type { PageProps } from './app'
import { Check, Field, fileFrom, Form, readFile, Table, type D } from './shared'

export function Candidates({ w, mutate, go }: PageProps) {
  const admin = w.actor.owner || w.actor.roles.includes('admin')
  const openVacancies = w.vacancies.filter((v: D) => v.manages && v.status === 'open')
  const name = (id: string) => w.candidates.find((c: D) => c.id === id)?.name ?? id
  return <div className="page">
    <h1>Candidates</h1>
    <details><summary>Add a candidate</summary>
      <Form label="Add candidate" reset onSubmit={async (x, form) => {
        const file = fileFrom(form, 'resume')
        await mutate('candidate', { name: x.name, email: x.email, phone: x.phone, location: x.location, headline: x.headline, skills: x.skills, source: x.source, consentBasis: x.consentBasis, talentPool: x.talentPool, consentNote: x.consentNote, vacancy: x.vacancy || undefined, resume: file ? await readFile(file) : undefined })
      }}>
        <Field label="Name" name="name" /><Field label="Email" name="email" type="email" required={false} />
        <Field label="Phone" name="phone" required={false} /><Field label="Location" name="location" required={false} />
        <Field label="Headline" name="headline" required={false} /><Field label="Source (where they came from)" name="source" />
        <Field label="Basis for keeping their details" name="consentBasis" options={[{ value: 'application', label: 'They applied' }, { value: 'referral', label: 'Referral with their agreement' }, { value: 'talent-pool', label: 'They asked to join the talent pool' }, { value: 'manual', label: 'Other (explain below)' }]} />
        <Field label="Note about consent" name="consentNote" required={false} />
        <Field label="Apply to vacancy" name="vacancy" required={false} options={openVacancies.map((v: D) => ({ value: v.id, label: v.title }))} />
        <label>Resume<input type="file" name="resume" /></label>
        <Field label="Skills and experience summary" name="skills" type="textarea" wide required={false} />
        <Check name="talentPool" label="They agreed to be contacted about other roles" />
      </Form>
    </details>
    {admin && w.duplicates.length > 0 && <><h2>Possible duplicates</h2><p className="hint">Lodge never merges people automatically. Decide each pair.</p>
      {w.duplicates.map((d: D) => <article key={d.first + d.second} className="card"><h4>{name(d.first)} and {name(d.second)}</h4><p>{d.reasons.join(', ')}</p>
        <Form label="Record decision" compact onSubmit={x => mutate('review-duplicate', { keep: d.first, other: d.second, decision: x.decision, reason: x.reason })}>
          <Field label="Decision" name="decision" options={[{ value: 'distinct', label: 'Different people' }, { value: 'merge', label: `Same person: merge into ${name(d.first)}` }]} />
          <Field label="Reason" name="reason" />
        </Form></article>)}</>}
    {openVacancies.length > 0 && w.candidates.length > 0 && <details><summary>Link a candidate to a vacancy</summary>
      <Form label="Link" reset onSubmit={x => mutate('apply', { candidate: x.candidate, vacancy: x.vacancy, source: 'Linked by ' + w.actor.email })}>
        <Field label="Candidate" name="candidate" options={w.candidates.map((c: D) => ({ value: c.id, label: c.name }))} />
        <Field label="Vacancy" name="vacancy" options={openVacancies.map((v: D) => ({ value: v.id, label: v.title }))} />
      </Form>
    </details>}
    <Table heads={['Name', 'Contact', 'Source', 'Applications']} empty="No candidates yet.">{w.candidates.map((c: D) => {
      const apps = w.applications.filter((a: D) => a.candidate === c.id)
      return <tr key={c.id}><td><strong>{c.name}</strong>{c.headline && <small>{c.headline}</small>}</td><td>{[c.email, c.phone].filter(Boolean).join(' · ')}</td><td>{c.source}</td>
        <td><span>{apps.map((a: D, i: number) => <span key={a.id}>{i > 0 && ' · '}<button className="link" onClick={() => go('Applications', { app: a.id, job: a.vacancy })}>{w.vacancies.find((v: D) => v.id === a.vacancy)?.title ?? 'vacancy'}</button></span>)}</span></td></tr>
    })}</Table>
  </div>
}
