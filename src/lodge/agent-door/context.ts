import type { Bindings } from '../../auth.server.ts'
import { ToolRefusal } from '../../modules/agent-door/errors.ts'
import type { ToolContext } from '../../modules/agent-door/types.ts'
import { actorFor, load } from '../core/store.ts'
import { Fault, type Actor } from '../core/types.ts'
import type { State } from '../core/state.ts'

export async function nativeContext(env: Bindings, ctx: ToolContext, admissions?: Map<string, string>): Promise<{ state: State; actor: Actor }> {
  const state = await load(env.DB)
  const native = await env.DB.prepare('SELECT id,email,display_name AS displayName,role,version,status FROM oa_operators WHERE id=?').bind(ctx.person.id).first<{id: string; email: string; displayName: string; role: string; version: number; status: string}>()
  if (!native || native.status !== 'active' || native.email !== ctx.person.email) throw new ToolRefusal('sponsor_unavailable')
  // This is native identity resolution after signed door admission, not a
  // synthetic browser session. The mutation fence below uses operator versions.
  const sponsor = actorFor({ operator: native, id: '' }, state)
  const member = state.scan('member').find(m => m.businessAgentId === ctx.agent.id && m.sponsorNativeId === native.id)
  if (!member?.active || !member.agent || member.actsFor !== sponsor.email) throw new ToolRefusal('native_agent_unavailable')
  const policy = await env.DB.prepare('SELECT envelope,local_revision,local_paused FROM agent_door_state WHERE id=1').first<{ envelope: string; local_revision: number; local_paused: number }>()
  const snapshot=JSON.stringify([policy?.envelope,policy?.local_revision,policy?.local_paused])
  if(admissions?.has(ctx.operationId) && admissions.get(ctx.operationId)!==snapshot) throw new ToolRefusal('native_conflict')
  admissions?.set(ctx.operationId,snapshot)
  const envelope = policy?.envelope ? JSON.parse(policy.envelope) : null
  if (!envelope?.document || envelope.paused || policy?.local_paused || envelope.exp * 1000 <= Date.now() || envelope.revoked?.agents?.includes(ctx.agent.id) || envelope.revoked?.consents?.includes(ctx.consent)) throw new ToolRefusal('agents_unavailable')
  return { state, actor: { ...sponsor, owner: false, agent: true, email: member.email, name: ctx.actor.label, scopeAs: sponsor.email, seePrivate: sponsor.owner || sponsor.seePrivate,
    memberships: [...sponsor.memberships ?? [], { email: member.email, revision: state.revisionOf('member', member.email) }],
    door: { agent: ctx.agent.id, sponsor: native.id, label: ctx.actor.label, envelope: policy!.envelope, localRevision: policy!.local_revision },
  } }
}

export async function native<T>(call: () => Promise<T>): Promise<T> {
  try { return await call() }
  catch (error) {
    if (error instanceof Fault) throw new ToolRefusal(error.status === 404 ? 'record_unavailable' : error.status === 409 ? 'native_conflict' : 'native_refused', undefined, { status: error.status })
    throw error
  }
}
