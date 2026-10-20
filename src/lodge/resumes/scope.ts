import type { State } from '../core/state'
import { requireAdmin, requireCan, requireManages, requireRole } from '../core/access'
import { requireThat, type Actor } from '../core/types'

/** Resume staging uses the same live recruiter and contact rights as candidate creation. */
export function requireIntakeScope(s: State, a: Actor, vacancy: unknown) {
 requireThat(!a.agent, 'A recruiter reviews resume intake', 403)
 requireRole(a, 'admin', 'manager')
 if (vacancy) { const job = s.get('vacancy', vacancy); requireManages(a, job); requireCan(s, a, job, 'contact') }
 else requireAdmin(a)
}
