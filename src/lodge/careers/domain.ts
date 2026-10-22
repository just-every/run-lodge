import { requireAdmin } from '../core/access'
import { authority, load, save } from '../core/store'
import type { State } from '../core/state'
import { Fault, now, requireThat, uid, type Actor, type Data } from '../core/types'
import { CAREERS_VERIFICATION_PATH, CareersDomainProvider, careersDomainAvailable, careersHostname, type CareersDomainBindings, type DomainAssociation } from './domain-provider'

export interface CareersDomainEnvironment extends CareersDomainBindings { DB: D1Database }
export type CareersDomainAction = 'verify' | 'connect' | 'disconnect'
const KIND = 'careers-domain', ID = 'main'
const record = (s: State) => s.find(KIND, ID)
const busy = (r: Data) => !!r.operation && Date.parse(r.operation.until) > Date.now()

function admin(s: State, a: Actor) {
  requireAdmin(a)
  requireThat(!a.agent, 'A person must connect or disconnect a careers domain', 403)
  const member = s.get('member', a.email, 'member')
  requireThat(member.active && !member.agent && (a.owner || member.roles?.includes('admin')), 'An active owner or hiring admin must manage the careers domain', 403)
}

function available(env: CareersDomainBindings) {
  requireThat(careersDomainAvailable(env), 'Custom careers domains are not configured for this installation', 503)
}

function view(r: Data | undefined) {
  if (!r) return null
  return {
    hostname: r.hostname, generation: r.generation, status: r.status,
    dns: { name: `_lodge-careers.${r.hostname}`, type: 'TXT', value: r.challenge },
    verificationPath: CAREERS_VERIFICATION_PATH,
    providerStatus: r.providerStatus, tlsStatus: r.tlsStatus,
    tlsCheckedAt: r.tlsCheckedAt ?? null, renewal: 'Cloudflare-managed',
    verifiedAt: r.verifiedAt ?? null, error: r.error ?? null,
    ...(r.operation ? { operation: r.operation.action } : {}),
  }
}

/** Project only public configuration and status; binding values never enter State. */
export function careersDomainView(s: State, a: Actor, env: CareersDomainBindings) {
  if (a.agent || !(a.owner || a.roles.includes('admin'))) return { setupAvailable: false, domain: null }
  if (!s.find('business', 'main')) return { setupAvailable: careersDomainAvailable(env), domain: null }
  admin(s, a)
  return { setupAvailable: careersDomainAvailable(env), domain: view(record(s)) }
}

/** Normal command: caller saves this State with the actor's live session fence. */
export function careersDomainChallenge(s: State, a: Actor, b: Data, env: CareersDomainBindings) {
  admin(s, a); available(env)
  const hostname = careersHostname(b.hostname, env.AUTH_ORIGIN), current = record(s)
  if (current && current.status !== 'disconnected') {
    requireThat(current.hostname === hostname, 'Disconnect the current careers domain before choosing another', 409)
    requireThat(!busy(current), 'A careers domain operation is already running; refresh its status', 409)
    return view(current)
  }
  const challenge = [...crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const result = s.put(KIND, ID, {
    hostname, generation: uid(), challenge, status: 'pending', providerStatus: 'not-attached', tlsStatus: 'pending',
    createdAt: now(), createdBy: a.email, error: null,
  })
  s.audit(a, 'careers-domain-challenge', `${KIND}:${ID}`, { hostname })
  return view(result)
}

/** Routing admission is independent of the request's Host header alone. Root
 * must send admitted hosts only to public careers routes and the proof below. */
export function careersHost(s: State, hostname: string) {
  const r = record(s)
  return !!r && r.hostname === hostname.toLowerCase() && !!r.verifiedAt && !!r.domainId && r.providerStatus === 'attached' && ['connecting', 'connected'].includes(r.status)
}

export function careersDomainProbe(s: State, request: Request): Response | null {
  const url = new URL(request.url)
  if (url.pathname !== CAREERS_VERIFICATION_PATH) return null
  const r = record(s)
  if (request.method !== 'GET' || url.protocol !== 'https:' || !r || !careersHost(s, url.hostname) || url.searchParams.get('generation') !== r.generation) return new Response('Not found', { status: 404 })
  return Response.json({ hostname: r.hostname, generation: r.generation, challenge: r.challenge }, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}

function sameTarget(r: Data, provider: CareersDomainProvider) {
  const target = provider.target()
  requireThat(!r.target || (r.target.accountId === target.accountId && r.target.zoneId === target.zoneId && r.target.worker === target.worker), 'The installation domain target changed; restore its original configuration before continuing', 409)
}

/** Provider work owns its transactions. Do not run through the ordinary
 * commands/run + save path: the intent must commit before a network mutation.
 * Each operation has an exclusive lease, a fresh generation, live authorization
 * checks immediately before provider writes and a fenced completion. */
export async function careersDomainOperation(env: CareersDomainEnvironment, a: Actor, action: CareersDomainAction, b: Data) {
  requireThat(['verify', 'connect', 'disconnect'].includes(action), 'Unknown careers domain operation', 404)
  const start = await load(env.DB)
  admin(start, a); available(env)
  const initial = start.get(KIND, ID, 'careers domain')
  requireThat(typeof b.generation === 'string' && b.generation === initial.generation, 'The careers domain changed; refresh before continuing', 409)
  requireThat(!busy(initial), 'A careers domain operation is already running; refresh its status', 409)
  requireThat(initial.status !== 'disconnected', 'Create a DNS challenge before connecting a careers domain', 409)
  careersHostname(initial.hostname, env.AUTH_ORIGIN)
  const provider = new CareersDomainProvider(env)
  sameTarget(initial, provider)
  const operationId = uid(), generation = uid()
  start.put(KIND, ID, { ...initial, generation, error: null, ...(action !== 'disconnect' ? { verifiedAt: null, status: 'pending', tlsStatus: 'pending' } : {}), operation: { id: operationId, action, until: new Date(Date.now() + 120_000).toISOString() } })
  start.audit(a, 'careers-domain-' + action + '-started', `${KIND}:${ID}`, { hostname: initial.hostname })
  await save(env.DB, start, a)

  // Reload, do not use an old State after awaiting a provider. This also fences
  // membership changes independently of the Actor supplied by the HTTP route.
  async function current() {
    const s = await load(env.DB)
    admin(s, a)
    const r = s.get(KIND, ID)
    requireThat(r.generation === generation && r.operation?.id === operationId && busy(r), 'The careers domain operation expired or changed; refresh before continuing', 409)
    const auth = authority(a)
    const live = await env.DB.prepare(`SELECT (${auth.sql}) AS live`).bind(...auth.params).first<{ live: number }>()
    requireThat(live?.live === 1, 'Your Lodge access changed; sign in again before continuing', 403)
    return { s, r }
  }

  async function update(patch: Data, complete = false) {
    const { s, r } = await current()
    const next = s.put(KIND, ID, { ...r, ...patch, ...(complete ? { operation: null } : {}) })
    if (complete) s.audit(a, 'careers-domain-' + action, `${KIND}:${ID}`, { hostname: r.hostname, status: next.status, providerStatus: next.providerStatus, tlsStatus: next.tlsStatus })
    await save(env.DB, s, a)
    return next
  }

  async function attached(association: DomainAssociation) {
    return update({ domainId: association.id, certificateId: association.certificateId, target: provider.target(), providerStatus: 'attached', status: 'connecting', tlsStatus: 'pending' })
  }

  try {
    let { r } = await current()
    if (action === 'disconnect') {
      // Disable host admission before the external deletion, even if it fails.
      await update({ status: 'disconnecting', tlsStatus: 'pending' })
      await provider.zone(r.hostname)
      const rows = await provider.domains(r.hostname)
      if (rows.length) {
        requireThat(rows.length === 1 && (r.domainId === rows[0].id || r.attachAttempted === true), 'This hostname has no saved association owned by Lodge; no domain was removed', 409)
        await provider.detach(r.hostname, rows[0].id, current)
      }
      r = await update({ status: 'disconnected', providerStatus: 'not-attached', domainId: null, certificateId: null, verifiedAt: null, error: null }, true)
      return view(r)
    }

    await provider.zone(r.hostname)
    await provider.verifyTXT(`_lodge-careers.${r.hostname}`, r.challenge)
    r = await update({ verifiedAt: now(), error: null })
    if (action === 'verify') {
      if (r.domainId) {
        const association = await provider.readback(r.hostname, r.domainId)
        r = await attached(association)
        const ready = await provider.httpsReady(r.hostname, generation, r.challenge)
        r = await update({ status: ready ? 'connected' : 'connecting', tlsStatus: ready ? 'ready' : 'pending', tlsCheckedAt: now() }, true)
      } else r = await update({ status: 'verified', tlsStatus: 'pending' }, true)
      return view(r)
    }

    let association = await provider.preflight(r.hostname, r.domainId, r.attachAttempted === true)
    if (!association) {
      // Persist intent before PUT. A dropped response can then be reconciled
      // without blindly replacing another Worker's domain assignment.
      await update({ attachAttempted: true, target: provider.target(), providerStatus: 'pending', status: 'connecting', tlsStatus: 'pending' })
      await current()
      association = await provider.attach(r.hostname)
      await update({ domainId: association.id, certificateId: association.certificateId })
    }
    association = await provider.readback(r.hostname, association.id)
    r = await attached(association)
    const ready = await provider.httpsReady(r.hostname, generation, r.challenge)
    r = await update({ status: ready ? 'connected' : 'connecting', tlsStatus: ready ? 'ready' : 'pending', tlsCheckedAt: now() }, true)
    return view(r)
  } catch (error) {
    // Only our fixed Fault messages can be reported. Never serialize an SDK,
    // fetch error, provider body, or token-bearing request into State/audit.
    const message = error instanceof Fault ? error.message : 'The domain operation could not complete; refresh and check its configuration'
    try { await update({ error: message, tlsStatus: 'pending', ...(action === 'disconnect' ? { status: 'disconnecting' } : {}) }, true) } catch { /* A newer generation or revoked authority must remain untouched. */ }
    throw new Fault(error instanceof Fault ? error.status : 502, message)
  }
}
