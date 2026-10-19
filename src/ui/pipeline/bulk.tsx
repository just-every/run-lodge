import { useState } from 'react'
import { board } from '../../lodge/views/board'
import { call, Status, Table, type D } from '../shared'

// DATA-003: select applications from this job's saved board view (the selection
// carries across jobs), preview one action on each, then apply exactly that
// preview. Each item shows its own outcome; a refused item never counts as done.

const KINDS = [['move', 'Move to a stage'], ['reject', 'Reject'], ['tag', 'Add a tag']]

export function BulkActions({ v, w, reload, selection, setSelection }: { v: D; w: D; reload: () => Promise<void>; selection: string[]; setSelection: (ids: string[]) => void }) {
  const b = board(w, v.id)
  const [kind, setKind] = useState('move'), [preview, setPreview] = useState<D | null>(null), [result, setResult] = useState<D | null>(null), [error, setError] = useState(''), [batch, setBatch] = useState('')
  if (!b || !v.manages) return null
  const inView = b.columns.filter((c: D) => c.id !== 'closed').flatMap((c: D) => c.cards).map((c: D) => w.applications.find((a: D) => a.id === c.application)).filter(Boolean)
  const name = (id: string) => w.applications.find((a: D) => a.id === id)?.candidateName ?? id
  const title = (id: string) => w.vacancies.find((x: D) => x.id === w.applications.find((a: D) => a.id === id)?.vacancy)?.title ?? ''
  const toggle = (id: string, on: boolean) => { setSelection(on ? [...new Set([...selection, id])] : selection.filter(x => x !== id)); setPreview(null); setResult(null) }
  const stages = [...new Set(w.vacancies.filter((x: D) => selection.some(id => w.applications.find((a: D) => a.id === id)?.vacancy === x.id)).flatMap((x: D) => x.stages.map((s: D) => s.name)))] as string[]
  async function previewIt(form: HTMLFormElement) {
    const f = new FormData(form), get = (k: string) => String(f.get(k) ?? '')
    const action: D = kind === 'move' ? { kind, stage: get('stage'), reason: get('reason') }
      : kind === 'tag' ? { kind, tag: get('tag') }
        : { kind, closeReason: get('closeReason'), note: get('note'), send: get('send'), template: get('template') || undefined, businessDays: get('businessDays') || undefined }
    setError(''); setResult(null)
    try { setPreview({ action, ...await call('command/bulk-preview', { items: selection, action }) }); setBatch(crypto.randomUUID()) } catch (e) { setError((e as Error).message) }
  }
  async function apply() {
    const ok = preview!.items.filter((i: D) => i.ok)
    try {
      setResult(await call('command/bulk-apply', { batch, items: ok.map((i: D) => i.application), action: preview!.action, previewed: Object.fromEntries(ok.map((i: D) => [i.application, i.seen])) }))
      setPreview(null); setSelection([]); await reload()
    } catch (e) { setError((e as Error).message) }
  }
  return <details className="bulk" open={selection.length > 0 || !!preview || !!result}>
    <summary>Bulk actions ({selection.length} selected)</summary>
    <fieldset><legend>Select from this view</legend>
      {inView.length ? inView.map((a: D) => <label key={a.id} className="check"><input type="checkbox" checked={selection.includes(a.id)} onChange={e => toggle(a.id, e.target.checked)} /> Select {a.candidateName}</label>) : <p className="muted">Nobody active in this view.</p>}
    </fieldset>
    {selection.length > 0 && <>
      <p>Selected: {selection.map(id => `${name(id)} (${title(id)})`).join(', ')} · <button className="link" onClick={() => { setSelection([]); setPreview(null) }}>Clear selection</button></p>
      <form onSubmit={e => { e.preventDefault(); previewIt(e.currentTarget) }}>
        <label>Bulk action<select value={kind} onChange={e => { setKind(e.target.value); setPreview(null) }}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {kind === 'move' && <><label>To stage<select name="stage" required><option value="">Choose…</option>{stages.map(s => <option key={s}>{s}</option>)}</select></label><label>Why<input name="reason" required /></label></>}
        {kind === 'tag' && <label>Tag to add<input name="tag" required /></label>}
        {kind === 'reject' && <>
          <label>Rejection reason<select name="closeReason" required><option value="">Choose…</option>{w.rejectionReasons.filter((r: D) => r.group === 'rejected' && !r.retired).map((r: D) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
          <label>Rejection email<select name="send" defaultValue="none"><option value="none">No email</option><option value="now">Now</option><option value="delay">After business days</option></select></label>
          <label>Email template<select name="template"><option value="">None</option>{w.rejectionTemplates.filter((t: D) => !t.retired).map((t: D) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Business days to wait<input name="businessDays" type="number" min="1" max="20" /></label>
          <label>Note (optional)<input name="note" /></label></>}
        <button>Preview</button>
      </form></>}
    {error && <p role="alert">{error}</p>}
    {preview && <section aria-label="Bulk preview">
      <p>{preview.ready} ready · {preview.refused} refused</p>
      <Table heads={['Candidate', 'Job', 'Outcome']}>{preview.items.map((i: D) => <tr key={i.application}>
        <td>{i.candidateName ?? name(i.application)}</td><td>{i.job ?? title(i.application)}</td>
        <td>{i.ok ? <Status tone="good">Ready</Status> : <Status tone="alert">{i.refusal}</Status>}{i.email && <small>Email to {i.email.to}: “{i.email.subject}” — {i.email.body}</small>}</td>
      </tr>)}</Table>
      {preview.ready > 0 && <button className="primary" onClick={apply}>Apply to {preview.ready}</button>}
    </section>}
    {result && <section aria-label="Bulk result"><p role="status">{result.applied} applied · {result.refused} refused</p>
      {result.items.filter((i: D) => !i.ok).map((i: D) => <p key={i.application}><Status tone="alert">{name(i.application)}: {i.refusal}</Status></p>)}</section>}
  </details>
}
