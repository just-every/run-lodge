import { isAdmin } from '../core/access'
import type { State } from '../core/state'
import type { Actor } from '../core/types'
import { CONNECTORS } from './catalog'

export function connectorSummary(s: State, a: Actor) {
  if (!isAdmin(a) || a.agent) return null
  return { note: 'Registry metadata only. No account is connected, credential changed, access verified or synchronization started here. Configure and rotate secret values through installation setup. Provider access remains unknown.',
    catalog: CONNECTORS.map(p => {
      const r = s.find('connector', p.id)
      // Explicit projection also prevents legacy or malformed extra fields reaching reads.
      const registration = r ? { provider: p.id, scopes: r.scopes, bindings: r.bindings, sender: r.sender, organizer: r.organizer,
        mappings: r.mappings, generation: r.generation, status: r.status, health: 'unknown', updatedAt: r.updatedAt, updatedBy: r.updatedBy } : null
      return { ...p, registration }
    }) }
}
