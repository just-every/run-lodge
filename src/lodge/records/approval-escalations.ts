import type { Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import type { State } from '../core/state'
import { Fault, type Data } from '../core/types'
import { notify } from '../notify/emit'
import { activeStep, chainSteps } from './approval-chains'
import { delegationCurrent } from './approval-delegations'
import { versionOf } from './approvals'

/** Runs against an isolated copy in previews, and under revision fences in the scheduler. */
export async function escalateApprovals(s: State, at: number) {
  for (const approval of s.scan('approval')) {
    if (!approval.chain || approval.status !== 'pending' || !approval.stepDueAt || Date.parse(approval.stepDueAt) > at) continue
    const step = activeStep(approval), config = approval.chain.steps[step]?.escalation
    if (!config || (approval.escalations ?? []).some((e: Data) => e.step === step)) continue
    const job = s.find('vacancy', approval.subjectId)
    if (!job || job.imported || job.status === 'closed' || approval.version !== await versionOf(s, 'vacancy', job)) continue
    try { chainSteps(s, approval.chain.steps, job) } catch (error) { if (error instanceof Fault) continue; throw error }
    if (!(approval.delegations ?? []).every((d: Data) => delegationCurrent(s, d, job, new Date(at).toISOString()))) continue
    const escalation = { step, owner: config.owner, dueAt: approval.stepDueAt, at: new Date(at).toISOString() }
    s.put('approval', approval.id, { ...approval, escalations: [...(approval.escalations ?? []), escalation] })
    s.audit(null, 'approval-step-escalated', 'vacancy:' + job.id, { approval: approval.id, ...escalation })
    notify(s, 'approval', [config.owner], { vacancy: job, approval: approval.id, item: approval.id, by: null, scope: 'addressed', what: 'escalated' })
  }
}

export async function runApprovalEscalations(env: Bindings, at: number) {
  const s = await load(env.DB)
  await escalateApprovals(s, at)
  await save(env.DB, s, null)
}
