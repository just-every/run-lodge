import type { Bindings } from '../../auth.server'
import { now, uid, type Data } from '../core/types'

/** Append only credential-free identity outcomes to the normal recruiting audit. */
export async function identityAudit(env: Bindings, action: string, detail: Data, member?: string) {
  const id = uid(), value = { id, at: now(), actor: 'public', email: 'public', action, record: member ? 'member:' + member : 'business:main', ...detail }
  await env.DB.prepare('INSERT INTO l_records(kind,id,revision,value) VALUES(?,?,?,?)').bind('audit', id, uid(), JSON.stringify(value)).run()
}

export function identityFetch(env: Bindings): typeof fetch {
  return async (request, init) => {
    const method = init?.method ?? (request instanceof Request ? request.method : 'GET')
    const address = new URL(request instanceof Request ? request.url : String(request))
    const endpoint = method === 'POST' ? 'token' : address.pathname.includes('well-known') ? 'discovery' : 'keys'
    let response: Response
    try { response = await fetch(request, init) }
    catch (error) { await identityAudit(env, 'enterprise-provider-request', { provider: 'Okta', endpoint, outcome: 'failed' }); throw error }
    await identityAudit(env, 'enterprise-provider-request', { provider: 'Okta', endpoint, outcome: response.ok ? 'response-received' : 'failed', status: response.status })
    return response
  }
}
