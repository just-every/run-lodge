import type { State } from '../core/state'
import { cleared, requireAdmin, requireMember } from '../core/access'
import { email, list, requireThat, type Actor, type Data } from '../core/types'

export function vacancyCompliance(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(!a.agent, 'A person assigns compliance access', 403)
  const job = s.get('vacancy', b.id)
  requireThat(cleared(a, job, 'confidential'), 'Vacancy not found', 404)
  const people = [...new Set(list(b.people, 'Compliance people', 100, value => email(value)))]
  for (const address of people) {
    const member = requireMember(s, address)
    requireThat(!member.agent && member.roles.includes('compliance'), 'Choose active compliance people')
  }
  const record = s.put('vacancy', job.id, { ...job, compliancePeople: people })
  s.audit(a, 'vacancy-compliance-assigned', 'vacancy:' + job.id, { people })
  return record
}
