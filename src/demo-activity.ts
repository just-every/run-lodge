import { State, type Row } from './lodge/core/state'
import { run } from './lodge/commands'
import { deleteCandidate } from './lodge/records/retention'
import { ROLES, type Actor, type Data } from './lodge/core/types'

/** A past applicant whose record was deleted at his request; real ids are UUIDs, and the receipt shows the first eight characters. */
export const DELETED = '7d41c2e8-5b9a-4f03-9e6d-2a8b1c4f6e90'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const ISO = /^\d{4}-\d\d-\d\dT/

/**
 * The sample time `days` from now. Earlier days fall at a different time of day each,
 * not all at the visitor's start minute; later days fall on the hour.
 */
export function demoAt(now: Date, days: number): string {
  const time = now.getTime() + days * 86400000
  if (days > 0) return new Date(Math.ceil(time / 3600000) * 3600000).toISOString()
  return new Date(days <= -1 ? time - (37 + (Math.round(-days * 53) % 9) * 31) * 60000 : time).toISOString()
}

function rewrite(value: unknown, change: (s: string) => string): unknown {
  if (typeof value === 'string') return change(value)
  if (Array.isArray(value)) return value.map(v => rewrite(v, change))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, change)]))
  return value
}

/**
 * The workspace's recent history, made by Lodge's own commands on the sample records:
 * an agent member and its proposals, candidate requests and a deletion receipt.
 * Each step's timestamps move to the day it happened, and new ids become fixed ids,
 * so seeding stays idempotent.
 */
export async function demoActivity(rows: Row[], ownerEmail: string, now: Date): Promise<Row[]> {
  const s = new State(rows)
  const at = (days: number) => demoAt(now, days)
  const manager = 'maya@northline.example', agentEmail = 'maya-agent@northline.example'
  const owner: Actor = { id: 'demo-owner', email: ownerEmail, name: 'Alex Morgan', session: '', version: 0, owner: true, roles: [...ROLES], agent: false }
  const agent: Actor = { id: 'demo-agent', email: agentEmail, name: 'Maya’s scheduling agent', session: '', version: 0, owner: false, roles: ['manager', 'interviewer'], agent: true, scopeAs: manager }
  const step = async (days: number, action: () => unknown) => {
    const started = new Date().toISOString()
    await action()
    for (const write of s.pending().writes) if (write.value) s.put(write.kind, write.id, rewrite(write.value, v => ISO.test(v) && v >= started ? at(days) : v) as Data)
  }
  const draft = (application: string, purpose: string, subject: string, body: string) => ({ op: 'message', input: { application, purpose, subject, body } })

  await step(-17, () => run(s, owner, 'move', { application: 'demo-application-6', to: 'withdrawn', reason: 'Accepted another offer before the screen.' }))
  await step(-16, () => deleteCandidate(s, owner, { candidate: DELETED, confirm: 'Marcus Lee', reason: 'Asked us to delete his application' }))
  await step(-10, () => run(s, owner, 'member', { email: agentEmail, name: 'Maya’s scheduling agent', agent: true, actsFor: manager }))
  await step(-9, () => run(s, owner, 'data-request', { candidate: 'demo-candidate-7', type: 'access', receivedAt: at(-9).slice(0, 10), channel: 'email', note: 'Asked what we hold about him.' }))
  const access = s.all('data-request').find(r => r.candidate === 'demo-candidate-7')!
  await step(-7, () => run(s, owner, 'complete-data-request', { id: access.id, outcome: 'Sent his candidate export from hiring@northline.example' }))
  await step(-5, () => run(s, agent, 'propose', {
    workflow: 'coordination', approver: ownerEmail, sources: [{ kind: 'application', id: 'demo-application-3' }],
    summary: 'Acknowledge Jordan Kim’s application', rationale: 'Jordan applied four days ago and has not heard from us. A short acknowledgement sets expectations for the screen.',
    changes: [draft('demo-application-3', 'acknowledgement', 'Thanks for applying to Northline Studio', 'Hi Jordan,\nThank you for applying for the Full Stack Engineer role. Maya will review your application this week and let you know about next steps.\nBest, Maya')],
  }))
  const acknowledged = s.all('proposal')[0]
  await step(-4, () => run(s, owner, 'decide-proposal', { id: acknowledged.id, decision: 'approved', reason: 'Clear and kind; Maya can download and send it.' }))
  await step(-1, () => run(s, owner, 'data-request', { candidate: 'demo-candidate-6', type: 'correction', receivedAt: at(-1).slice(0, 10), channel: 'phone', note: 'Prefers to be called Sofi; new phone number to follow by email.' }))
  await step(-0.2, () => run(s, agent, 'propose', {
    workflow: 'coordination', approver: ownerEmail, sources: [{ kind: 'application', id: 'demo-application-4' }],
    summary: 'Ask Amara Okafor for interview times', rationale: 'Amara moved to the interview stage this week and no interview is proposed yet. Asking for times first avoids another round of messages.',
    changes: [draft('demo-application-4', 'availability-request', 'Times for a conversation with Northline Studio', 'Hi Amara,\nThank you for your time so far. We would like to invite you to a 45-minute working conversation with Alex and Leo. Could you share two or three times that suit you next week?\nBest, Maya')],
  }))

  const result = new Map(rows.map(row => [row.kind + '\u0000' + row.id, row]))
  const fixed = new Map<string, string>(), counts = new Map<string, number>()
  for (const { kind, id } of s.pending().writes) if (new RegExp(`^${UUID.source}$`).test(id) && !fixed.has(id) && !result.has(kind + '\u0000' + id)) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
    fixed.set(id, `demo-${kind}-${counts.get(kind)}`)
  }
  for (const { kind, id, value } of s.pending().writes) {
    const key = kind + '\u0000' + id, fixedId = fixed.get(id) ?? id
    result.delete(key)
    if (value) result.set(kind + '\u0000' + fixedId, { kind, id: fixedId, revision: 'demo-v1', value: rewrite(value, v => v.replace(UUID, m => fixed.get(m) ?? m)) as Data })
  }
  return [...result.values()]
}
