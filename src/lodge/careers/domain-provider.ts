import { Fault, requireThat, type Data } from '../core/types'

/** Install-local credentials: never copy these bindings into a hiring record. */
export interface CareersDomainBindings {
  CAREERS_CF_API_TOKEN?: string
  CAREERS_CF_ACCOUNT_ID?: string
  CAREERS_CF_ZONE_ID?: string
  CAREERS_CF_WORKER?: string
  AUTH_ORIGIN: string
}

export const CAREERS_VERIFICATION_PATH = '/.well-known/lodge-careers'
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)

export function careersDomainAvailable(env: CareersDomainBindings) {
  return !!(env.CAREERS_CF_API_TOKEN?.trim() && identifier(env.CAREERS_CF_ACCOUNT_ID) && identifier(env.CAREERS_CF_ZONE_ID) && identifier(env.CAREERS_CF_WORKER))
}

export function careersHostname(value: unknown, installationOrigin: string): string {
  requireThat(typeof value === 'string', 'Enter a careers hostname')
  const host = value.trim().toLowerCase()
  requireThat(host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host), 'Enter a plain public hostname without a scheme, port or path')
  requireThat(!/(^|\.)(localhost|local|internal|invalid|test)$/.test(host) && !host.endsWith('.workers.dev'), 'Choose a public hostname in your Cloudflare zone')
  requireThat(host !== new URL(installationOrigin).hostname.toLowerCase(), 'The installation hostname must keep serving Lodge; choose a different careers hostname', 409)
  return host
}

export interface DomainAssociation { id: string; hostname: string; service: string; zoneId: string; certificateId: string | null }

/** Cloudflare Workers Custom Domains own the DNS route and certificate renewal.
 * HTTPS readiness is separately proved against this installation, never inferred
 * from the attach response. All untrusted provider errors are discarded. */
export class CareersDomainProvider {
  constructor(private env: CareersDomainBindings) {
    requireThat(careersDomainAvailable(env), 'Custom careers domains are not configured for this installation', 503)
  }

  target() {
    return { accountId: this.env.CAREERS_CF_ACCOUNT_ID!, zoneId: this.env.CAREERS_CF_ZONE_ID!, worker: this.env.CAREERS_CF_WORKER! }
  }

  private accountPath(path: string) { return `/accounts/${encodeURIComponent(this.env.CAREERS_CF_ACCOUNT_ID!)}${path}` }
  private zonePath(path = '') { return `/zones/${encodeURIComponent(this.env.CAREERS_CF_ZONE_ID!)}${path}` }

  private async request(path: string, method = 'GET', body?: Data): Promise<Data> {
    let response: Response, result: Data
    try {
      response = await fetch('https://api.cloudflare.com/client/v4' + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${this.env.CAREERS_CF_API_TOKEN}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const text = await response.text()
      if (method === 'DELETE' && response.ok && !text.trim()) return { success: true, result: null }
      result = JSON.parse(text) as Data
    } catch { throw new Fault(502, 'Cloudflare could not be reached; check the installation configuration and try again') }
    requireThat(response.ok && result?.success === true, 'Cloudflare refused the domain request; check permissions and domain configuration', 502)
    return result
  }

  async zone(hostname: string) {
    const zone = (await this.request(this.zonePath())).result
    requireThat(zone?.id === this.env.CAREERS_CF_ZONE_ID && zone.account?.id === this.env.CAREERS_CF_ACCOUNT_ID && zone.status === 'active' && typeof zone.name === 'string', 'The configured Cloudflare zone is not active in this account', 409)
    requireThat(hostname === zone.name || hostname.endsWith('.' + zone.name), 'This hostname is outside the configured Cloudflare zone', 409)
    return { id: zone.id as string, name: zone.name as string }
  }

  async verifyTXT(name: string, challenge: string) {
    let result: Data
    try {
      const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
        headers: { accept: 'application/dns-json' }, redirect: 'manual', signal: AbortSignal.timeout(10_000),
      })
      requireThat(response.ok, 'DNS lookup is unavailable', 502)
      result = await response.json() as Data
    } catch { throw new Fault(502, 'DNS lookup is unavailable; try verification again') }
    // DNS JSON quotes and may split TXT into adjacent character strings. Parse
    // those strings without accepting a substring, CNAME answer or other owner.
    const exact = (data: unknown) => {
      if (typeof data !== 'string' || !/^(?:"(?:[^"\\]|\\["\\])*"\s*)+$/.test(data)) return false
      try { return [...data.matchAll(/"(?:[^"\\]|\\["\\])*"/g)].map(m => JSON.parse(m[0])).join('') === challenge } catch { return false }
    }
    requireThat(result.Status === 0 && Array.isArray(result.Answer) && result.Answer.some((row: Data) => row.type === 16 && typeof row.name === 'string' && row.name.toLowerCase().replace(/\.$/, '') === name && exact(row.data)), 'The exact TXT record is not visible yet; check the shown DNS name and value', 409)
  }

  private association(row: Data, hostname: string): DomainAssociation {
    requireThat(row && identifier(row.id) && row.hostname === hostname && row.service === this.env.CAREERS_CF_WORKER && row.zone_id === this.env.CAREERS_CF_ZONE_ID && row.environment === 'production' && row.enabled !== false, 'The hostname is not attached to this installation in the configured zone', 409)
    return { id: row.id, hostname, service: row.service, zoneId: row.zone_id, certificateId: identifier(row.cert_id) ? row.cert_id : null }
  }

  async domains(hostname: string): Promise<Data[]> {
    const result = (await this.request(this.accountPath(`/workers/domains?hostname=${encodeURIComponent(hostname)}`))).result
    requireThat(Array.isArray(result), 'Cloudflare returned an invalid domain list', 502)
    return result.filter((row: Data) => row.hostname === hostname)
  }

  async preflight(hostname: string, knownId?: string, attempted = false) {
    const rows = await this.domains(hostname)
    requireThat(rows.length <= 1, 'The hostname has conflicting Cloudflare domain assignments', 409)
    if (rows.length) {
      const attached = this.association(rows[0], hostname)
      requireThat(attached.id === knownId || attempted, 'This hostname already has a domain assignment; disconnect it at Cloudflare before connecting it here', 409)
      return attached
    }
    const dns = await this.request(this.zonePath(`/dns_records?name=${encodeURIComponent(hostname)}&per_page=100`))
    requireThat(Array.isArray(dns.result) && !(dns.result_info?.total_pages > 1), 'Cloudflare returned an incomplete DNS record list', 502)
    requireThat(!dns.result.some((row: Data) => ['A', 'AAAA', 'CNAME', 'NS', 'HTTPS', 'SVCB'].includes(row.type)), 'This hostname already has a DNS route; use an unused careers hostname', 409)
    const routes = (await this.request(this.zonePath('/workers/routes'))).result
    requireThat(Array.isArray(routes), 'Cloudflare returned an invalid Worker route list', 502)
    for (const route of routes) {
      if (!route.script) continue
      requireThat(typeof route.pattern === 'string', 'Cloudflare returned an invalid Worker route', 502)
      const pattern = route.pattern.replace(/^https?:\/\//, '').split('/')[0]
      const expression = '^' + pattern.split('*').map((part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'
      requireThat(!new RegExp(expression, 'i').test(hostname), 'An existing Worker route uses this hostname; choose an unused careers hostname', 409)
    }
    return null
  }

  async attach(hostname: string) {
    const result = (await this.request(this.accountPath('/workers/domains'), 'PUT', {
      hostname, service: this.env.CAREERS_CF_WORKER, environment: 'production', zone_id: this.env.CAREERS_CF_ZONE_ID,
    })).result
    return this.association(result, hostname)
  }

  async readback(hostname: string, id: string) {
    requireThat(identifier(id), 'Invalid saved Cloudflare association', 409)
    const result = (await this.request(this.accountPath(`/workers/domains/${encodeURIComponent(id)}`))).result
    const domain = this.association(result, hostname)
    requireThat(domain.id === id, 'The Cloudflare domain association changed; no provider changes were made', 409)
    return domain
  }

  async detach(hostname: string, id: string, beforeWrite: () => Promise<unknown>) {
    await this.readback(hostname, id)
    await beforeWrite()
    await this.request(this.accountPath(`/workers/domains/${encodeURIComponent(id)}`), 'DELETE')
    requireThat(!(await this.domains(hostname)).some(row => row.id === id), 'Cloudflare has not confirmed the domain disconnection; check again', 502)
  }

  async httpsReady(hostname: string, generation: string, challenge: string) {
    try {
      const response = await fetch(`https://${hostname}${CAREERS_VERIFICATION_PATH}?generation=${encodeURIComponent(generation)}`, {
        redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      })
      if (!response.ok) return false
      const proof = await response.json() as Data
      return proof.hostname === hostname && proof.generation === generation && proof.challenge === challenge
    } catch { return false }
  }
}
