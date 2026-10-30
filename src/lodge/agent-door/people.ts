import { operatorAuth } from '../../auth.server.ts'
import type { Bindings } from '../../auth.server.ts'
import { operatorAuthPeople } from '../../modules/agent-door/operator-people.ts'
import type { Person, PeopleAdapter } from '../../modules/agent-door/types.ts'
import { load, actorFor } from '../core/store.ts'

/** Business ids select native operators; Lodge membership further restricts admission. */
export function lodgePeople(env: Bindings): PeopleAdapter {
  const base = operatorAuthPeople({ db: env.DB, session: request => operatorAuth(env).getSession(request) })
  const person = async (id: string): Promise<Person | null> => {
    const native = await base.person(id)
    if (!native?.active) return null
    const state = await load(env.DB), member = state.find('member', native.email.toLowerCase())
    // Employer-provisioned identities still require their native employer sign-in.
    if (!member?.active || member.agent || member.enterprise || member.roles?.includes('agency') || !member.roles?.some((role: string) => ['admin', 'manager', 'interviewer', 'approver'].includes(role))) return null
    return { ...native, name: member.name, role: member.owner ? 'owner' : member.roles.includes('admin') ? 'admin' : 'member' }
  }
  return {
    person,
    async sponsor(claims) { const native = await base.sponsor(claims); return native ? person(native.id) : null },
    businessMember: base.businessMember,
    async session(request) {
      const session = await operatorAuth(env).getSession(request)
      if (!session) return null
      try { actorFor(session, await load(env.DB)) } catch { return null }
      return person(session.operator.id)
    },
  }
}
