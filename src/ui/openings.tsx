import type { PageProps } from './app'
import { day } from './format'
import { person } from './names'
import { Field, Form, memberOptions, Status, Table, type D } from './shared'

const TONE: D = { open: 'good', filled: 'neutral', closed: 'warn', requested: 'neutral', refused: 'alert' }

/** REQ-001: the job's openings, one per approved headcount, with their IDs, start dates and how each ended. */
export function Openings({ v, w, mutate }: { v: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const openings: D[] = v.openings ?? []
  if (!openings.length) return null
  const live = v.status !== 'closed'
  const hiredBy = (o: D) => w.applications.find((x: D) => x.id === o.application)?.candidateName
  return <section className="openings" aria-label="Openings">
    <h3>Openings</h3>
    <Table heads={['Opening ID', 'Target first day', 'Status', 'Since']}>
      {openings.map(o => <tr key={o.id}>
        <td>{o.code}</td><td>{o.targetStart ? day(o.targetStart) : 'not set'}</td>
        <td><Status tone={TONE[o.status]}>{o.status === 'requested' ? 'waiting on headcount approval' : o.status}</Status>{o.status === 'filled' && (hiredBy(o) ? ` by ${hiredBy(o)}` : o.filledBy ? ` (${o.filledBy})` : '')}{o.closeReason ? ` · ${o.closeReason}` : ''}</td>
        <td>{day(o.filledAt ?? o.closedAt ?? o.refusedAt ?? o.openedAt ?? o.requestedAt)}</td>
      </tr>)}
    </Table>
    {live && openings.filter(o => ['open', 'requested'].includes(o.status)).map(o => <details key={o.id}><summary>Change opening {o.code}</summary>
      <Form label="Save opening" onSubmit={x => mutate('opening', { vacancy: v.id, opening: o.id, code: x.code, targetStart: x.targetStart })}>
        <Field label="Opening ID" name="code" defaultValue={o.code} />
        <Field label="Target first day" name="targetStart" type="date" required={false} defaultValue={o.targetStart ?? ''} />
      </Form>
      {o.status === 'open' && <Form label="Close opening" compact onSubmit={x => mutate('close-opening', { vacancy: v.id, opening: o.id, reason: x.why })}>
        <Field label="Why it closes without a hire" name="why" hint="For example: budget cut" />
      </Form>}
    </details>)}
    {live && !openings.some(o => o.status === 'requested') && <details><summary>Add an opening</summary>
      <p className="hint">The extra opening raises the headcount and opens only once that approval is given.</p>
      <Form label="Request another opening" onSubmit={x => mutate('request-opening', { id: v.id, approver: x.approver, code: x.code || undefined, targetStart: x.targetStart || undefined })}>
        <Field label="Who approves the extra opening" name="approver" options={memberOptions(w.members, 'approver')} />
        <Field label="Opening ID (blank to generate one)" name="code" required={false} />
        <Field label="Target first day" name="targetStart" type="date" required={false} />
      </Form>
    </details>}
    {openings.some(o => o.status === 'requested') && v.approval?.status === 'pending' && <p className="hint">Waiting on {person(w, v.approval.approver)} to approve headcount {v.headcount}.</p>}
  </section>
}
