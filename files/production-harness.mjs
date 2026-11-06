import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'

const root = process.cwd()
const load = file => import(pathToFileURL(join(root, file)))
const { Miniflare, convertV4MiniflareOptions } = await load('node_modules/miniflare/dist/src/index.js')
const { unstable_splitSqlQuery } = await load('node_modules/wrangler/wrangler-dist/cli.js')
const { BUSINESS } = await load('tests/harness.mjs')

// Disposable fixture using the current emitted production Worker and assets.
// The existing public bootstrap and fixture commands establish every record.
export async function businessHarness({ bindings, outboundService }) {
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const origin = 'http://127.0.0.1:' + port
  const directory = await mkdtemp(join(tmpdir(), 'lodge-f57-'))
  const email = ['synthetic-lodge-57', 'example.invalid'].join(String.fromCharCode(64))
  const setupToken = 'synthetic-lodge-57-setup-' + randomUUID()
  const options = convertV4MiniflareOptions({ host: '127.0.0.1', port, cf: false,
    modules: [{ type: 'ESModule', path: join(root, 'dist/server/index.js') },
      ...(await readdir('dist/server/assets')).filter(f => /\.m?js$/.test(f)).map(f => ({ type: 'ESModule', path: join(root, 'dist/server/assets', f) }))],
    modulesRoot: join(root, 'dist/server'), compatibilityDate: '2026-09-08',
    compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'], outboundService,
    d1Databases: { DB: 'lodge' },
    assets: { directory: join(root, 'dist/client'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } },
    bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: email,
      SESSION_SECRET: 'synthetic-lodge-57-session-' + randomUUID(), SETUP_TOKEN: setupToken,
      MAIL_PROVIDER: 'development', MAIL_FROM: email, ...bindings },
  })
  options.resourcePersistencePath = directory
  const mf = new Miniflare(options)
  try {
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort())
      await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(sql => db.prepare(sql)))
    const send = async (path, body, cookie = '', extra = {}) => {
      const response = await mf.dispatchFetch(origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
        headers: { Origin: origin, Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      let value; try { value = JSON.parse(text) } catch { value = text }
      return { status: response.status, value, text, headers: response.headers,
        cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') }
    }
    const boot = await send('/auth/bootstrap', { token: setupToken, displayName: 'Synthetic owner' })
    assert.equal(boot.status, 303, 'production owner bootstrap redirects into the signed-in installation')
    const owner = boot.cookie
    assert.ok(owner)
    const command = async (op, body) => {
      const result = await send('/api/lodge/command/' + op, body, owner)
      assert.equal(result.status, 200, 'native fixture command ' + op + ': ' + result.status)
      return result.value
    }
    const state = async () => {
      const result = await send('/api/lodge/state', undefined, owner)
      assert.equal(result.status, 200)
      return result.value
    }
    await command('business', { ...BUSINESS, name: 'Synthetic Lodge qualification', accommodationContact: email })
    const setup = await mf.dispatchFetch(origin + '/setup', { method: 'POST', redirect: 'manual',
      headers: { Origin: origin, Cookie: owner, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ confirm: 'yes', displayName: 'Synthetic owner' }).toString() })
    assert.equal(setup.status, 303, 'native installation setup')
    await setup.body?.cancel()
    return { mf, db, origin, owner, send, command, state, async close() { await mf.dispose(); await rm(directory, { recursive: true, force: true }) } }
  } catch (error) {
    await mf.dispose(); await rm(directory, { recursive: true, force: true }); throw error
  }
}
