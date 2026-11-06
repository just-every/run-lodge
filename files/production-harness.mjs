// One-off emitted-Worker adaptation of the existing disposable HTTP fixture.
// The installation is local, unsigned by any production credential, and removed
// on close. Native routes, auth, migrations and asset bytes are unchanged.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd(), require = createRequire(join(root, 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(require.resolve('miniflare')))
const { unstable_splitSqlQuery } = await import(pathToFileURL(require.resolve('wrangler')))
const { BUSINESS } = await import(pathToFileURL(join(root, 'tests/harness.mjs')))

export async function businessHarness({ bindings = {}, outboundService } = {}) {
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const origin = 'http://127.0.0.1:' + port, dir = await mkdtemp(join(tmpdir(), 'lodge-production-'))
  const setupToken = randomBytes(32).toString('base64url')
  const serverFiles = (await readdir(join(root, 'dist/server'), { recursive: true })).filter(path => /\.(mjs|js)$/.test(path))
  serverFiles.sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b))
  const mf = new Miniflare({ ...convertV4MiniflareOptions({
    name: 'hiring-lodge', host: '127.0.0.1', port, modulesRoot: join(root, 'dist/server'),
    modules: serverFiles.map(path => ({ type: 'ESModule', path: join(root, 'dist/server', path) })),
    compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    d1Databases: { DB: 'lodge' }, outboundService,
    assets: { directory: join(root, 'dist/client'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } },
    bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: ['owner', 'example.test'].join('@'),
      SESSION_SECRET: randomBytes(32).toString('base64url'), INSTALLATION_KEY: randomBytes(32).toString('base64'), SETUP_TOKEN: setupToken,
      MAIL_PROVIDER: 'development', MAIL_FROM: ['lodge', 'example.test'].join('@'), ...bindings },
  }), resourcePersistencePath: dir })
  try {
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir(join(root, 'migrations/core'))).filter(file => file.endsWith('.sql')).sort())
      await db.batch(unstable_splitSqlQuery(await readFile(join(root, 'migrations/core', file), 'utf8')).map(sql => db.prepare(sql)))
    const send = async (path, body, cookie = '', extra = {}) => {
      const response = await mf.dispatchFetch(origin + path, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
        headers: { Origin: origin, Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      let value; try { value = JSON.parse(text) } catch { value = text }
      return { status: response.status, value, headers: response.headers,
        cookie: response.headers.getSetCookie().map(row => row.split(';')[0]).join('; ') }
    }
    const claimed = await send('/auth/bootstrap', { token: setupToken, displayName: 'Olive Owner' })
    assert.equal(claimed.status, 303, 'Bootstrap refused: ' + JSON.stringify(claimed.value))
    const owner = claimed.cookie
    const setup = await mf.dispatchFetch(origin + '/setup', { method: 'POST', redirect: 'manual',
      headers: { Origin: origin, Cookie: owner, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes' })
    assert.equal(setup.status, 303); await setup.body?.cancel()
    const command = async (op, body, cookie = owner) => {
      const result = await send('/api/lodge/command/' + op, body, cookie)
      assert.equal(result.status, 200, 'Native fixture command refused: ' + op)
      return result.value
    }
    const state = async () => {
      const result = await send('/api/lodge/state', undefined, owner)
      assert.equal(result.status, 200); return result.value
    }
    await command('business', BUSINESS)
    return { mf, db, origin, owner, send, command, state,
      close: async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }) } }
  } catch (error) {
    await mf.dispose(); await rm(dir, { recursive: true, force: true }); throw error
  }
}
