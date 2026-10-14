import type { PageProps } from './app'
import { person, phrase, recordName } from './names'
import { Table, when, type D } from './shared'

export function Audit({ w }: PageProps) {
  return <>
    <h1>Audit history</h1>
    <Table heads={['When', 'Who', 'Action', 'Record']} empty="Nothing recorded yet.">{w.audit.map((e: D) => <tr key={e.id}><td>{when(e.at)}</td><td title={e.email}>{person(w, e.email)}</td><td>{phrase(e.action)}</td><td title={e.record}>{recordName(w, e.record)}</td></tr>)}</Table>
  </>
}
