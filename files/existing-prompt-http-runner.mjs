// One-off execution adapter outside the product tree. The existing journey and
// all its assertions are unchanged; requests use the same actual Worker port.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = resolve(process.env.LODGE_ROOT || process.cwd())
const require = createRequire(resolve(root, 'package.json'))
const { Miniflare } = require('miniflare')
const original = Miniflare.prototype.getD1Database
let requests = 0
Miniflare.prototype.getD1Database = async function (...args) {
  console.log('EXISTING_JOURNEY opening disposable D1')
  const db = await original.apply(this, args)
  console.log('EXISTING_JOURNEY disposable D1 ready')
  this.dispatchFetch = (url, init = {}) => {
    requests++
    return fetch(url, { ...init, redirect: init.redirect || 'manual', signal: AbortSignal.timeout(30000) })
  }
  return db
}
const { checkAgentPrompts } = await import(pathToFileURL(resolve(root, 'tests/agent-prompts-flow.mjs')))
try {
  await checkAgentPrompts()
  console.log('EXISTING_JOURNEY PASS: existing prompt and native-decision assertions unchanged; actual HTTP requests=' + requests)
} finally { Miniflare.prototype.getD1Database = original }
