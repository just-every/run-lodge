import { useEffect, useState } from 'react'
import type { PageProps } from './app'
import { when } from './format'
import { person } from './names'
import { call, Field, Form, Table, type D } from './shared'

// CRM-008: the source list (admins), each application's source and credit, and source of hire.

const TYPES: [string, string][] = [['job-board', 'Job board'], ['careers-site', 'Careers site'], ['referral', 'Referral'], ['agency', 'Agency'], ['sourced', 'Sourced'], ['internal', 'Internal'], ['event', 'Event'], ['other', 'Other']]
const TYPE = Object.fromEntries(TYPES)
const KIND: D = { employee: 'Referring employee', agency: 'Agency', sourcer: 'Sourcer', recruiter: 'Recruiter' }
const texts = (v: string) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean)
const credited = (w: D, c: D) => `${KIND[c.kind]}: ${c.kind === 'sourcer' || c.kind === 'recruiter' ? person(w, c.who) : c.who}`

/** Admins keep the source list and map free-text sources onto it, choose the merge rule, and read source of hire. */
export function SourceSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const [report, setReport] = useState<D>()
  useEffect(() => { call('reports/sources').then(setReport).catch(() => setReport(undefined)) }, [w])
  const live = w.sources.filter((x: D) => !x.retired)
  return <section aria-label="Sources and hire credit">
    <h2>Sources and hire credit</h2>
    <Table heads={['Source', 'Type', 'Mapped texts', '']} empty="No sources yet.">{live.map((x: D) => <tr key={x.id}><td>{x.name}{x.automatic && <small> · added by Lodge</small>}</td><td>{TYPE[x.type]}</td><td>{x.aliases.join(', ')}</td>
      <td><Form label="Retire" compact onSubmit={() => mutate('source', { ...x, retired: true })} /></td></tr>)}</Table>
    <Form label="Save source" reset onSubmit={x => { const current = live.find((s: D) => s.name.toLowerCase() === String(x.name).trim().toLowerCase()); return mutate('source', { id: current?.id, name: x.name, type: x.type, aliases: [...(current?.aliases ?? []), ...texts(x.aliases)] }) }}>
      <Field label="Source name" name="name" hint="An existing name updates that source." />
      <Field label="Source type" name="type" options={TYPES.map(([value, label]) => ({ value, label }))} />
      <Field label="Map free-text sources (comma separated)" name="aliases" required={false} />
    </Form>
    <Form label="Save attribution rule" compact onSubmit={x => mutate('source-settings', { onMerge: x.onMerge })}>
      <Field label="When duplicates merge, credit a hire to" name="onMerge" defaultValue={w.sourceMergeRule} options={[{ value: 'own', label: 'Each application’s own source' }, { value: 'first-touch', label: 'The person’s first touch' }]} />
    </Form>
    {report && <><h3>Source of hire</h3>
      <Table heads={['Source', 'Type', 'Applications', 'Hires']} empty="No applications yet.">{report.bySource.map((r: D) => <tr key={r.source ?? r.name}><td>{r.name}{!r.source && <small> · not on the list</small>}</td><td>{r.type ? TYPE[r.type] : ''}</td><td>{r.applications}</td><td>{r.hires}</td></tr>)}</Table>
      <h3>Hires by credit</h3>
      <Table heads={['Credited', 'Hires']} empty="No credited hires yet.">{report.byCredit.map((r: D) => <tr key={r.kind + r.who}><td>{credited(w, r)}</td><td>{r.hires}</td></tr>)}</Table></>}
  </section>
}

/** On an application: its source on the list and who is credited, with the history; the people who run the job change the credit. */
export function SourceCredit({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  return <section className="source-credit" aria-label="Source and credit">
    <p className="meta">Source: {app.sourceEntry ? `${app.sourceEntry.name} (${TYPE[app.sourceEntry.type]})` : `${app.source || 'Not recorded'} (not on the source list)`} · {app.credit ? `Credited to ${credited(w, app.credit)}` : 'No one credited yet'}</p>
    {app.creditHistory?.length > 0 && <details><summary>Credit history</summary><ul className="plain">{[...app.creditHistory, app.credit].map((c: D, i: number) => <li key={i}>{credited(w, c)} · {when(c.at)} · {person(w, c.by)}{c.reason ? ` · “${c.reason}”` : c.automatic ? ' · set automatically' : ''}</li>)}</ul></details>}
    {app.manages && <details><summary>Change credit</summary><Form label="Save credit" compact reset onSubmit={x => mutate('source-credit', { application: app.id, kind: x.kind, who: x.who, reason: x.why })}>
      <Field label="Credited as" name="kind" options={Object.entries(KIND).map(([value, label]) => ({ value, label: label as string }))} />
      <Field label="Credited to (email, or the agency’s name)" name="who" />
      <Field label="Why the change" name="why" />
    </Form></details>}
  </section>
}
