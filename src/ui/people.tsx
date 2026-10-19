import type { PageProps } from './app'
import { call, Check, Field, Form, Status, Table, type D } from './shared'
import { Org } from './org'
import { RejectionSettings } from './rejections'
import { SourceSettings } from './sources'

const ROLES = [['admin', 'Hiring admin'], ['manager', 'Hiring manager'], ['interviewer', 'Interviewer'], ['approver', 'Approver']]

/** Every zone this browser knows, with the one already chosen (or this computer's, for a new business) among them. */
function zones(current: string) {
  const known = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  return [...new Set([current, ...known])].sort().map(z => ({ value: z, label: z.replace(/_/g, ' ') }))
}

export function BusinessForm({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const b = w.business ?? {}
  const zone = b.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  return <Form label="Save business settings" onSubmit={v => mutate('business', { ...v, retentionDays: Number(v.retentionDays) })}>
    <Field label="Business name" name="name" defaultValue={b.name} />
    <Field label="Accommodation contact (email or phone shown to applicants)" name="accommodationContact" defaultValue={b.accommodationContact} />
    <Field label="Time zone your business works in" name="timeZone" defaultValue={zone} options={zones(zone)} hint="Interviews, history and applicant receipts read in this zone, wherever they are opened." />
    <Field label="Keep candidate records for (days)" name="retentionDays" type="number" defaultValue={b.retentionDays ?? 365} />
    <Field label="Scorecards fall due (hours after the interview ends)" name="scorecardDueHours" type="number" defaultValue={b.scorecardDueHours ?? 24} />
    <Field label="Jurisdiction note (where you hire, for your legal review)" name="jurisdiction" required={false} defaultValue={b.jurisdiction} />
    <Field label="Applicant privacy notice" name="privacyNotice" type="textarea" wide defaultValue={b.notices?.at(-1)?.text} hint="Each change becomes a new version; every application records the version the applicant saw." />
  </Form>
}

export function People({ w, mutate, setNotice }: PageProps) {
  return <div className="page">
    <h1>People and settings</h1>
    {w.actor.owner && <><h2>Business</h2><BusinessForm w={w} mutate={mutate} /></>}
    <h2>Hiring team</h2>
    <Table heads={['Name', 'Email', 'Roles', 'Status', '']} empty="No members yet.">{w.members.map((m: D) => <tr key={m.email}><td>{m.name}</td><td>{m.email}</td><td>{m.owner ? 'owner (all roles)' : m.roles.join(', ')}</td><td><Status tone={m.active ? 'good' : 'neutral'}>{m.active ? 'active' : 'inactive'}</Status></td>
      <td>{w.actor.owner && !m.owner && m.active && <button onClick={async () => { await call('invite', { email: m.email }); setNotice(`Sign-in invitation accepted for ${m.email}.`) }}>Invite to sign in</button>}</td></tr>)}</Table>
    <h3>Add or change a member</h3>
    <Form label="Save member" reset onSubmit={v => mutate('member', { email: v.email, name: v.name, roles: ROLES.filter(([r]) => v['role-' + r]).map(([r]) => r), active: !v.inactive, seePrivate: v.seePrivate === true })}>
      <Field label="Email" name="email" type="email" />
      <Field label="Name" name="name" />
      <fieldset className="wide"><legend>Roles</legend>{ROLES.map(([r, label]) => <Check key={r} name={'role-' + r} label={label} />)}<Check name="inactive" label="Deactivate (keeps their history, removes access)" />{w.actor.owner && <Check name="seePrivate" label="See private: confidential jobs and private candidates" />}</fieldset>
    </Form>
    {(w.actor.owner || w.actor.roles.includes('admin')) && <Org w={w} mutate={mutate} />}
    {(w.actor.owner || w.actor.roles.includes('admin')) && <RejectionSettings w={w} mutate={mutate} />}
    {(w.actor.owner || w.actor.roles.includes('admin')) && <SourceSettings w={w} mutate={mutate} />}
    <p className="hint">Interviewers see only the applications they are assigned to, without contact details. Restricted documents and voluntary monitoring answers stay with the owner and hiring admins.</p>
  </div>
}
