import type { State } from '../core/state'
import { now, type Actor } from '../core/types'
import { reassignTasks } from '../records/tasks'

/** Deprovisioning stops pending work; historical authors and decisions stay intact. */
export function suspendOwnedWork(s: State, actor: Actor, address: string) {
  reassignTasks(s, actor, address)
  for (const p of s.scan('proposal')) if (p.status === 'proposed' && [p.proposedBy, p.proposedFor, p.approver].includes(address))
    s.put('proposal', p.id, { ...p, status: 'suspended', suspendedAt: now(), reason: 'Member deprovisioned' })
  for (const r of s.scan('hiring-reminder')) if (['queued', 'held'].includes(r.status) && [r.owner, r.escalation, r.recipient].includes(address))
    s.put('hiring-reminder', r.id, { ...r, status: 'canceled', reason: 'Member deprovisioned', finishedAt: now() })
  const stopped = new Set<string>()
  for (const e of s.scan('crm-enrollment')) if (e.owner === address && ['draft', 'active'].includes(e.status)) {
    stopped.add(e.id)
    s.put('crm-enrollment', e.id, { ...e, status: 'stopped', enabled: false, stoppedAt: now(), reason: 'Member deprovisioned' })
  }
  for (const m of s.scan('application-email')) if (m.status === 'pending' && stopped.has(m.enrollment))
    s.put('application-email', m.id, { ...m, status: 'canceled', finishedAt: now(), reason: 'Member deprovisioned' })
  for (const r of s.scan('referral-email')) if (r.to === address && r.emailState === 'queued')
    s.put('referral-email', r.id, { ...r, emailState: 'withheld', emailAt: now(), reason: 'Member deprovisioned' })
}
