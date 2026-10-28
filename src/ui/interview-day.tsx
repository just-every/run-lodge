import { useState } from 'react'
import type { PageProps } from './app'
import { Field, Form, Status, type D } from './shared'
import { people } from './names'
import { instantOf, times, toWall } from '../lodge/core/time'

const csv = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean)
const lines = (v: string) => v.split('\n').map(x => x.trim()).filter(Boolean)
function localInstant(value: string, zone: string) {
  const result = instantOf(value, zone)
  if (new Date(toWall(Date.parse(result), zone)).toISOString().slice(0, 16) !== value) throw new Error('This local time does not exist in the chosen time zone; choose an explicit valid time')
  return result
}
const local = (value: string, zone: string) => new Date(toWall(Date.parse(value), zone)).toISOString().slice(0, 16)
const ranges = (value: string, zone: string) => lines(value).map(line => { const [start, end] = csv(line); return { start: localInstant(start, zone), end: localInstant(end, zone) } })
const rangeText = (value: D[], zone: string) => value.map(r => local(r.start, zone) + ', ' + local(r.end, zone)).join('\n')
const RANGE_HINT = 'One start, end pair per line, such as 2027-03-15T09:00, 2027-03-15T17:00. Uses the selected time zone.'

function PoolForm({ v, pool, w, mutate }: { v: D; pool?: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const config = pool?.versions.at(-1), [memberCount, setMemberCount] = useState<number>(config?.members.length ?? 1), [roomCount, setRoomCount] = useState<number>(config?.rooms.length ?? 1)
  const memberOptions = w.members.filter((m: D) => m.active && !m.agent && (m.owner || m.roles.some((r: string) => ['admin', 'manager', 'interviewer'].includes(r)))).map((m: D) => ({ value: m.email, label: m.name }))
  const zone = w.business?.timeZone ?? 'UTC'
  return <Form label="Save declared pool" onSubmit={x => mutate('interviewer-pool', { vacancy: v.id, version: pool?.version ?? 0, name: x.poolName,
    members: Array.from({ length: memberCount }, (_, i) => ({ email: x['member' + i], qualifications: csv(x['qualifications' + i]), timezone: x['zone' + i], dailyCap: Number(x['cap' + i]), breakMinutes: Number(x['break' + i]), workStart: x['workStart' + i], workEnd: x['workEnd' + i], weekdays: csv(x['weekdays' + i]).map(Number), availability: ranges(x['availability' + i], x['zone' + i]), evidence: x['evidence' + i] })),
    rooms: Array.from({ length: roomCount }, (_, i) => ({ name: x['room' + i], availability: ranges(x['roomAvailability' + i], zone), busy: ranges(x['roomBusy' + i], zone), evidence: x['roomEvidence' + i] })) })}>
    <Field label="Pool name" name="poolName" defaultValue={config?.name ?? ''} />
    <p>Version {pool?.version ?? 0}. Employer declarations only; provider and resource availability remain unverified. Pool membership grants no candidate access.</p>
    {Array.from({ length: memberCount }, (_, i) => { const m = config?.members[i]; return <fieldset className="wide" key={i}><legend>Pool member {i + 1}</legend>
      <Field label="Member" name={'member' + i} defaultValue={m?.email} options={memberOptions} />
      <Field label="Declared qualifications (comma separated)" name={'qualifications' + i} defaultValue={m?.qualifications.join(', ')} />
      <Field label="Interviewer time zone" name={'zone' + i} defaultValue={m?.timezone ?? zone} />
      <Field label="Daily session cap" name={'cap' + i} type="number" defaultValue={m?.dailyCap ?? 3} />
      <Field label="Break between sessions (minutes)" name={'break' + i} type="number" defaultValue={m?.breakMinutes ?? 15} />
      <Field label="Working start" name={'workStart' + i} type="time" defaultValue={m?.workStart ?? '09:00'} />
      <Field label="Working end" name={'workEnd' + i} type="time" defaultValue={m?.workEnd ?? '17:00'} />
      <Field label="Working weekdays (0 Sunday to 6 Saturday)" name={'weekdays' + i} defaultValue={m?.weekdays.join(', ') ?? '1, 2, 3, 4, 5'} />
      <Field label="Recorded availability" name={'availability' + i} type="textarea" defaultValue={m ? rangeText(m.availability, m.timezone) : ''} hint={RANGE_HINT} wide />
      <Field label="Availability and qualification source" name={'evidence' + i} defaultValue={m?.evidence} wide />
    </fieldset> })}
    <div className="wide"><button type="button" disabled={memberCount >= 8} onClick={() => setMemberCount(n => n + 1)}>Add pool member</button>{memberCount > 1 && <button type="button" onClick={() => setMemberCount(n => n - 1)}>Remove last member</button>}</div>
    {Array.from({ length: roomCount }, (_, i) => { const r = config?.rooms[i]; return <fieldset className="wide" key={i}><legend>Declared room {i + 1}</legend>
      <Field label="Room name" name={'room' + i} defaultValue={r?.name} />
      <Field label="Room availability" name={'roomAvailability' + i} type="textarea" defaultValue={r ? rangeText(r.availability, zone) : ''} hint={RANGE_HINT + ' Business zone: ' + zone} wide />
      <Field label="Room busy times" name={'roomBusy' + i} type="textarea" defaultValue={r ? rangeText(r.busy, zone) : ''} required={false} hint={RANGE_HINT} wide />
      <Field label="Room declaration source" name={'roomEvidence' + i} defaultValue={r?.evidence} />
    </fieldset> })}
    <div className="wide"><button type="button" disabled={roomCount >= 8} onClick={() => setRoomCount(n => n + 1)}>Add declared room</button>{roomCount > 0 && <button type="button" onClick={() => setRoomCount(n => n - 1)}>Remove last room</button>}</div>
  </Form>
}

export function InterviewPoolSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const jobs = w.vacancies.filter((v: D) => w.scheduling?.jobs.includes(v.id)), [selected, setSelected] = useState('')
  const v = jobs.find((v: D) => v.id === selected) ?? jobs[0], pool = w.scheduling?.pools.find((p: D) => p.vacancy === v?.id)
  if (!jobs.length) return null
  return <section className="card" aria-label="Interviewer pool settings"><h2>Interviewer pools</h2>
    <label>Configure job<select value={v.id} onChange={e => setSelected(e.target.value)}>{jobs.map((v: D) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
    <PoolForm key={v.id + ':' + (pool?.version ?? 0)} v={v} pool={pool} w={w} mutate={mutate} />
  </section>
}

export function InterviewDay({ app, v, w, mutate }: { app: D; v: D; w: D; mutate: PageProps['mutate'] }) {
  const pool = w.scheduling?.pools.find((p: D) => p.vacancy === v.id), config = pool?.versions.at(-1)
  const drafts = w.scheduling?.drafts.filter((d: D) => d.application === app.id) ?? []
  const [sessionCount, setSessionCount] = useState(Math.min(3, v.plan.length)), zone = w.business?.timeZone ?? 'UTC'
  if (!w.scheduling?.jobs.includes(v.id)) return null
  return <section className="card" aria-label="Interview day planner"><h3>Draft interview day</h3>
    <p>Provider and resource availability unverified. Recorded availability establishes draft feasibility only. Human review changes no candidate commitment, production interview or independent scorecard assignment.</p>
    {config && app.status === 'active' ? <details><summary>Build draft alternatives</summary>
      <Form label="Find draft panels" onSubmit={x => mutate('interview-day', { application: app.id, poolVersion: pool.version, candidateTimezone: x.candidateZone, candidateAvailability: ranges(x.candidateAvailability, x.candidateZone), candidateBreakMinutes: Number(x.candidateBreak), excluded: csv(x.excluded),
        sessions: Array.from({ length: sessionCount }, (_, i) => ({ planItem: x['planItem' + i], starts: lines(x['starts' + i]).map(t => localInstant(t, x.candidateZone)), qualifications: csv(x['requires' + i]), required: csv(x['required' + i]), optional: csv(x['optional' + i]), size: Number(x['size' + i]), room: x['useRoom' + i] })) })}>
        <Field label="Candidate time zone" name="candidateZone" defaultValue={zone} />
        <Field label="Candidate break (minutes)" name="candidateBreak" type="number" defaultValue="15" />
        <Field label="Recorded candidate availability" name="candidateAvailability" type="textarea" hint={RANGE_HINT} wide />
        <Field label="Exclude panellists (emails, comma separated)" name="excluded" required={false} />
        {Array.from({ length: sessionCount }, (_, i) => <fieldset className="wide" key={i}><legend>Draft session {i + 1}</legend>
          <Field label="Interview plan session" name={'planItem' + i} defaultValue={v.plan[i % v.plan.length]?.id} options={v.plan.map((p: D) => ({ value: p.id, label: p.name + ' · ' + p.durationMinutes + ' minutes' }))} />
          <Field label="Required qualifications (comma separated)" name={'requires' + i} />
          <Field label="Required panel size" name={'size' + i} type="number" defaultValue="1" />
          <Field label="Required people (emails, comma separated)" name={'required' + i} required={false} />
          <Field label="Optional people (emails, comma separated)" name={'optional' + i} required={false} />
          <Field label="Proposed starts in candidate zone, one per line" name={'starts' + i} type="textarea" hint="Enter YYYY-MM-DDTHH:MM. Every selected session must fit the recorded availability." wide />
          <Field label="Declared room" name={'useRoom' + i} options={config.rooms.map((r: D) => ({ value: r.name, label: r.name }))} required={false} />
        </fieldset>)}
        <div className="wide"><button type="button" disabled={sessionCount >= 3} onClick={() => setSessionCount(n => n + 1)}>Add draft session</button>{sessionCount > 1 && <button type="button" onClick={() => setSessionCount(n => n - 1)}>Remove last session</button>}</div>
      </Form>
    </details> : <p>Declare qualifications and manual constraints under Settings before planning.</p>}
    {drafts.map((draft: D) => <article className="card" key={draft.id} aria-label="Draft alternatives">
      <h4>Pool version {draft.poolVersion} <Status tone={draft.stale ? 'warn' : 'neutral'}>{draft.stale ? 'Stale; plan again' : draft.status === 'reviewed' ? 'Draft reviewed' : 'Awaiting human review'}</Status></h4>
      {draft.searchLimited && <p>Search limit reached. Unlisted combinations remain unknown; narrow the proposed starts or pool.</p>}
      {!draft.alternatives.length && <p>No feasible draft found within these declarations.</p>}
      {draft.alternatives.map((alternative: D[], i: number) => <section key={i} aria-label={'Alternative ' + (i + 1)}><h4>Alternative {i + 1}</h4>
        <ol>{alternative.map((session: D, j: number) => <li key={j}><strong>{session.title}</strong><p>{times(draft.request.candidateTimezone).stamped(session.startISO)} to {times(draft.request.candidateTimezone).clock(session.endISO)} · {session.room || 'No declared room'}</p>
          <p>{people(w, session.participants)}</p>
          <ul>{session.participants.map((who: string) => { const m = pool.versions.find((v: D) => v.version === draft.poolVersion)?.members.find((m: D) => m.email === who); return m ? <li key={who}>{people(w, [who])}: {times(m.timezone).stamped(session.startISO)}{session.optional.includes(who) ? ' · optional' : ''}</li> : null })}</ul>
          {session.omitted.length > 0 && <p>Optional attendance omitted: {people(w, session.omitted)}</p>}
        </li>)}</ol>
        {draft.status === 'draft' && !draft.stale && <Form compact label={'Review draft alternative ' + (i + 1)} onSubmit={() => mutate('interview-day-review', { id: draft.id, fingerprint: draft.fingerprint, alternative: i })}><p>Review only. Provider booking and substitute application remain unavailable.</p></Form>}
        {draft.review?.alternative === i && <p>Human reviewed this draft. No production changes were applied.</p>}
      </section>)}
      {draft.conflicts.length > 0 && <details><summary>Constraint explanations</summary><ul>{draft.conflicts.map((reason: string) => <li key={reason}>{reason}</li>)}</ul></details>}
    </article>)}
  </section>
}
