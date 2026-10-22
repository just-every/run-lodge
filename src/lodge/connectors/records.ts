import { requireAdmin } from '../core/access'
import type { State } from '../core/state'
import { email, integer, list, now, requireThat, type Actor, type Data } from '../core/types'
import { connectorDefinition } from './catalog'

function admin(a: Actor) { requireAdmin(a); requireThat(!a.agent, 'Only a person administers connectors', 403) }
function shape(b: Data, fields: string[]) {
  requireThat(Object.keys(b).every(k => fields.includes(k)), 'Only connector metadata is accepted; configure secret values in installation setup')
}
function definition(id: unknown) { const p = connectorDefinition(id); requireThat(p, 'Unknown connector'); return p }

/** No credential value enters State. These are declarations, never provider grants. */
export function connectorRegister(s: State, a: Actor, b: Data) {
  admin(a)
  shape(b, ['provider', 'scopes', 'sender', 'organizer', 'mappings', 'bindings', 'generation'])
  const p = definition(b.provider), previous = s.find('connector', p.id)
  if (previous) requireThat(b.generation === previous.generation, 'Connector changed; reload before saving', 409)
  const scopes = list(b.scopes ?? [], 'Requested scopes', 10, v => { requireThat(typeof v === 'string' && (p.scopes as readonly string[]).includes(v), 'Unsupported scope'); return v })
  const bindings = list(b.bindings ?? [], 'Secret binding names', 10, v => { requireThat(typeof v === 'string' && (p.bindings as readonly string[]).includes(v), 'Choose a declared installation binding name'); return v })
  const mappings = list(b.mappings ?? [], 'Mappings', 20, v => {
    requireThat(v && typeof v === 'object' && !Array.isArray(v), 'Choose a field mapping')
    shape(v as Data, ['from', 'to'])
    const x = v as Data
    requireThat((p.fields as readonly unknown[]).includes(x.from) && (p.fields as readonly unknown[]).includes(x.to), 'Unsupported field mapping')
    return { from: x.from as string, to: x.to as string }
  })
  requireThat(new Set(mappings.map(m => m.to)).size === mappings.length, 'Each destination field has one mapping')
  const record = s.put('connector', p.id, { provider: p.id, scopes: [...new Set(scopes)], bindings: [...new Set(bindings)], mappings,
    sender: b.sender ? email(b.sender, 'Sender') : '', organizer: b.organizer ? email(b.organizer, 'Organizer') : '',
    generation: (previous?.generation ?? 0) + 1, status: 'registered', health: 'unknown', updatedAt: now(), updatedBy: a.email })
  s.audit(a, 'connector-registered', 'connector:' + p.id, { generation: record.generation })
  return record
}

/** Acknowledges an external setup change; this command cannot rotate or revoke a Worker secret. */
export function connectorBindingChange(s: State, a: Actor, b: Data) {
  admin(a); shape(b, ['provider', 'generation', 'action'])
  const p = definition(b.provider), current = s.get('connector', p.id)
  requireThat(integer(b.generation, 'Generation', 1, Number.MAX_SAFE_INTEGER) === current.generation, 'Connector changed; reload before changing it', 409)
  requireThat(b.action === 'rotation-recorded' || b.action === 'disconnect', 'Choose rotation recorded or disconnect')
  requireThat(current.status !== 'disconnected', 'Register the connector again before changing it', 409)
  const record = s.put('connector', p.id, { ...current, generation: current.generation + 1, health: 'unknown',
    status: b.action === 'disconnect' ? 'disconnected' : 'registered', updatedAt: now(), updatedBy: a.email })
  s.audit(a, 'connector-' + b.action, 'connector:' + p.id, { generation: record.generation })
  return record
}
