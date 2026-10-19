import { useEffect, useState } from 'react'
import type { PageProps } from './app'
import { amount, day, when } from './format'
import { count, person } from './names'
import { qrPath } from './qr'
import { FILE_LIMIT, base64, fitPhoto, keep, sync, unsynced } from './captures'
import { Check, Field, Form, Status, Table, cents, memberOptions, type D } from './shared'

// CRM-009: recruiting events. Recruiters create an event with linked jobs and a
// budget, show attendees its QR link, capture people on a phone (offline too),
// see the event's pool and report, and add a person to a linked job.

const KINDS = [{ value: 'career-fair', label: 'Career fair' }, { value: 'campus', label: 'Campus visit' }, { value: 'meetup', label: 'Meetup' }, { value: 'virtual', label: 'Virtual event' }]
const kindName = (k: string) => KINDS.find(x => x.value === k)?.label ?? k

function EventForm({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const jobs = w.vacancies.filter((v: D) => v.manages && !v.imported && v.status !== 'closed')
  return <Form label="Create event" reset onSubmit={x => mutate('event', {
    name: x.eventName, kind: x.kind, date: x.date, location: x.where, owner: x.owner || w.actor.email,
    jobs: jobs.filter((v: D) => x['job-' + v.id]).map((v: D) => v.id), budget: x.budget ? cents(x.budget) : 0,
  })}>
    <Field label="Event name" name="eventName" /><Field label="Event type" name="kind" options={KINDS} />
    <Field label="Event date" name="date" type="date" /><Field label="Where it is" name="where" />
    <Field label="Event owner" name="owner" required={false} options={memberOptions(w.members.filter((m: D) => !m.agent), 'manager')} hint="Leave empty to own it yourself" />
    <Field label="Budget in USD" name="budget" type="number" required={false} />
    {jobs.length > 0 && <fieldset className="wide"><legend>Linked jobs</legend>{jobs.map((v: D) => <Check key={v.id} name={'job-' + v.id} label={v.title} />)}</fieldset>}
  </Form>
}

/** The link attendees open, and its QR code. */
function Registration({ e, mutate }: { e: D; mutate: PageProps['mutate'] }) {
  const link = `${location.origin}/events/${e.token}`, qr = qrPath(link)
  return <section className="event-qr" aria-label={`Registration for ${e.name}`}>
    {e.status === 'open' ? <>
      <svg role="img" aria-label={`QR code for ${link}`} viewBox={`0 0 ${qr.size} ${qr.size}`} width="200" height="200" shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.d} fill="#000" /></svg>
      <p><small>Attendees scan this to register themselves:</small> <a href={link}>{link}</a></p>
      <Form label="Close registration" compact onSubmit={() => mutate('event-status', { id: e.id, status: 'closed' })} />
    </> : <><p><Status>Registration closed</Status></p><Form label="Open registration" compact onSubmit={() => mutate('event-status', { id: e.id, status: 'open' })} /></>}
  </section>
}

/** Staff capture: saved on this device first, synced when online; the unsynced count is always shown. */
function Capture({ e, w, reload }: { e: D; w: D; reload: () => Promise<void> }) {
  const me = w.actor.email
  const [left, setLeft] = useState<number | null>(null), [problem, setProblem] = useState(''), [photo, setPhoto] = useState<{ blob: Blob; name: string; url: string } | null>(null)
  async function push() {
    if (!navigator.onLine) { setLeft((await unsynced(me)).length); return }
    const result = await sync(me)
    setLeft(result.left); setProblem(result.refused.join(' · '))
    await reload().catch(() => undefined)
  }
  useEffect(() => {
    unsynced(me).then(list => setLeft(list.length)).catch(() => setLeft(0))
    // Back online it syncs at once, and retries every few seconds while captures wait (venue wifi comes and goes).
    const online = () => { push() }
    addEventListener('online', online)
    const retry = setInterval(() => { if (navigator.onLine) unsynced(me).then(list => { if (list.length) push() }).catch(() => undefined) }, 5000)
    return () => { removeEventListener('online', online); clearInterval(retry) }
  }, [])
  async function chosen(file: File | undefined) {
    setProblem('')
    if (photo) URL.revokeObjectURL(photo.url)
    if (!file) return setPhoto(null)
    try {
      const blob = await fitPhoto(file)
      const name = blob === file ? file.name : file.name.replace(/\.[^.]*$/, '') + '.jpg'
      setPhoto({ blob, name, url: URL.createObjectURL(blob) })
    } catch (err) { setPhoto(null); setProblem((err as Error).message) }
  }
  return <section className="event-capture" aria-label={`Capture people at ${e.name}`}>
    <h3>Capture people at {e.name}</h3>
    <p aria-live="polite" className="unsynced"><strong>{left ?? '…'}</strong> captured on this device, not synced yet{left ? <> · <button className="link" onClick={push}>Sync now</button></> : null}</p>
    <Form label="Save capture" reset onSubmit={async x => {
      const resume = photo ? { name: photo.name, mediaType: photo.blob.type || 'application/octet-stream', base64: await base64(photo.blob) } : undefined
      await keep({ captureId: crypto.randomUUID(), member: me, event: e.id, eventName: e.name, at: new Date().toISOString(), body: { name: x.capName, email: x.capEmail, phone: x.capPhone, interests: x.capInterests, noticeVersion: e.noticeVersion, cpraNoticeVersion: e.californiaNotice?.version, noticeShown: x.noticeShown === true, consentToContact: x.toContact === true, resume } })
      if (photo) URL.revokeObjectURL(photo.url)
      setPhoto(null)
      await push()
    }}>
      <Field label="Their name" name="capName" /><Field label="Their email" name="capEmail" type="email" required={false} />
      <Field label="Their phone" name="capPhone" type="tel" required={false} />
      <Field label="What work interests them" name="capInterests" type="textarea" wide required={false} />
      <label className="wide">Resume file or a photo of it<input type="file" name="capResume" accept="image/*,.pdf,.doc,.docx,.txt,.rtf,.odt" onChange={ev => chosen(ev.currentTarget.files?.[0])} /></label>
      {photo && <figure className="wide capture-photo">{photo.blob.type.startsWith('image/') && <img src={photo.url} alt="The resume photo as it will be stored" />}<figcaption>Will be stored as {photo.name}, {Math.ceil(photo.blob.size / 1000)} KB (limit {FILE_LIMIT / 1_000_000} MB)</figcaption></figure>}
      <details className="wide"><summary>Privacy notice (version {e.noticeVersion}) to show them</summary><p>{w.business?.notices?.at(-1)?.text}</p></details>
      {e.californiaNotice && <details className="wide"><summary>California applicant privacy notice (version {e.californiaNotice.version}) to show them</summary><dl>{e.californiaNotice.categories.map((c: D) => <div key={c.category}><dt>{c.category}</dt><dd>{c.collected} Used for: {c.purposes} {c.retention}</dd></div>)}</dl><p>{e.californiaNotice.saleStatement}</p></details>}
      <Check name="noticeShown" label={`They were shown privacy notice version ${e.noticeVersion}${e.californiaNotice ? ` and California notice version ${e.californiaNotice.version}` : ''}`} />
      <Check name="toContact" label="They agree to be contacted about suitable roles" />
    </Form>
    {problem && <p role="alert">{problem}</p>}
  </section>
}

function Report({ r }: { r: D }) {
  return <dl className="event-report" aria-label="Event report">
    <div><dt>Attendees</dt><dd>{r.attendees}</dd></div><div><dt>Applications</dt><dd>{r.applications}</dd></div>
    <div><dt>Interviews</dt><dd>{r.interviews}</dd></div><div><dt>Hires</dt><dd>{r.hires}</dd></div>
    <div><dt>Recorded costs</dt><dd>{amount(r.costs)}</dd></div><div><dt>Budget</dt><dd>{amount(r.budget)}</dd></div>
    <div><dt>Cost per hire</dt><dd>{r.costPerHire === null ? 'No hires yet' : amount(r.costPerHire)}</dd></div>
  </dl>
}

function Pool({ e, w, mutate }: { e: D; w: D; mutate: PageProps['mutate'] }) {
  const jobs = e.managesJobs.map((id: string) => w.vacancies.find((v: D) => v.id === id)).filter((v: D) => v && v.status === 'open')
  const title = (id: string) => w.vacancies.find((v: D) => v.id === id)?.title ?? 'a job'
  return <Table heads={['Person', 'Interests', 'Consent', 'Captured', 'Applications']} empty="Nobody captured yet.">{e.pool.map((p: D) => {
    const open = jobs.filter((v: D) => !p.applications.some((x: D) => x.vacancy === v.id && x.status === 'active'))
    return <tr key={p.candidate}>
      <td><strong>{p.name}</strong><small>{[p.email, p.phone].filter(Boolean).join(' · ')}</small><small>{p.source}</small></td>
      <td>{p.interests || '—'}</td>
      <td>{p.consent.toContact ? <Status tone="good">May contact</Status> : <Status>Not asked to be contacted</Status>}<small>Notice v{p.consent.noticeVersion}</small></td>
      <td>{p.by === 'attendee' ? 'Registered by QR' : person(w, p.by)}<small>{when(p.at)}</small></td>
      <td>{p.applications.length ? p.applications.map((x: D) => <small key={x.id}>{title(x.vacancy)} ({x.status})</small>) : <small>No application</small>}
        {open.length > 0 && <Form label="Add to job" compact onSubmit={x => mutate('event-apply', { event: e.id, candidate: p.candidate, vacancy: x.vacancy })}>
          <Field label={`Job for ${p.name}`} name="vacancy" options={open.map((v: D) => ({ value: v.id, label: v.title }))} />
        </Form>}</td>
    </tr>
  })}</Table>
}

export function Events({ w, mutate, reload }: PageProps) {
  const manager = w.actor.owner || w.actor.roles.some((r: string) => ['admin', 'manager'].includes(r))
  return <div className="page">
    <h1>Events</h1>
    <p className="hint">Career fairs, campus visits, meetups and virtual events. People captured at an event join its pool with the event as their source; nobody has an application until a recruiter adds them to a linked job.</p>
    {manager && <details><summary>Create an event</summary><EventForm w={w} mutate={mutate} /></details>}
    {!w.events.length && <p className="empty">No events yet.</p>}
    {w.events.map((e: D) => <article key={e.id} className="card event" aria-label={e.name}>
      <h2>{e.name}</h2>
      <p className="meta">{[kindName(e.kind), day(e.date), e.location, 'Owner ' + person(w, e.owner), count(e.jobs.length, 'linked job')].join(' · ')}</p>
      <Report r={e.report} />
      {e.runs && <Registration e={e} mutate={mutate} />}
      {(manager || e.runs) && <Capture e={e} w={w} reload={reload} />}
      <h3>Event pool</h3>
      <Pool e={e} w={w} mutate={mutate} />
      {e.runs && <details><summary>Record a cost</summary>
        {e.costs.length > 0 && <ul>{e.costs.map((c: D) => <li key={c.id}>{c.label}: {amount(c.amount)}</li>)}</ul>}
        <Form label="Record cost" reset onSubmit={x => mutate('event-cost', { id: e.id, label: x.costLabel, amount: cents(x.costAmount) })}>
          <Field label="What it was for" name="costLabel" /><Field label="Amount in USD" name="costAmount" type="number" />
        </Form></details>}
    </article>)}
  </div>
}
