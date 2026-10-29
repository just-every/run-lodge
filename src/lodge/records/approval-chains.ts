import type { State } from '../core/state'
import { requireCan, requireMember } from '../core/access'
import { grantsOf } from '../core/store'
import { list, requireThat, type Actor, type Data } from '../core/types'

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
    return { approvers }
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
    !(approval.decisions ?? []).some((d: Data) => d.step === index && d.approver === email))
}
