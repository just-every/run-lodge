import assert from 'node:assert/strict'
import { BUSINESS } from './harness.mjs'

// Synthetic responses exist only at Cloudflare/DNS/HTTPS network boundaries.
// The Worker, saved membership, D1 fences and HTTP routes remain real.
export const careersDomainBindings = {
  CAREERS_CF_API_TOKEN: 'synthetic-lodge-1000',
  CAREERS_CF_ACCOUNT_ID: 'synthetic-lodge-2',
  CAREERS_CF_ZONE_ID: 'synthetic-lodge-3',
  CAREERS_CF_WORKER: 'synthetic-lodge-4',
}
const hostname = 'careers.synthetic-lodge-5.example.com'
const zone = 'synthetic-lodge-5.example.com'

/** Pass edge.fetch as Miniflare's outboundService; assign edge.probe to dispatch
 * HTTPS requests back through the real Worker so readiness uses its real route. */
export function createCareersDomainEdge() {
  const edge = {
    calls: [], txt: null, domain: null, dnsConflict: false, foreignZone: false,
    httpsAvailable: false, failProvider: false, probe: null, beforePut: null, beforeDNS: null,
    async fetch(request) {
      const url = new URL(request.url), path = url.pathname
      edge.calls.push({ host: url.hostname, path, method: request.method })
      const json = (result, status = 200) => Response.json({ success: status < 400, result }, { status })
      if (url.hostname === 'cloudflare-dns.com') {
        if (edge.beforeDNS) await edge.beforeDNS()
        assert.equal(url.searchParams.get('name'), `_lodge-careers.${hostname}`)
        return Response.json({ Status: 0, Answer: edge.txt === null ? [] : [{ name: `_lodge-careers.${hostname}.`, type: 16, data: JSON.stringify(edge.txt) }] })
      }
      if (url.hostname === hostname) {
        if (!edge.httpsAvailable) return new Response('Certificate provisioning', { status: 503 })
        assert.ok(edge.probe, 'the HTTPS probe must use the real Worker route')
        return edge.probe(request)
      }
      assert.equal(url.hostname, 'api.cloudflare.com', 'no unexpected network destinations')
      assert.equal(request.headers.get('authorization'), `Bearer ${careersDomainBindings.CAREERS_CF_API_TOKEN}`)
      if (edge.failProvider) return Response.json({ success: false, errors: [{ message: careersDomainBindings.CAREERS_CF_API_TOKEN }] }, { status: 403 })
      if (path === '/client/v4/zones/synthetic-lodge-3') return json({ id: 'synthetic-lodge-3', name: zone, status: 'active', account: { id: edge.foreignZone ? 'synthetic-lodge-6' : 'synthetic-lodge-2' } })
      if (path.endsWith('/dns_records')) return json(edge.dnsConflict ? [{ name: hostname, type: 'CNAME', content: 'synthetic-lodge-7.example.com' }] : [])
      if (path.endsWith('/workers/routes')) return json([])
      if (path.endsWith('/workers/domains') && request.method === 'GET') return json(edge.domain ? [edge.domain] : [])
      if (path.endsWith('/workers/domains') && request.method === 'PUT') {
        if (edge.beforePut) await edge.beforePut()
        const body = await request.json()
        assert.deepEqual(body, { hostname, service: 'synthetic-lodge-4', environment: 'production', zone_id: 'synthetic-lodge-3' })
        edge.domain = { ...body, id: 'synthetic-lodge-8', cert_id: 'synthetic-lodge-9', enabled: true }
        return json(edge.domain)
      }
      if (path.endsWith('/workers/domains/synthetic-lodge-8') && request.method === 'GET') return edge.domain ? json(edge.domain) : json(null, 404)
      if (path.endsWith('/workers/domains/synthetic-lodge-8') && request.method === 'DELETE') { edge.domain = null; return json(null) }
      throw new Error('Unexpected synthetic domain edge request: ' + request.method + ' ' + path)
    },
  }
  return edge
}

/** Run against the ordinary, unconfigured installation harness. */
export async function checkCareersDomainUnavailable(h) {
  await h.command('business', BUSINESS)
  assert.equal((await h.state()).careers.setupAvailable, false)
  const response = await h.send('/api/lodge/command/careers-domain-challenge', { hostname }, h.owner)
  assert.equal(response.status, 503)
  assert.equal((await h.state()).careers.domain, null, 'a missing provider configuration never becomes a pretend connection')
}

/** One contract journey. Root supplies a configured harness and the network
 * edge above; this function owns neither their construction nor disposal. */
export async function checkCareersDomain(h, edge) {
  await h.command('business', BUSINESS)
  const send = (action, body, cookie = h.owner) => h.send('/api/lodge/command/careers-domain-' + action, body, cookie)
  const command = async (action, body, status = 200, cookie = h.owner) => {
    const response = await send(action, body, cookie)
    assert.equal(response.status, status, response.text)
    return response.value
  }
  const state = async () => (await h.state()).careers.domain
  const mutationCount = () => edge.calls.filter(c => ['PUT', 'DELETE'].includes(c.method)).length
  const host = (host, path = '/jobs') => h.mf.dispatchFetch('https://' + host + path)
  edge.probe = request => h.mf.dispatchFetch(request.url, { method: request.method })

  const manager = await h.member('synthetic-lodge-10@example.test', ['manager'])
  const admin = await h.member('synthetic-lodge-11@example.test', ['admin'])
  const agent = await h.member('synthetic-lodge-12@example.test', ['admin'], 'Domain proposer', { agent: true, actsFor: 'synthetic-lodge-11@example.test' })
  for (const cookie of [manager, agent]) await command('challenge', { hostname }, 403, cookie)
  for (const value of ['https://' + hostname, hostname + '/jobs', hostname + ':443', '*.' + hostname, '127.0.0.1', '-careers.example.com', new URL(h.origin).hostname]) await command('challenge', { hostname: value }, 400)

  const initial = await command('challenge', { hostname }, 200, admin)
  assert.deepEqual((await state()).dns, initial.dns, 'the shown challenge is the one saved for DNS verification')
  assert.equal(initial.dns.name, '_lodge-careers.' + hostname)
  assert.equal(initial.dns.type, 'TXT')
  assert.match(initial.dns.value, /^[a-f0-9]{48}$/)
  assert.equal((await command('challenge', { hostname: hostname.toUpperCase() })).dns.value, initial.dns.value, 'refreshing the challenge preserves the DNS record')
  await command('challenge', { hostname: 'other.' + zone }, 409)
  assert.equal((await host(hostname)).status, 404, 'unverified hosts cannot serve careers pages')
  assert.equal((await host(hostname, '/api/lodge/state')).status, 404, 'unverified hosts cannot reach private routes')
  const baseJobs = await h.send('/jobs')
  assert.equal(baseJobs.status, 200, 'the installation jobs door remains available')

  await command('verify', { generation: initial.generation }, 409)
  assert.equal(mutationCount(), 0, 'no DNS proof means no domain attachment')
  let saved = await state()
  edge.txt = initial.dns.value + 'extra'
  await command('connect', { generation: saved.generation }, 409)
  saved = await state()
  edge.txt = initial.dns.value
  edge.foreignZone = true
  await command('connect', { generation: saved.generation }, 409)
  assert.equal(mutationCount(), 0, 'TXT does not replace account and zone ownership')
  edge.foreignZone = false
  saved = await command('verify', { generation: (await state()).generation })
  assert.equal(saved.status, 'verified')
  await command('connect', { generation: initial.generation }, 409)
  edge.dnsConflict = true
  await command('connect', { generation: saved.generation }, 409)
  assert.equal(mutationCount(), 0, 'an existing DNS route is never overwritten')
  edge.dnsConflict = false
  saved = await state()
  edge.domain = { id: 'synthetic-lodge-8', hostname, service: 'synthetic-lodge-13', zone_id: 'synthetic-lodge-3', environment: 'production', enabled: true }
  await command('connect', { generation: saved.generation }, 409)
  assert.equal(mutationCount(), 0, 'another Worker assignment is never replaced')
  edge.domain = null

  saved = await command('connect', { generation: (await state()).generation })
  assert.equal(saved.providerStatus, 'attached')
  assert.equal(saved.tlsStatus, 'pending', 'an attach response never fabricates HTTPS readiness')
  assert.equal(saved.status, 'connecting')
  assert.equal(mutationCount(), 1)
  assert.equal((await host(hostname, '/api/lodge/state')).status, 404, 'a verified careers host still cannot reach private routes')
  assert.equal((await host(hostname, '/auth/magic-link')).status, 404)
  assert.equal((await host(hostname)).status, 200)
  edge.httpsAvailable = true
  saved = await command('verify', { generation: saved.generation })
  assert.equal(saved.tlsStatus, 'ready', 'HTTPS must answer this installation’s current generation and challenge')
  assert.equal(saved.status, 'connected')
  assert.equal(mutationCount(), 1, 'readiness checks do not repeat an attachment')
  const proof = await host(hostname, saved.verificationPath + '?generation=' + encodeURIComponent(saved.generation))
  assert.equal(proof.status, 200)
  assert.equal((await proof.json()).challenge, initial.dns.value)

  edge.failProvider = true
  await command('verify', { generation: saved.generation }, 502)
  const failed = await state()
  assert.equal(failed.tlsStatus, 'pending')
  assert.equal((await host(hostname)).status, 404, 'failed revalidation removes host admission')
  const persisted = await h.db.prepare("SELECT value FROM l_records WHERE kind IN ('careers-domain','audit')").all()
  assert.equal(JSON.stringify(persisted.results).includes(careersDomainBindings.CAREERS_CF_API_TOKEN), false, 'provider error bodies and credentials never reach records or audit exports')
  edge.failProvider = false
  saved = await command('verify', { generation: failed.generation })
  await command('disconnect', { generation: saved.generation }, 403, manager)
  saved = await command('disconnect', { generation: saved.generation }, 200, admin)
  assert.equal(saved.status, 'disconnected')
  assert.equal(edge.domain, null)
  assert.equal((await host(hostname)).status, 404)
  assert.equal((await h.send('/jobs')).status, 200)
  assert.equal((await host('unknown.' + zone, '/app')).status, 404)
  const fresh = await command('challenge', { hostname })
  assert.notEqual(fresh.generation, initial.generation)
  assert.notEqual(fresh.dns.value, initial.dns.value, 'reconnecting after disconnect requires a new DNS proof')
  await command('connect', { generation: saved.generation }, 409)
  edge.txt = fresh.dns.value
  const writesBeforeRevocation = mutationCount()
  edge.beforeDNS = async () => {
    edge.beforeDNS = null
    await command('connect', { generation: (await state()).generation }, 409)
    await h.command('member', { email: 'synthetic-lodge-11@example.test', name: 'Domain administrator', roles: ['admin'], active: false })
  }
  await command('connect', { generation: fresh.generation }, 403, admin)
  assert.equal(mutationCount(), writesBeforeRevocation, 'revoking the administrator during DNS lookup prevents the provider write')
  assert.equal((await host(hostname)).status, 404)
}
