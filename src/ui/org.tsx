import type { PageProps } from './app'
import { Check, Field, Form, Table, type D } from './shared'
import { levelOptions } from './levels'

/** "Operations › Warehouse" from the workspace's department list. */
export function pathOf(w: D, id?: string) {
  const names: string[] = []
  for (let d = w.departments?.find((x: D) => x.id === id), hops = 0; d && hops < 7; d = w.departments.find((x: D) => x.id === d.parent), hops++) names.unshift(d.name)
  return names.join(' › ')
}
export const departmentOptions = (w: D) => (w.departments ?? []).map((d: D) => ({ value: d.id, label: pathOf(w, d.id) })).sort((x: D, y: D) => x.label.localeCompare(y.label))
export const officeOptions = (w: D) => (w.offices ?? []).map((o: D) => ({ value: o.id, label: o.name })).sort((x: D, y: D) => x.label.localeCompare(y.label))

/** REQ-004: the admin's department hierarchy, office list and each member's home department and office. */
export function Org({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const remove = (kind: string, id: string) => mutate('delete-org', { kind, id })
  const earlier = (x: D) => x.names?.length ? ` (was ${x.names.map((n: D) => n.name).join(', ')})` : ''
  return <>
    <h2>Departments and offices</h2>
    <Table heads={['Department', '']} empty="No departments yet.">{departmentOptions(w).map((d: D) => <tr key={d.value}><td>{d.label}{earlier(w.departments.find((x: D) => x.id === d.value))}</td><td><Form label="Delete" compact onSubmit={() => remove('department', d.value)} /></td></tr>)}</Table>
    <Form label="Save department" reset onSubmit={x => mutate('department', { id: x.id || undefined, name: x.name, parent: x.parent || undefined })}>
      <Field label="Department name" name="name" />
      <Field label="Inside department (blank for top level)" name="parent" required={false} options={departmentOptions(w)} />
      <Field label="Rename or move an existing department (optional)" name="id" required={false} options={departmentOptions(w)} />
    </Form>
    <Table heads={['Office', '']} empty="No offices yet.">{officeOptions(w).map((o: D) => <tr key={o.value}><td>{o.label}{earlier(w.offices.find((x: D) => x.id === o.value))}</td><td><Form label="Delete" compact onSubmit={() => remove('office', o.value)} /></td></tr>)}</Table>
    <Form label="Save office" reset onSubmit={x => mutate('office', { id: x.id || undefined, name: x.name })}>
      <Field label="Office (a US city, or Remote (US))" name="name" />
      <Field label="Rename an existing office (optional)" name="id" required={false} options={officeOptions(w)} />
    </Form>
    <Form label="Save home department and office" onSubmit={x => {
      const grantDepartments = (w.departments ?? []).filter((d: D) => x['gd-' + d.id]).map((d: D) => d.id), grantOffices = (w.offices ?? []).filter((o: D) => x['go-' + o.id]).map((o: D) => o.id)
      return mutate('member-org', { email: x.who, department: x.department || undefined, office: x.office || undefined, grantDepartments, grantOffices, grantLevels: x.grantLevel ? Object.fromEntries([...grantDepartments, ...grantOffices].map(id => [id, x.grantLevel])) : {} })
    }}>
      <Field label="Team member" name="who" options={w.members.filter((m: D) => m.active).map((m: D) => ({ value: m.email, label: m.name }))} />
      <Field label="Home department" name="department" required={false} options={departmentOptions(w)} />
      <Field label="Home office" name="office" required={false} options={officeOptions(w)} />
      {(w.departments?.length > 0 || w.offices?.length > 0) && <fieldset className="wide"><legend>A manager also runs every job in</legend>{departmentOptions(w).map((d: D) => <Check key={d.value} name={'gd-' + d.value} label={d.label} />)}{officeOptions(w).map((o: D) => <Check key={o.value} name={'go-' + o.value} label={o.label} />)}</fieldset>}
      {(w.departments?.length > 0 || w.offices?.length > 0) && <Field label="Their permission level in those (blank: Lodge’s manager rights)" name="grantLevel" required={false} options={levelOptions(w)} />}
    </Form>
  </>
}
