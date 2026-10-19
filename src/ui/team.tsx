import type { PageProps } from './app'
import { people } from './names'
import { Field, Form, type D } from './shared'

// REQ-003: a job's hiring team by role. Everyone who runs the job sees it; the
// owner and hiring admins change it, and the change reaches every door at once.

const ROLES: [key: string, heading: string, label: string][] = [
  ['recruiters', 'Recruiters', 'Recruiters (comma-separated)'],
  ['coordinators', 'Coordinators', 'Coordinators (comma-separated)'],
  ['hiringManagers', 'More hiring managers', 'More hiring managers (comma-separated)'],
  ['sourcers', 'Sourcers', 'Sourcers (comma-separated)'],
  ['interviewers', 'Interview pool', 'Interview pool (comma-separated)'],
]

const split = (value: string) => (value ?? '').split(',').map(e => e.trim()).filter(Boolean)

export function Team({ v, w, mutate }: { v: D; w: D; mutate: PageProps['mutate'] }) {
  const admin = w.actor.owner || w.actor.roles.includes('admin')
  const team = v.team ?? {}
  return <section aria-label="Hiring team">
    <h3>Hiring team</h3>
    <dl className="terms"><dt>Hiring manager</dt><dd>{people(w, [v.manager])}</dd>
      {ROLES.filter(([key]) => team[key]?.length).flatMap(([key, heading]) => [<dt key={key}>{heading}</dt>, <dd key={key + '-who'}>{people(w, team[key])}</dd>])}
    </dl>
    {admin && v.status !== 'closed' && <details><summary>Change the hiring team</summary>
      <p className="hint">Recruiters, coordinators and hiring managers run this job; approving its terms and offers stays with approvers. Sourcers see the job and add candidates to it. Someone you take off loses access at once, and their open follow-ups on this job go to whoever replaces them, else the first recruiter, else the hiring manager.</p>
      <Form label="Save hiring team" onSubmit={x => mutate('hiring-team', { id: v.id, ...Object.fromEntries(ROLES.map(([key]) => [key, split(x[key])])) })}>
        {ROLES.map(([key, , label]) => <Field key={key} label={label} name={key} required={false} defaultValue={(team[key] ?? []).join(', ')} />)}
      </Form></details>}
  </section>
}
