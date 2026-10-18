import type { PageProps } from './app'
import { day, when } from './format'
import { count, sentence } from './names'
import { call, Field, Form, Status, Table, type D } from './shared'

/** What each kind of erased record is called on a receipt: the singular, and the plural when it is not just an added s. */
const RECORD: Record<string, [string, string?]> = { 'stage-event': ['stage event'], 'interview-note': ['interview note'], receipt: ['application receipt'], monitoring: ['equal-opportunity answer'], candidate: ['merged record'], 'data-request': ['candidate request'], hold: ['legal hold'], 'deletion-receipt': ['earlier deletion receipt'], 'duplicate-review': ['duplicate review'], 'imported-note': ['imported note'], 'imported-rating': ['imported rating'], 'imported-message': ['imported message'], audit: ['audit entry', 'audit entries'] }
const erased = (counts: Record<string, number>) => Object.entries(counts).filter(([, n]) => n > 0).map(([kind, n]) => count(n, ...(RECORD[kind] ?? [kind.replace(/-/g, ' ')]) as [string, string?])).join(', ')

const BASIS: D = { application: 'They applied', referral: 'Referral with their agreement', 'talent-pool': 'Talent pool', manual: 'Other' }

export function Retention({ w, mutate, reload, setNotice }: PageProps) {
  const people = w.candidates.map((c: D) => ({ value: c.id, label: c.name }))
  const name = (id: string) => w.candidates.find((c: D) => c.id === id)?.name ?? id
  return <div className="page">
    <h1>Retention and requests</h1>
    <h2>Past their retention date</h2>
    <Table heads={['Candidate', 'Keep until', 'Basis', '']} empty="No records are due.">{w.retention.due.map((r: D) => <tr key={r.candidate}><td>{r.name}</td><td>{day(r.retainUntil)}</td><td>{BASIS[r.basis] ?? r.basis}</td><td>
      <Form label={`Delete ${r.name}`} compact onSubmit={async x => { await call('delete-candidate', { candidate: r.candidate, confirm: x.confirm, reason: x.reason }); setNotice('Deleted. A receipt was recorded.'); await reload() }}>
        <Field label={`Type “${r.name}” to confirm`} name="confirm" /><Field label="Reason" name="reason" defaultValue="Retention period ended" />
      </Form></td></tr>)}</Table>
    {w.retention.held.length > 0 && <><h2>Held past retention</h2><ul>{w.retention.held.map((r: D) => <li key={r.candidate}>{r.name} · held</li>)}</ul></>}
    <h2>Legal holds</h2>
    {!w.holds.length && <p className="empty">No legal holds.</p>}
    <ul>{w.holds.map((h: D) => <li key={h.id}>{h.candidate ? name(h.candidate) : w.vacancies.find((v: D) => v.id === h.vacancy)?.title} · {h.status} · {h.reason}
      {h.status === 'active' && <Form label="Release hold" compact onSubmit={x => mutate('release-hold', { id: h.id, reason: x.reason })}><Field label="Reason for release" name="reason" /></Form>}</li>)}</ul>
    <Form label="Place hold" reset onSubmit={x => mutate('hold', x.target.startsWith('v:') ? { vacancy: x.target.slice(2), reason: x.reason } : { candidate: x.target.slice(2), reason: x.reason })}>
      <Field label="Hold" name="target" options={[...people.map((p: D) => ({ value: 'c:' + p.value, label: 'Candidate: ' + p.label })), ...w.vacancies.map((v: D) => ({ value: 'v:' + v.id, label: 'Vacancy: ' + v.title }))]} />
      <Field label="Reason" name="reason" />
    </Form>
    <h2>Candidate requests</h2>
    <Table heads={['Candidate', 'Type', 'Received', 'Status', 'Note', '']} empty="No requests recorded.">{w.dataRequests.map((r: D) => <tr key={r.id}><td>{r.candidateName ?? 'deleted'}</td><td>{sentence(r.type)}</td><td>{day(r.receivedAt)}</td><td>{r.status === 'open' ? <Status tone="warn">open</Status> : <Status tone="good">complete</Status>}</td><td className="note">{r.outcome || r.note || ''}</td>
      <td>{r.status === 'open' && r.candidateName && ['access', 'export'].includes(r.type) && <a href={`/api/lodge/download/candidate/${r.candidate}?request=${r.id}`} onClick={() => setTimeout(reload, 800)}>Download their data and complete</a>}
        {r.status === 'open' && <Form label="Mark complete" compact onSubmit={x => mutate('complete-data-request', { id: r.id, outcome: x.outcome })}><Field label="What was done" name="outcome" /></Form>}</td></tr>)}</Table>
    <Form label="Record request" reset onSubmit={x => mutate('data-request', x)}>
      <Field label="Candidate" name="candidate" options={people} />
      <Field label="Request" name="type" options={['access', 'export', 'correction', 'deletion'].map(t => ({ value: t, label: t }))} />
      <Field label="How it arrived" name="channel" defaultValue="email" />
      <Field label="Note" name="note" required={false} />
    </Form>
    <details><summary>Delete a candidate now</summary><Form label="Delete candidate" onSubmit={async x => { await call('delete-candidate', x); setNotice('Deleted. A receipt was recorded.'); await reload() }}>
      <Field label="Candidate" name="candidate" options={people} /><Field label="Type their full name to confirm" name="confirm" /><Field label="Reason" name="reason" />
    </Form></details>
    <h2>Deletion receipts</h2>
    {!w.deletionReceipts.length && <p className="empty">No deletion receipts yet.</p>}
    <ul>{w.deletionReceipts.map((r: D) => <li key={r.id}>{when(r.at)} · record {r.candidate.slice(0, 8)} · {erased(r.counts)}</li>)}</ul>
  </div>
}
