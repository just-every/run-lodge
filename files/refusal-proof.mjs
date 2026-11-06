import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Run from the declared product checkout. The packet keeps only outcomes,
// never signed credentials, transient sessions or private fixture contents.
const root = process.cwd()
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const { checkAgentRefusals } = await import(pathToFileURL(join(root, 'tests/agent-refusal-flow.mjs')))
const started = new Date().toISOString()
const result = await checkAgentRefusals()
assert.equal(result.refusals.length, 16)
assert.equal(result.recoveries.length, 8)
assert.equal(result.providerAttempts, 0)
const receipt = { schema: 1, head, started, completed: new Date().toISOString(),
  door: 'Real workerd and migrated persistent local D1; authenticated native commands and signed MCP',
  result, exit: 0 }
await writeFile(join(dirname(fileURLToPath(import.meta.url)), 'refusal-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt, null, 2))
