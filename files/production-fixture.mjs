import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID, randomBytes, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function productionFixture(root) {
  const load = path => import(pathToFileURL(resolve(root, path)))
  const require = createRequire(resolve(root, 'package.json'))
  const cli = resolve(require.resolve('@runeditrun/rer/package.json'), '../cli/hosted-output.mjs')
  const { serveHosted, HOSTED_ORIGIN } = await import(pathToFileURL(cli))
  const { signJws, seconds } = await load('src/modules/agent-door/conformance/crypto.mjs')
  const { createProtocol } = await load('src/modules/agent-door/conformance/protocol.mjs')
  const { default: initializeOwner } = await load('tests/initialize-agent-owner.mjs')
  const { default: initializeAgent } = await load('tests/initialize-agent.mjs')
  const { default: prepareFixtures } = await load('tests/agent-phase-fixtures.mjs')
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = randomUUID(), installationId = randomUUID(), sub = randomUUID()
  const issuer = 'https://synthetic-lodge-62.invalid', business = 'synthetic-lodge-62'
  const email = ['synthetic-lodge-62', 'example.invalid'].join(String.fromCharCode(64))
  const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', pair.publicKey) }
  let providerCalls = 0
  const hosted = await serveHosted(root, { bindings: {
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_APP_ORIGIN: HOSTED_ORIGIN, RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
    OWNER_EMAIL: email, SESSION_SECRET: randomBytes(32).toString('hex'),
  }, outboundService: async () => { providerCalls++; return new Response('unexpected outbound request', { status: 503 }) } })
  try {
    const origin = hosted.origin
    const request = (absolute, init = {}) => {
      const url = new URL(absolute)
      assert.equal(url.origin, origin)
      return hosted.fetch(url.href.slice(origin.length + 1), { ...init,
        signal: AbortSignal.timeout(30000), headers: Object.fromEntries(new Headers(init.headers)),
      })
    }
    const claim = await signJws(pair.privateKey, kid, 'rer-owner-claim+jwt', {
      v: 1, iss: issuer, aud: origin, installationId, email, jti: randomUUID(), iat: seconds(), exp: seconds() + 300,
    })
    const bootstrap = await initializeOwner({ request, origin, email, displayName: 'Synthetic Lodge owner',
      claim: { path: '/auth/owner-claim', token: claim }, returnTo: '/app', reviewers: {},
    })
    assert.equal(bootstrap.status, 303)
    const cookie = bootstrap.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert.ok(cookie)
    await bootstrap.body?.cancel()
    const settings = await signJws(pair.privateKey, kid, 'rer-business-settings+jwt', {
      v: 1, iss: issuer, aud: origin, sub: installationId, business, email, owner_id: sub,
      jti: randomUUID(), iat: seconds(), exp: seconds() + 300, rev: 1, values: {}, logo: null, team: null,
    })
    const paired = await request(origin + '/api/rer/business-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }),
    })
    assert.equal(paired.status, 200)
    assert.equal((await paired.json()).rev, 1)
    const ownerRequest = (absolute, init = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Origin', origin)
      headers.set('Cookie', cookie)
      return request(absolute, { ...init, headers })
    }
    const c = createProtocol({ fetch: request, origin,
      surface: JSON.parse(await readFile(resolve(root, 'agent-surface.json'), 'utf8')), points: [],
      signer: { issuer, installationId, kid, privateKey: pair.privateKey },
      person: { email, sub, cookie }, business, agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0,
    })
    await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin, email })
    const db = await hosted.database('DB')
    const select = async sql => (await db.prepare(sql).all()).results
    const state = async () => {
      const response = await ownerRequest(origin + '/api/lodge/state')
      assert.equal(response.status, 200)
      return response.json()
    }
    return { root, load, require, request, ownerRequest, origin, c, cookie, db, select, state,
      fixtures: phase => prepareFixtures({ request: ownerRequest, origin, cookie, email, phase }),
      get providerCalls() { return providerCalls }, close: () => hosted.close(),
    }
  } catch (error) { await hosted.close(); throw error }
}
