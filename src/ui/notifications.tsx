import { useEffect, useRef, useState } from 'react'
import type { PageProps } from './app'
import { recent } from './format'
import { Icon } from './icons'
import { Check, Form, Status, Table, type D } from './shared'

// TEAM-002 / TEAM-003 screens: @mention suggestions in a note, the member's alerts, and the notification settings.

const MODES = [['inherit', 'Default'], ['off', 'Off'], ['immediate', 'Immediately'], ['digest', 'Daily digest']]
const WORDS: D = { off: 'off', immediate: 'immediately', digest: 'as a daily digest' }

/** A note box that suggests active members as you type "@" and inserts the address that names them. */
export function MentionBox({ w, label, name = 'text', defaultValue = '' }: { w: D; label: string; name?: string; defaultValue?: string }) {
  const [text, setText] = useState(defaultValue), [at, setAt] = useState(0), box = useRef<HTMLTextAreaElement>(null)
  // The form's own reset (after a saved note) clears the controlled box too.
  useEffect(() => { const form = box.current?.form, clear = () => { setText(defaultValue); setAt(0) }; form?.addEventListener('reset', clear); return () => form?.removeEventListener('reset', clear) }, [defaultValue])
  const query = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, at))
  const people = query ? w.members.filter((m: D) => m.active && (m.owner || m.roles.length) && m.email !== w.actor.email && (m.name + ' ' + m.email).toLowerCase().includes(query[2].toLowerCase())).slice(0, 6) : []
  const insert = (m: D) => { const head = text.slice(0, at).replace(/@[^\s@]*$/, '@' + m.email + ' '); setText(head + text.slice(at)); setAt(head.length) }
  return <label className="wide">{label}
    <textarea ref={box} name={name} required value={text} onChange={e => { setText(e.target.value); setAt(e.target.selectionStart) }} onSelect={e => setAt(e.currentTarget.selectionStart)} />
    <small>Type @ to mention a colleague. Mentioning never gives anyone access to the candidate.</small>
    {people.length > 0 && <ul className="list" role="listbox" aria-label="People you can mention">{people.map((m: D) => <li key={m.email} role="option" aria-selected="false"><button type="button" className="link" onClick={() => insert(m)}>{m.name} · {m.email}</button></li>)}</ul>}
  </label>
}

/** The reader's alerts: mentions and the events they subscribed to, each linking to its exact item. */
export function Alerts({ w, mutate, follow }: Pick<PageProps, 'w' | 'mutate' | 'follow'>) {
  const rows: D[] = w.alerts ?? []
  if (!rows.length) return null
  const open = async (x: D) => { if (!x.read) await mutate('alert-read', { id: x.id }); if (x.link) follow(x.link) }
  return <section className="card"><h2>Notifications</h2>
    <ul className="list rich">{rows.slice(0, 12).map(x => <li key={x.id}>
      <button onClick={() => open(x)} disabled={!x.link && x.read}><Icon name={x.event === 'mention' ? 'mail' : 'alert'} /><span><strong>{x.title}</strong><small>{[x.detail, recent(x.at)].filter(Boolean).join(' · ')}</small></span>{!x.read && <Status tone="warn">new</Status>}{x.textOnly && <Status>no link</Status>}</button>
    </li>)}</ul>
    {rows.some(x => !x.read) && <button onClick={() => mutate('alert-read', { all: true })}>Mark all read</button>}
  </section>
}

function Choice({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{MODES.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select>
}

/** Per-job email and in-app choices for each event; admins also set role defaults and the mention rule. */
export function NotificationSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const n = w.notify
  if (!n) return null
  const events = Object.entries(n.events) as [string, string][]
  const admin = w.actor.owner || w.actor.roles.includes('admin')
  const [role, setRole] = useState(n.roles[0])
  return <section className="card"><h2>Notification settings</h2>
    <p>Choose how you hear about each kind of event on the jobs you are on. Lodge checks your access when it sends, and every notice links to the exact item.</p>
    {n.jobs.length === 0 && <p className="empty">You are not on a job yet.</p>}
    {n.jobs.map((j: D) => <details key={j.vacancy}><summary>{j.title}</summary>
      <Table heads={['Event', 'Email', 'In-app']}>{events.map(([key, label]) => <tr key={key}>
        <td>{label}<small> · now {WORDS[j.settings[key].email]} by email, {WORDS[j.settings[key].inApp]} in-app</small></td>
        {(['email', 'inApp'] as const).map(ch => <td key={ch}><Choice label={`${label}: ${ch === 'email' ? 'email' : 'in-app'} for ${j.title}`} value={j.settings[key].own[ch] ?? 'inherit'} onChange={v => mutate('notify-pref', { vacancy: j.vacancy, event: key, [ch]: v })} /></td>)}
      </tr>)}</Table>
    </details>)}
    {admin && n.defaults && <details><summary>Defaults by hiring-team role</summary>
      <label>Role<select value={role} onChange={e => setRole(e.target.value)}>{n.roles.map((r: string) => <option key={r} value={r}>{r.replace(/([A-Z])/g, ' $1').toLowerCase()}</option>)}</select></label>
      <Table heads={['Event', 'Email', 'In-app']}>{events.map(([key, label]) => <tr key={key}>
        <td>{label}</td>
        {(['email', 'inApp'] as const).map(ch => <td key={ch}><Choice label={`${label}: default ${ch === 'email' ? 'email' : 'in-app'} for ${role}`} value={n.defaults[role]?.[key]?.[ch] ?? 'inherit'} onChange={v => mutate('notify-default', { role, event: key, [ch]: v })} /></td>)}
      </tr>)}</Table>
      <Form label="Save mention rule" compact onSubmit={x => mutate('mention-policy', { refuseWithoutAccess: x.refuseWithoutAccess })}>
        <Check label="Refuse mentions of people who cannot see the candidate" name="refuseWithoutAccess" defaultChecked={n.refuseWithoutAccess === true} />
      </Form>
    </details>}
  </section>
}
