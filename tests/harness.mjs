// Runs Lodge's Worker in real workerd with a persistent local D1 holding every
// migration. People sign in through operator-auth's real invitation and
// confirmation links, read from the test mail edge. No application
// code is faked; only the mail provider network edge is faked.
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

const SETUP_TOKEN = 'synthetic-local-test-setup-token-0123456789abcdef'

// Only the compiled source is shared. Bindings, sessions, migrations and D1
// remain private to each fixture. A new test process recompiles the candidate.
const bundles = new Map()
function workerBundle() {
  const root = process.cwd()
  if (!bundles.has(root)) bundles.set(root, build({ entryPoints: ['tests/lodge-worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], plugins: [{ name: 'mail-network-edge', setup(build) { build.onResolve({ filter: /mail\.server\.mjs$/ }, () => ({ path: join(root, 'tests/mail-edge.mjs') })) } }], external: ['node:*'], loader: { '.css': 'text' }, target: 'es2023', logLevel: 'error' }))
  return bundles.get(root)
}

async function freePort() {
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const { port } = socket.address()
  await new Promise(resolve => socket.close(resolve))
  return port
}

/** A Worker with every migration; `claim: false` leaves it empty, as a restore destination. */
export async function harness({ claim = true, bindings = {}, outboundService } = {}) {
  const port = await freePort(), origin = `http://127.0.0.1:${port}`
  const dir = await mkdtemp(join(tmpdir(), 'lodge-test-'))
  const bundle = await workerBundle()
  const mf = new Miniflare({
    ...convertV4MiniflareOptions({
      host: '127.0.0.1', port, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      d1Databases: { DB: 'lodge' },
      ...(outboundService ? { outboundService } : {}),
      bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: 'local-test-secret-not-production-0123456789', SETUP_TOKEN, MAIL_PROVIDER: 'development', MAIL_FROM: 'Lodge <lodge@example.test>', ...bindings },
    }),
    resourcePersistencePath: dir,
  })
  try {
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort())
      await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(sql => db.prepare(sql)))

    /** One HTTP request through the Worker; JSON bodies by default, a cookie for the person. */
    async function send(path, body, cookie = '', extra = {}) {
      const init = { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { origin, cookie, ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...extra } }
      if (body instanceof FormData) {
        // Encode the multipart body exactly as a browser would, boundary included.
        const encoded = new Request(origin, { method: 'POST', body })
        init.headers['content-type'] = encoded.headers.get('content-type')
        init.body = new Uint8Array(await encoded.arrayBuffer())
      } else if (body !== undefined) init.body = JSON.stringify(body)
      const r = await mf.dispatchFetch(origin + path, init)
      const text = await r.text()
      let value; try { value = JSON.parse(text) } catch { value = text }
      return { status: r.status, value, text, headers: r.headers, cookie: r.headers.getSetCookie?.().map(c => c.split(';')[0]).join('; ') }
    }
    const owner = claim ? (await send('/auth/bootstrap', { token: SETUP_TOKEN, displayName: 'Olive Owner' })).cookie : null
    if (claim) assert.ok(owner, 'the owner claimed the installation')

    async function command(op, body, cookie = owner, status = 200) {
      const r = await send('/api/lodge/command/' + op, body, cookie)
      assert.equal(r.status, status, `${op}: ${JSON.stringify(r.value)}`)
      return r.value
    }
    async function state(cookie = owner) {
      const r = await send('/api/lodge/state', undefined, cookie)
      assert.equal(r.status, 200, JSON.stringify(r.value))
      return r.value
    }
    /** Add a Lodge member, invite them, and follow the real emailed link to a session. */
    async function member(email, roles, name = email.split('@')[0], extra = {}) {
      await command('member', { email, name, roles, ...extra })
      assert.equal((await send('/api/lodge/invite', { email }, owner)).status, 200)
      const rows = await db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()
      const message = rows.results.map(r => JSON.parse(r.message)).find(m => m.to.includes(email))
      assert.ok(message, 'invitation reached the test mail edge')
      const token = new URL(message.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
      const confirmed = await send('/auth/confirm', { token })
      assert.equal(confirmed.status, 303, JSON.stringify(confirmed.value))
      return confirmed.cookie
    }
    /** An existing person signs in through the ordinary emailed link. */
    async function signIn(email) {
      assert.equal((await send('/auth/magic-link', { email })).status, 202)
      const rows = await db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()
      const message = rows.results.map(r => JSON.parse(r.message)).find(m => m.to.includes(email))
      const token = new URL(message.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
      const confirmed = await send('/auth/confirm', { token })
      assert.equal(confirmed.status, 303, JSON.stringify(confirmed.value))
      return confirmed.cookie
    }
    return { db, mf, origin, owner, send, command, state, member, signIn, async close() { await mf.dispose(); await rm(dir, { recursive: true, force: true }) } }
  } catch (error) {
    await mf.dispose(); await rm(dir, { recursive: true, force: true })
    throw error
  }
}

/** The owner's business settings, used by every suite. */
export const BUSINESS = { name: 'Example Builders', accommodationContact: 'adjustments@example.test', retentionDays: 365, jurisdiction: 'United States (New York office); legal review pending', timeZone: 'America/New_York', privacyNotice: 'We use your application only to assess you for this role and keep it for one year.' }

/** Fresh Worker/D1 and the common business settings, with cleanup on setup failure. */
export async function businessHarness(options) {
  const h = await harness(options)
  try {
    await h.command('business', BUSINESS)
    return h
  } catch (error) {
    await h.close()
    throw error
  }
}
