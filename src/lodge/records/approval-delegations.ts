import type { State } from '../core/state'
import { can, requireMember, requireRole } from '../core/access'
import { grantsOf } from '../core/store'
import { businessZone, times } from '../core/time'
import { date, now, requireThat, uid, type Actor, type Data } from '../core/types'

/** Personal routing is explicit and never conveys the principal's permissions. */
export function approvalDelegation(s: State, a: Actor, b: Data) {
  requireRole(a, 'approver')
  requireThat(!a.agent, 'A human approver sets their own delegation', 403)
  const previous = s.find('approval-delegation', a.email)
  let value: Data = { active: false }
  if (b.active !== false) {
    const delegate = requireMember(s, String(b.delegate ?? '').trim().toLowerCase(), 'approver')
    requireThat(!delegate.agent && !delegate.roles.includes('agency') && delegate.email !== a.email, 'Choose another human employer approver')
    const from = date(b.from, 'First day'), through = date(b.through, 'Last day')
    requireThat(from <= through, 'The last day must be on or after the first day')
    value = { active: true, delegate: delegate.email, from, through, timeZone: businessZone(s.get('business', 'main')) }
  }
  const record = s.put('approval-delegation', a.email, { ...value, principal: a.email, version: uid(), by: a.email, at: now(), previousVersion: previous?.version ?? null })
  s.audit(a, 'approval-delegation-changed', 'member:' + a.email, { version: record.version, active: record.active, delegate: record.delegate ?? null })
  return record
}

export function humanApprover(s: State, email: string, job: Data) {
  const m = s.find('member', email)
  return !!m?.active && !m.agent && !m.roles.includes('agency') && (m.owner || m.roles.includes('approver')) && can(s, { ...m, grants: grantsOf(s, m) } as Actor, job, 'approve')
}

function inRange(d: Data, at: string) {
  const day = times(d.timeZone).dateOf(at)
  return d.active && d.from <= day && day <= d.through
}

export function delegationCurrent(s: State, route: Data, job: Data, at = now()) {
  const saved = s.find('approval-delegation', route.approver)
  return !!saved && saved.version === route.version && saved.delegate === route.delegate && inRange(saved, at) && humanApprover(s, route.approver, job) && humanApprover(s, route.delegate, job)
}

/** Freeze the routing shown to the requester; later edits require a fresh request. */
export function requestDelegations(s: State, chain: Data, job: Data, at: string) {
  return chain.steps.flatMap((step: Data, index: number) => {
    const routed = step.approvers.map((approver: string) => {
      const d = s.find('approval-delegation', approver)
      if (!d || !inRange(d, at)) return { approver }
      requireThat(humanApprover(s, d.delegate, job), 'The delegate needs current approval authority on this job', 403)
      return { step: index, approver, delegate: d.delegate, version: d.version, from: d.from, through: d.through, timeZone: d.timeZone }
    })
    requireThat(new Set(routed.map((r: Data) => r.delegate ?? r.approver)).size === routed.length, 'Each person in a parallel step needs an independent decision maker', 409)
    return routed.filter((r: Data) => r.delegate)
  })
}
