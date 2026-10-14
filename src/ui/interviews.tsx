import type { PageProps } from './app'
import { people } from './names'
import { Field, Form, Status, when, type D } from './shared'

export function Interviews({ app, v, w, mutate }: { app: D; v?: D; w: D; mutate: PageProps['mutate'] }) {
  const list = w.interviews.filter((i: D) => i.application === app.id)
  const me = w.actor.email
  return <section className="card">
    <h3>Interviews</h3>
    {!list.length && <p className="empty">No interviews planned.</p>}
    {list.map((iv: D) => <article key={iv.id} className="card">
      <h4>{iv.title} <Status tone={iv.status === 'scheduled' ? 'good' : 'neutral'}>{iv.status}</Status></h4>
      <p>{iv.durationMinutes} min · {people(w, iv.participants)}{iv.location ? ' · ' + iv.location : ''}</p>
      {iv.status === 'scheduled' && <p>{when(iv.start)} · <a href={`/api/lodge/download/calendar/${iv.id}`}>Download calendar invitation (.ics)</a></p>}
      {iv.status === 'proposed' && <>
        <ul>{iv.slots.map((s: string, i: number) => <li key={s}>{when(s)} · available: {Object.entries(iv.availability).filter(([, picks]) => (picks as number[]).includes(i)).map(([who]) => who === 'candidate' ? 'the candidate' : people(w, [who])).join(', ') || 'no answers yet'}</li>)}</ul>
        {iv.candidateToken && <p>Candidate’s private availability link (include it in an approved message): <code>{location.origin}/availability/{iv.candidateToken}</code></p>}
        {iv.participants.includes(me) && <Form label="Save my availability" compact onSubmit={x => mutate('availability', { interview: iv.id, slots: iv.slots.map((_: string, i: number) => i).filter((i: number) => x['slot' + i]) })}>
          <fieldset className="wide"><legend>Times I can attend</legend>{iv.slots.map((s: string, i: number) => <label key={s} className="check"><input type="checkbox" name={'slot' + i} defaultChecked={iv.availability[me]?.includes(i)} /> {when(s)}</label>)}</fieldset>
        </Form>}
        {app.manages && <Form label="Schedule" compact onSubmit={x => mutate('schedule', { interview: iv.id, slot: Number(x.slot) })}>
          <Field label="Confirmed time" name="slot" options={iv.slots.map((s: string, i: number) => ({ value: String(i), label: when(s) }))} />
        </Form>}
      </>}
    </article>)}
    {app.manages && app.status === 'active' && v?.plan?.length > 0 && <details><summary>Plan an interview</summary>
      <Form label="Propose interview" reset onSubmit={x => mutate('interview', { application: app.id, planItem: x.planItem, participants: x.participants.split(',').map((p: string) => p.trim()).filter(Boolean), slots: [x.slot1, x.slot2, x.slot3].filter(Boolean).map((t: string) => new Date(t).toISOString()), location: x.location, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>
        <Field label="Interview" name="planItem" options={v!.plan.map((p: D) => ({ value: p.id, label: `${p.name} (${p.durationMinutes} min)` }))} />
        <Field label="Interviewers (emails, comma separated)" name="participants" />
        <Field label="Proposed time 1" name="slot1" type="datetime-local" />
        <Field label="Proposed time 2" name="slot2" type="datetime-local" required={false} />
        <Field label="Proposed time 3" name="slot3" type="datetime-local" required={false} />
        <Field label="Location or video link" name="location" required={false} />
      </Form></details>}
  </section>
}
