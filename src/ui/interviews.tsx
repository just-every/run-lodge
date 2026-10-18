import type { PageProps } from './app'
import { person, people } from './names'
import { instant, slot, when, zoneName } from './format'
import { Field, Form, Status, type D } from './shared'

/** A panellist says they cannot attend; another interviewer on this candidate's panels offers to cover. */
function Reply({ iv, w, mutate }: { iv: D; w: D; mutate: PageProps['mutate'] }) {
  const me = w.actor.email, on = iv.participants.includes(me)
  const interviewer = w.actor.owner || w.actor.roles.some((r: string) => ['admin', 'manager', 'interviewer'].includes(r))
  if (w.actor.agent || !interviewer || iv.replies?.some((r: D) => r.by === me)) return null
  return <details><summary>{on ? 'I cannot attend' : 'I can cover this interview'}</summary>
    <Form label="Tell the hiring team" compact onSubmit={x => mutate('interview-reply', { interview: iv.id, answer: on ? 'cannot-attend' : 'can-cover', note: x.note, freeAt: x.freeAt ? instant(x.freeAt) : undefined })}>
      <Field label="Note to the team" name="note" required={false} />
      {!on && <Field label={`Free at (${zoneName()})`} name="freeAt" type="datetime-local" required={false} />}
    </Form>
  </details>
}

export function Interviews({ app, v, w, mutate }: { app: D; v?: D; w: D; mutate: PageProps['mutate'] }) {
  const list = w.interviews.filter((i: D) => i.application === app.id)
  const me = w.actor.email
  /** A booked interview whose time has passed: "awaiting scorecards" while a panellist's is missing, then "held". */
  const status = (iv: D) => iv.status !== 'scheduled' || Date.parse(iv.start) + iv.durationMinutes * 60000 > Date.now() ? iv.status
    : w.coordination.missingScorecards.some((m: D) => m.interview === iv.id) ? 'awaiting scorecards' : 'held'
  return <section className="card">
    <h3>Interviews</h3>
    {!list.length && <p className="empty">No interviews planned.</p>}
    {list.map((iv: D) => <article key={iv.id} className="card">
      <h4>{iv.title} <Status tone={status(iv) === 'scheduled' ? 'good' : 'neutral'}>{status(iv)}</Status></h4>
      <p>{iv.durationMinutes} min · {people(w, iv.participants)}{iv.location ? ' · ' + iv.location : ''}</p>
      {status(iv) === 'scheduled' && <p>{when(iv.start)} · <a href={`/api/lodge/download/calendar/${iv.id}`}>Download calendar invitation (.ics)</a></p>}
      {iv.status === 'scheduled' && status(iv) !== 'scheduled' && <p>{when(iv.start)}</p>}
      {iv.replies?.length > 0 && <ul className="replies">{iv.replies.map((r: D, i: number) => <li key={i} className={r.answer}><strong>{person(w, r.by)} {r.answer === 'cannot-attend' ? 'cannot attend' : `can cover${r.freeAt ? ', free ' + slot(r.freeAt) : ''}`}</strong>{r.note && <span>“{r.note}”</span>}<small>{when(r.at)}</small></li>)}</ul>}
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
      {iv.status !== 'cancelled' && <Reply iv={iv} w={w} mutate={mutate} />}
    </article>)}
    {app.manages && app.status === 'active' && v?.plan?.length > 0 && <details><summary>Plan an interview</summary>
      <Form label="Propose interview" reset onSubmit={x => mutate('interview', { application: app.id, planItem: x.planItem, participants: x.participants.split(',').map((p: string) => p.trim()).filter(Boolean), slots: [x.slot1, x.slot2, x.slot3].filter(Boolean).map(instant), location: x.location, timezone: w.business?.timeZone })}>
        <Field label="Interview" name="planItem" options={v!.plan.map((p: D) => ({ value: p.id, label: `${p.name} (${p.durationMinutes} min)` }))} />
        <Field label="Interviewers (emails, comma separated)" name="participants" />
        <Field label={`Proposed time 1 (${zoneName()})`} name="slot1" type="datetime-local" />
        <Field label={`Proposed time 2 (${zoneName()})`} name="slot2" type="datetime-local" required={false} />
        <Field label={`Proposed time 3 (${zoneName()})`} name="slot3" type="datetime-local" required={false} />
        <Field label="Location or video link" name="location" required={false} />
      </Form></details>}
  </section>
}
