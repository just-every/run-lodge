import { useState } from 'react'
import type { PageProps } from './app'
import { day } from './format'
import { sentence } from './names'
import { call, fileFrom, Form, readFile, Table, type D } from './shared'

const AREAS: D = { job: 'Jobs', member: 'Team members', candidate: 'Candidates', 'candidate-row': 'Candidate rows set aside', application: 'Applications', file: 'Files', comment: 'Comments', rating: 'Ratings', event: 'Events', 'inbound-message': 'Messages received', 'outbound-message': 'Messages sent' }
const KINDS: D = { vacancy: 'Job', candidate: 'Candidate', application: 'Application', document: 'File', 'source-member': 'Workable team member', 'imported-note': 'Comment', 'imported-rating': 'Rating', 'imported-message': 'Message' }
const batchName = (j: D) => [j.package ?? 'Workable export', day(j.startedAt)].filter(Boolean).join(' · ')

/** An imported record by name, from the values the batch wrote: an undone application still names its candidate and job. */
function imported(w: D, all: D[], d: D) {
  const value = (x: D) => x.expected?.ownedValue?.value ?? {}
  const named = (id?: string) => { const x = id ? all.find(r => r.targetId === id) : undefined; return x && (value(x).name || value(x).title) }
  const v = value(d)
  const candidate = v.candidate && (w.candidates.find((c: D) => c.id === v.candidate)?.name ?? named(v.candidate))
  const name = v.name || v.title || v.subject || [candidate, named(v.vacancy)].filter(Boolean).join(' · ')
  return [KINDS[d.targetKind] ?? sentence(d.targetKind.replace(/-/g, ' ')), name].filter(Boolean).join(' · ')
}

/** What the package would bring in; the headline counts set-aside records, and a line that never became a record is listed on its own. */
function Preview({ preview, onCommit }: { preview: D; onCommit: () => Promise<void> }) {
  const record = (q: D) => preview.plan.rejected.some((r: D) => r.location?.artifact === q.file && r.location?.row === q.line)
  const rows = preview.report.quarantined.filter(record), unread = preview.report.quarantined.filter((q: D) => !record(q))
  const line = (q: D, i: number) => <li key={i}>{q.file}{q.line ? ` line ${q.line}` : ''}: {q.reason}</li>
  return <section className="card">
    <h2>Preview of {preview.report.package.name}</h2>
    <p>{preview.plan.counts.input} records read · {preview.plan.counts.effects} to import · {preview.plan.counts.rejected} set aside</p>
    <Table heads={['Area', 'Records']}>{Object.entries(preview.report.areas).map(([k, n]) => <tr key={k}><td>{AREAS[k] ?? sentence(k.replace(/-/g, ' '))}</td><td>{n as number}</td></tr>)}</Table>
    {rows.length > 0 && <><h3>Rows set aside, not imported ({rows.length})</h3><ul>{rows.map(line)}</ul></>}
    {unread.length > 0 && <><h3>Lines Lodge could not read ({unread.length})</h3><ul>{unread.map(line)}</ul></>}
    {preview.report.missingAttachments.length > 0 && <><h3>Resumes named but missing from the package</h3><ul>{preview.report.missingAttachments.map((m: D) => <li key={m.candidate + m.file}>{m.name}: {m.file}</li>)}</ul></>}
    {preview.report.orphanedAttachments.length > 0 && <><h3>Files that match no candidate</h3><ul>{preview.report.orphanedAttachments.map((f: string) => <li key={f}>{f}</li>)}</ul></>}
    {preview.report.omitted.length > 0 && <><h3>Not carried over</h3><ul>{preview.report.omitted.map((o: D) => <li key={o.file}>{o.file}: {o.reason}</li>)}</ul></>}
    {preview.report.notes.map((n: string) => <p key={n} className="hint">{n}</p>)}
    <button className="primary" onClick={onCommit}>Commit this exact preview</button>
  </section>
}

export function MoveIn({ w, reload, setNotice }: PageProps) {
  const [preview, setPreview] = useState<D | null>(null), [file, setFile] = useState<D | null>(null), [status, setStatus] = useState<D | null>(null)
  const act = async (op: string, id: string) => { const r = await call('import/' + op, { id }); setNotice(`Batch ${r.job?.state ?? 'updated'}.`); await reload(); if (op === 'status') setStatus(r) }
  return <div className="page">
    <h1>Move in from Workable</h1>
    <p className="hint">Ask Workable support for the full data export ZIP (the candidate CSV report leaves out resumes). Lodge previews it first and writes nothing until you commit that exact preview. Imported people, jobs and history stay as records: nothing is sent, no one gets access, and Workable’s talent-pool flag is not treated as permission to contact.</p>
    <Form label="Preview package" onSubmit={async (_, form) => {
      const f = fileFrom(form, 'package')
      if (!f) throw new Error('Choose the export ZIP')
      const read = await readFile(f)
      setFile(read)
      setPreview(await call('import/preview', { filename: read.name, base64: read.base64 }))
    }}><label className="wide">Workable export ZIP<input type="file" name="package" accept=".zip" required /></label></Form>
    {preview && <Preview preview={preview} onCommit={async () => { const r = await call('import/commit', { filename: file!.name, base64: file!.base64, fingerprint: preview.plan.fingerprint }); setPreview(null); setNotice(`Import ${r.job.state}: ${r.job.checkpoint} of ${r.job.total} records applied.`); await reload() }} />}
    <h2>Import batches</h2>
    <Table heads={['Batch', 'State', 'Progress', '']} empty="No imports yet.">{w.importJobs.map((j: D) => <tr key={j.id}><td title={j.id}>{batchName(j)}</td><td>{sentence(j.state.replace(/_/g, ' '))}{j.error ? ` · ${j.error}` : ''}</td><td>{j.checkpoint}/{j.total}</td>
      <td>{j.mine && <span className="row-actions">{['applying', 'undoing', 'rolling_back', 'failed'].includes(j.state) && <button onClick={() => act('resume', j.id)}>Resume</button>}{j.state === 'completed' && <button onClick={() => act('undo', j.id)}>Undo unchanged records</button>}<button onClick={() => act('status', j.id)}>Details</button></span>}</td></tr>)}</Table>
    {status && <section className="card"><h3>{batchName(w.importJobs.find((j: D) => j.id === status.job.id) ?? {})}</h3><p>{sentence(status.job.state.replace(/_/g, ' '))} · {status.job.checkpoint}/{status.job.total}</p>
      <p>Original files kept: {status.originals.filter((o: D) => o.status === 'retained').length} of {status.originals.length}</p>
      {status.undo?.dispositions?.length > 0 && <ul>{status.undo.dispositions.map((d: D) => <li key={d.effectId}>{imported(w, status.undo.dispositions, d)}: {d.disposition} ({d.reason})</li>)}</ul>}</section>}
  </div>
}
