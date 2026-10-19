import { useState } from 'react'
import type { PageProps } from './app'
import { person, phrase, recordName } from './names'
import { when } from './format'
import { call, Field, Form, Table, type D } from './shared'

/** OPS-001: the latest events, then a search over the complete audit for a chosen period, exported whole as JSON. */
export function Audit({ w }: PageProps) {
  const [found, setFound] = useState<D>(), [query, setQuery] = useState('')
  const events: D[] = found ? found.events : w.audit
  return <div className="page">
    <h1>Audit history</h1>
    <Form label="Search the audit" compact onSubmit={async x => {
      const q = new URLSearchParams(Object.entries({ from: x.from, to: x.to, q: x.q, action: x.action }).filter(([, v]) => v) as [string, string][]).toString()
      setFound(await call('audit' + (q ? '?' + q : ''))); setQuery(q)
    }}>
      <Field label="From (day)" name="from" type="date" required={false} />
      <Field label="To (day, included)" name="to" type="date" required={false} />
      <Field label="Words or record" name="q" required={false} />
      <Field label="Action" name="action" required={false} hint="For example stage-moved or candidate-deleted" />
    </Form>
    {found ? <p className="hint">{found.total} {found.total === 1 ? 'event' : 'events'} in this search, oldest first, none left out · days in {found.period.timeZone} · <a href={'/api/lodge/download/audit' + (query ? '?' + query : '')}>Export these events (JSON)</a></p>
      : <p className="hint">The latest {w.audit.length} events, newest first. Search for every event in a period, or <a href="/api/lodge/download/audit">export the complete audit (JSON)</a>.</p>}
    <Table heads={['When', 'Who', 'Action', 'Record']} empty="Nothing recorded yet.">{events.map((e: D) => <tr key={e.id}><td>{when(e.at)}</td><td title={e.email}>{person(w, e.email)}</td><td>{phrase(e.action)}</td><td title={e.record}>{recordName(w, e.record)}</td></tr>)}</Table>
  </div>
}
