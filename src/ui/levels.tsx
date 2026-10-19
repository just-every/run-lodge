import type { PageProps } from './app'
import { Check, Field, Form, Table, type D } from './shared'

// OPS-004: named permission levels. Admins define them here and assign them on
// a job (its team panel) or with a department or office grant (Org).

export const PERMISSION_LABELS: [string, string][] = [
  ['contact', 'See contact details'], ['scorecards', 'Read and release scorecards'], ['move', 'Move stages'], ['reject', 'Reject'],
  ['offers', 'Create and see offers'], ['approve', 'Approve'], ['private', 'See private candidates'], ['export', 'Export'], ['settings', 'Edit job settings'],
]
export const levelOptions = (w: D) => (w.permissionLevels ?? []).map((l: D) => ({ value: l.id, label: l.name }))

export function Levels({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const levels = (w.permissionLevels ?? []) as D[]
  const label = (p: string) => PERMISSION_LABELS.find(([k]) => k === p)?.[1] ?? p
  return <section aria-label="Permission levels">
    <h2>Permission levels</h2>
    <p className="hint">A level assigned to someone on a job, to a team role on a job, or with a department or office grant decides what they may do there, through every screen, export and agent read. Monitoring and accommodation answers stay with the owner and hiring admins.</p>
    <Table heads={['Level', 'Permissions', '']} empty="No levels.">{levels.map(l => <tr key={l.id}><td>{l.name}</td><td>{l.permissions.length ? l.permissions.map(label).join(', ') : 'None'}</td>
      <td>{!l.seeded && <Form label="Delete" compact onSubmit={() => mutate('delete-permission-level', { id: l.id })} />}</td></tr>)}</Table>
    <Form label="Save level" reset onSubmit={x => mutate('permission-level', { id: x.id || undefined, name: x.name, permissions: PERMISSION_LABELS.map(([k]) => k).filter(k => x['p-' + k]) })}>
      <Field label="Level name" name="name" />
      <Field label="Replace an existing level (optional)" name="id" required={false} options={levels.filter(l => !l.seeded).map(l => ({ value: l.id, label: l.name }))} />
      <fieldset className="wide"><legend>Permissions</legend>{PERMISSION_LABELS.map(([k, text]) => <Check key={k} name={'p-' + k} label={text} />)}</fieldset>
    </Form>
  </section>
}

/** The levels on one job: per member (who then runs it) and per REQ-003 team role. */
export function JobLevels({ v, w, mutate }: { v: D; w: D; mutate: PageProps['mutate'] }) {
  const roles: [string, string][] = [['recruiters', 'Recruiters'], ['coordinators', 'Coordinators'], ['hiringManagers', 'Hiring managers'], ['sourcers', 'Sourcers'], ['interviewers', 'Interview pool']]
  const on = v.levels ?? {}, name = (id: string) => (w.permissionLevels ?? []).find((l: D) => l.id === id)?.name ?? id
  const members = Object.entries(on.members ?? {}) as [string, string][]
  return <details><summary>Permission levels on this job</summary>
    {members.length > 0 && <ul>{members.map(([who, id]) => <li key={who}>{who}: {name(id)}</li>)}</ul>}
    <Form label="Save levels" onSubmit={x => {
      const next = { ...(on.members ?? {}) } as D
      if (x.member) { if (x.memberLevel) next[x.member] = x.memberLevel; else delete next[x.member] }
      return mutate('job-levels', { id: v.id, members: next, roles: Object.fromEntries(roles.map(([k]) => [k, x['r-' + k]]).filter(([, l]) => l)) })
    }}>
      <Field label="Member" name="member" required={false} options={w.members.filter((m: D) => m.active && m.roles?.includes('manager')).map((m: D) => ({ value: m.email, label: m.name }))} />
      <Field label="Their level here (blank removes it)" name="memberLevel" required={false} options={levelOptions(w)} />
      {roles.map(([k, text]) => <Field key={k} label={`${text}’ level`} name={'r-' + k} required={false} defaultValue={on.roles?.[k] ?? ''} options={levelOptions(w)} />)}
    </Form>
  </details>
}
