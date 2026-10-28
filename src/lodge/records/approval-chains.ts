import type { State } from '../core/state'
import { requireCan, requireMember } from '../core/access'
import { grantsOf } from '../core/store'
import { statusDue } from '../communications/timing'
import { integer, list, requireThat, type Actor, type Data } from '../core/types'

/** Every person in a step must decide; steps themselves run in order. */
export function chainSteps(s: State, value: unknown, job?: Data) {
  return list(value, 'Headcount approval steps', 8, (step: any) => {
    const approvers = list(step?.approvers, 'Step approvers', 8, raw => {
      const member = requireMember(s, String(raw).trim().toLowerCase(), 'approver')
      requireThat(!member.agent && !member.roles.includes('agency'), 'Choose a human employer approver')
      if (job) requireCan(s, { ...member, grants: grantsOf(s, member) } as Actor, job, 'approve')
      return member.email as string
    })
    requireThat(approvers.length > 0, 'Every approval step needs a named approver')
    requireThat(new Set(approvers).size === approvers.length, 'Name each approver once within a step')
    let escalation
    if (step?.escalation) {
      const owner = requireMember(s, String(step.escalation.owner).trim().toLowerCase(), 'approver')
      requireThat(!owner.agent && !owner.roles.includes('agency'), 'Choose a human escalation owner')
      if (job) requireCan(s, { ...owner, grants: grantsOf(s, owner) } as Actor, job, 'approve')
      escalation = { businessDays: integer(step.escalation.businessDays, 'Business days before escalation', 1, 60), owner: owner.email }
    }
    return { approvers, ...(escalation ? { escalation } : {}) }
  })
}

export function activeStep(approval: Data): number {
  return (approval.chain?.steps ?? []).findIndex((step: Data, index: number) =>
    !step.approvers.every((email: string) => (approval.decisions ?? []).some((d: Data) => d.step === index && d.approver === email && d.decision === 'approved')))
}

export function waitingApprovers(approval: Data): string[] {
  if (!approval.chain) return [approval.approver]
  if (approval.status !== 'pending') return []
  const index = activeStep(approval)
  return (approval.chain.steps[index]?.approvers ?? []).filter((email: string) =>
    !(approval.decisions ?? []).some((d: Data) => d.step === index && d.approver === email)).map((email: string) =>
      (approval.delegations ?? []).find((d: Data) => d.step === index && d.approver === email)?.delegate ?? email)
}

/** Escalation requests attention; it never substitutes a required decision. */
export function approvalRecipients(approval: Data): string[] {
  return [...new Set([...waitingApprovers(approval), ...(approval.status === 'pending' ? (approval.escalations ?? []).filter((e: Data) => e.step === activeStep(approval)).map((e: Data) => e.owner) : [])])] as string[]
}

export function stepTiming(approval: Data, at: string) {
  const step = approval.chain.steps[activeStep(approval)]
  return { stepStartedAt: at, stepDueAt: step?.escalation ? statusDue({ delayDays: step.escalation.businessDays, weekdays: [1, 2, 3, 4, 5], timeZone: approval.timeZone }, at) : null }
}
