import { ResumeIntake } from './resumes/intake'
import type { PageProps } from './app'
import { since, slot } from './format'
import { count, person } from './names'
import { Check, Field, fileFrom, Form, readFile, Status, Table, type D } from './shared'
import { closedLabel, lastMove, nextInterview, openProposals, proposalApplication, stageName } from './pipeline/facts'

/** What happens next on an application, from its records: a decision waiting, an offer, an interview, a scorecard. */
function nextStep(w: D, app: D) {
  if (app.status !== 'active') return '—'
  if (openProposals(w).some((p: D) => proposalApplication(p) === app.id)) return 'Your decision on the agent’s options'
  const offer = w.offers.find((o: D) => o.application === app.id && o.status === 'draft')
  if (offer) return offer.approvedNow ? 'Record the offer’s outcome' : offer.approval?.status === 'pending' ? `Offer awaiting ${person(w, offer.approval.approver)}` : 'Request offer approval'
  const iv = nextInterview(w, app)
  if (iv?.status === 'scheduled') return `${iv.title.split(':')[0]} · ${slot(iv.start)}`
  if (iv) return `${iv.title.split(':')[0]} · times proposed`
  const missing = w.coordination.missingScorecards.filter((m: D) => m.application === app.id).length
  if (missing) return `Chase ${count(missing, 'scorecard')}`
  return app.panel?.length && app.panel.every((p: D) => p.submitted) ? 'Decide: advance or reject' : 'Screen and score'
}

export function Candidates({ w, mutate, go }: PageProps) {
  const admin = w.actor.owner || w.actor.roles.includes('admin')
  const openVacancies = w.vacancies.filter((v: D) => (v.manages || v.sources) && v.status === 'open')
  const name = (id: string) => w.candidates.find((c: D) => c.id === id)?.name ?? id
  return <div className="page">
    <h1>Candidates</h1>
    <ResumeIntake w={w} mutate={mutate} />
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
    {admin && w.candidates.length > 0 && <details><summary>Private candidates</summary>
      <p className="hint">A private candidate (for example an internal executive) is seen only by the people you name, the owner and holders of “see private”, in every list, search, export and agent read.</p>
      <Form label="Save privacy" reset onSubmit={x => mutate('candidate-privacy', { id: x.candidate, private: x.private === true, namedPeople: x.namedPeople.split(',').map((e: string) => e.trim()).filter(Boolean) })}>
        <Field label="Candidate" name="candidate" options={w.candidates.map((c: D) => ({ value: c.id, label: c.name + (c.private ? ' (private)' : '') }))} />
        <Field label="Named people (emails, comma-separated)" name="namedPeople" required={false} />
        <Check name="private" label="Private" />
      </Form>
    </details>}
    {openVacancies.length > 0 && w.candidates.length > 0 && <details><summary>Link a candidate to a vacancy</summary>
      <Form label="Link" reset onSubmit={x => mutate('apply', { candidate: x.candidate, vacancy: x.vacancy, source: 'Linked by ' + w.actor.email })}>
        <Field label="Candidate" name="candidate" options={w.candidates.map((c: D) => ({ value: c.id, label: c.name }))} />
        <Field label="Vacancy" name="vacancy" options={openVacancies.map((v: D) => ({ value: v.id, label: v.title }))} />
      </Form>
    </details>}
    <Table heads={['Name', 'Stage', 'Scorecards', 'Next step', 'Source', 'Applied for']} empty="No candidates yet.">{w.candidates.map((c: D) => {
      const apps = w.applications.filter((a: D) => a.candidate === c.id).sort((x: D, y: D) => (x.status === 'active' ? 0 : 1) - (y.status === 'active' ? 0 : 1) || lastMove(y).localeCompare(lastMove(x)))
      const a = apps[0], v = a && w.vacancies.find((x: D) => x.id === a.vacancy), done = a?.panel?.filter((p: D) => p.submitted).length ?? 0
      return <tr key={c.id}><td><strong>{c.name}</strong><small>{[c.headline, c.email].filter(Boolean).join(' · ')}</small></td>
        <td>{a ? <span className="stage-cell"><Status tone={a.status === 'active' ? 'good' : 'neutral'}>{a.status === 'active' ? stageName(v, a.stage) : closedLabel(a)}</Status><small>{since(lastMove(a))}</small></span> : <small>No application</small>}</td>
        <td>{a?.panel?.length ? <span className="bar"><span className="track"><i style={{ width: `${done / a.panel.length * 100}%` }} /></span>{done} of {a.panel.length}</span> : <small>None yet</small>}</td>
        <td>{a ? nextStep(w, a) : ''}</td><td>{c.source}</td>
        <td><span>{apps.map((x: D, i: number) => <span key={x.id}>{i > 0 && ' · '}<button className="link" onClick={() => go('Applications', { app: x.id, job: x.vacancy })}>{w.vacancies.find((y: D) => y.id === x.vacancy)?.title ?? 'vacancy'}</button></span>)}</span></td></tr>
    })}</Table>
  </div>
}
