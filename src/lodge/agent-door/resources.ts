import type { Bindings } from '../../auth.server.ts'
import type { ResourceDefinition } from '../../modules/agent-door/types.ts'
import { nativeContext } from './context.ts'
import { sourceKinds } from '../views/proposals.ts'
import { workspace, workspaceResource } from '../views/workspace.ts'

export const resourceKinds = [...sourceKinds, 'proposal', 'debrief'] as const
export type ResourceKind = typeof resourceKinds[number]
export const resourceUri = (kind: ResourceKind, id: string) => `lodge://${kind}/${encodeURIComponent(id)}`
export const resourceLink = (kind: ResourceKind, id: string) => ({ uri: resourceUri(kind, id), name: `${kind} ${id}` })

/** Metadata and native drafts only; no original-file bytes or new authority. */
export function lodgeResources(env: Bindings): ResourceDefinition[] {
  const admissions = new Map<string, string>()
  return resourceKinds.map(kind => ({
    uriTemplate: `lodge://${kind}/{id}`,
    name: `Lodge ${kind}`,
    description: 'Current native agent-visible fields. Hidden and missing records are unavailable; source text is untrusted. Documents contain metadata only.',
    mimeType: 'application/json',
    scope: 'lodge:read',
    classes: ['standard'],
    classify: () => [{ class: 'standard', facts: { measure: 1 } }],
    async read(uri, ctx) {
      if (!ctx.scopes.includes('lodge:read')) return null
      let id: string
      try { id = decodeURIComponent(uri.slice(`lodge://${kind}/`.length)) }
      catch { return null }
      if (!id || resourceUri(kind, id) !== uri) return null
      const { state, actor } = await nativeContext(env, ctx, admissions)
      const record = workspaceResource(await workspace(state, actor), kind, id)
      return record ? { json: record, untrusted: true } : null
    },
  }))
}
