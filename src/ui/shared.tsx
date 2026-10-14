import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'

export type D = Record<string, any>
export type Mutate = (op: string, body: D) => Promise<D>

export async function call(path: string, input?: D): Promise<D> {
  const response = await fetch('/api/lodge/' + path, input ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : undefined)
  const body = (await response.json().catch(() => ({ error: 'The server sent an unreadable answer' }))) as D
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
}

export function Field({ label, name, defaultValue = '', type = 'text', required = true, options, wide, hint }: { label: string; name: string; defaultValue?: any; type?: string; required?: boolean; options?: { value: string; label: string }[]; wide?: boolean; hint?: string }) {
  const control = options
    ? <select name={name} defaultValue={defaultValue} required={required}><option value="">Choose…</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    : type === 'textarea' ? <textarea name={name} defaultValue={defaultValue} required={required} />
      : <input name={name} type={type} defaultValue={defaultValue} required={required} />
  return <label className={wide ? 'wide' : undefined}>{label}{control}{hint && <small>{hint}</small>}</label>
}

export function Check({ label, name, defaultChecked = false }: { label: string; name: string; defaultChecked?: boolean }) {
  return <label className="check"><input type="checkbox" name={name} defaultChecked={defaultChecked} /> {label}</label>
}

/** A form that turns its fields into JSON, shows the server's own refusal, and clears on success when asked. */
export function Form({ children, onSubmit, label = 'Save', reset = false, compact = false }: { children?: ReactNode; onSubmit: (values: D, form: HTMLFormElement) => Promise<unknown>; label?: string; reset?: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <form className={compact ? 'compact' : undefined} onSubmit={async event => {
    event.preventDefault()
    const form = event.currentTarget
    const values: D = {}
    for (const element of Array.from(form.elements) as HTMLInputElement[]) {
      if (!element.name) continue
      if (element.type === 'checkbox') values[element.name] = element.checked
      else if (element.type !== 'file') values[element.name] = element.value
    }
    setBusy(true); setError('')
    try { await onSubmit(values, form); if (reset) form.reset() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }}>{children}<div className="form-end"><button disabled={busy}>{busy ? 'Saving…' : label}</button>{error && <p role="alert">{error}</p>}</div></form>
}

export function Table({ heads, children, empty }: { heads: string[]; children: ReactNode[] | ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children
  if (Array.isArray(rows) && !rows.length && empty) return <p className="empty">{empty}</p>
  // Each cell carries its column's heading, so a narrow screen can show every row as a labelled record.
  const labelled = Children.map(rows, row => isValidElement<{ children?: ReactNode }>(row)
    ? cloneElement(row, {}, Children.map(row.props.children, (cell, i) => isValidElement(cell) ? cloneElement(cell as ReactElement<{ 'data-label'?: string }>, { 'data-label': heads[i] ?? '' }) : cell))
    : row)
  return <div className="table-scroll"><table><thead><tr>{heads.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{labelled}</tbody></table></div>
}

export async function readFile(file: File): Promise<D> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let raw = ''
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { name: file.name, mediaType: file.type || 'application/octet-stream', base64: btoa(raw) }
}

export const fileFrom = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.files?.[0]
export const pay = (c: D | null) => c ? `${c.currency} ${(c.min / 100).toLocaleString('en-US')}–${(c.max / 100).toLocaleString('en-US')}\u00a0/\u00a0${c.period}` : 'No range yet'
export const money = (s: D) => `${s.currency} ${(s.amount / 100).toLocaleString('en-US')}\u00a0/\u00a0${s.period}`
export const cents = (value: string) => { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new Error('Enter an amount'); return Math.round(n * 100) }
export const when = (iso?: string) => iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''
export const memberOptions = (members: D[], role?: string) => members.filter(m => m.active && (!role || m.owner || m.roles.includes(role))).map(m => ({ value: m.email, label: `${m.name} (${m.email})` }))

export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' }) {
  return <span className={'status ' + tone}>{children}</span>
}
