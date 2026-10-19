import type { PageProps } from './app'
import { pay } from './format'
import { person } from './names'
import { cents, Field, Form, memberOptions, Status, type D } from './shared'

const lines = (value: string) => value.split('\n').map(l => l.trim()).filter(Boolean)

/** The hiring manager's kickoff form, new or edited: purpose, criteria, proposed interviews, USD pay request, headcount, start. */
function KickoffForm({ k, w, mutate }: { k?: D; w: D; mutate: PageProps['mutate'] }) {
  const panel = memberOptions(w.members.filter((m: D) => !m.agent), 'interviewer')
  return <Form label={k ? 'Save kickoff' : 'Submit kickoff'} reset={!k} onSubmit={x => mutate('kickoff', {
    id: k?.id, title: x.title, purpose: x.purpose, mustHave: lines(x.mustHave), niceToHave: lines(x.niceToHave),
    plan: lines(x.plan).map(l => { const [name, people = ''] = l.split('|'); return { name: name.trim(), interviewers: people.split(',').map(p => p.trim()).filter(Boolean) } }),
    payRange: { currency: 'USD', min: cents(x.min), max: cents(x.max), period: x.period }, headcount: x.headcount, targetStart: x.targetStart,
  })}>
    <Field label="Role" name="title" defaultValue={k?.title} />
    <Field label="What the role is for" name="purpose" type="textarea" wide defaultValue={k?.purpose} />
    <Field label="Must-have criteria, one per line" name="mustHave" type="textarea" defaultValue={k?.mustHave.join('\n')} />
    <Field label="Nice-to-have criteria, one per line" name="niceToHave" type="textarea" required={false} defaultValue={k?.niceToHave.join('\n')} />
    <Field label="Proposed interviews, one per line as “Name | interviewer email, email”" name="plan" type="textarea" wide defaultValue={k?.plan.map((p: D) => `${p.name} | ${p.interviewers.join(', ')}`).join('\n')} hint={panel.length ? 'Interviewers: ' + panel.map(p => p.value).join(', ') : undefined} />
    <Field label="Minimum pay (USD)" name="min" type="number" defaultValue={k ? k.payRange.min / 100 : ''} />
    <Field label="Maximum pay (USD)" name="max" type="number" defaultValue={k ? k.payRange.max / 100 : ''} />
    <Field label="Pay period" name="period" defaultValue={k?.payRange.period ?? 'year'} options={[{ value: 'year', label: 'per year' }, { value: 'hour', label: 'per hour' }]} />
    <Field label="Headcount" name="headcount" type="number" defaultValue={k?.headcount ?? 1} />
    <Field label="Target start date" name="targetStart" type="date" defaultValue={k?.targetStart} />
  </Form>
}

/** Kickoffs on the Vacancies screen: managers write them; admins turn one into the job draft. */
export function Kickoffs({ w, mutate, select }: { w: D; mutate: PageProps['mutate']; select: (id: string) => void }) {
  const admin = w.actor.owner || w.actor.roles.includes('admin'), me = w.actor.email
  return <section className="card"><h2>Hiring kickoffs</h2>
    <details><summary>New kickoff</summary><KickoffForm w={w} mutate={mutate} /></details>
    <ul className="list">{w.kickoffs.map((k: D) => <li key={k.id}><article className="card">
      <h3>{k.title} {k.vacancy ? <Status tone="good">job created</Status> : <Status>waiting for a recruiter</Status>}</h3>
      <p>{person(w, k.author)} · {pay(k.payRange)} · headcount {k.headcount} · start {k.targetStart}{k.changes?.length ? ` · pay or headcount changed ${k.changes.length}×` : ''}</p>
      {k.vacancy && <button className="link" onClick={() => select(k.vacancy)}>Open the job</button>}
      {(k.author === me || admin) && <details><summary>Edit kickoff</summary><KickoffForm k={k} w={w} mutate={mutate} /></details>}
      {admin && !k.vacancy && <details><summary>Create the job draft</summary><Form label="Create job draft" onSubmit={async x => { const v = await mutate('vacancy-from-kickoff', { kickoff: k.id, title: x.title, location: x.location, department: x.department }); select(v.id) }}>
        <Field label="Job title" name="title" defaultValue={k.title} /><Field label="Location" name="location" /><Field label="Department" name="department" required={false} />
      </Form></details>}
    </article></li>)}</ul>
  </section>
}
