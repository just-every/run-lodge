import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const recordSnapshot = async h => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results

/** Include transient copies and archive bytes when proving erasure rollback. */
export async function transferSnapshot(h) {
 const tables=(await h.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name GLOB 'rer_portability_*' ORDER BY name").all()).results
 const snapshot=[]
 // Hundreds of simultaneous D1 proxy requests exhaust workerd's local bridge.
 // Read the identical snapshot in order; every rollback assertion stays intact.
 for(const table of tables) snapshot.push({...table,rows:(await h.db.prepare('SELECT * FROM "'+table.name.replaceAll('"','""')+'"').all()).results.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})
 return snapshot
}

/** Prepare with a real native session, pause, then use the actual D1 commit.
 * This deterministically exercises the interleaving that HTTP timing cannot guarantee. */
export async function transactions(h) {
 const dir = await mkdtemp(join(tmpdir(), 'lodge-record-race-'))
 try {
  const bundle = await build({ stdin: { contents: "export {load,actorFor,save} from './src/lodge/core/store'; export {run} from './src/lodge/commands'; export {deleteCandidate} from './src/lodge/records/retention'; export {erasureTransfers} from './src/lodge/records/erasure-transfers'; export {lodgeTargets} from './src/lodge/move-in/target';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent' })
  const file = join(dir, 'core.mjs'); await writeFile(file, bundle.outputFiles[0].text)
  const core = await import(pathToFileURL(file).href)
  return {
   ...core,
   async prepare(op, input, email = 'owner@example.test') {
    const native = await h.db.prepare('SELECT o.id,o.email,o.display_name AS displayName,o.role,o.version,se.id AS session FROM oa_operators o JOIN oa_sessions se ON se.operator_id=o.id WHERE o.email=? AND se.revoked_at IS NULL').bind(email).first()
    const state = await core.load(h.db), actor = core.actorFor({ id: native.session, operator: native }, state)
    const result = op === 'delete-candidate' ? await core.deleteCandidate(state, actor, input) : await core.run(state, actor, op, input)
    const extra = op === 'delete-candidate' ? await core.erasureTransfers(h.db) : []
    return { state, actor, result, extra }
   },
   async refuse(pending) {
    const before = await recordSnapshot(h)
    const transfers = pending.extra.length ? await transferSnapshot(h) : null
    await assert.rejects(() => core.save(h.db, pending.state, pending.actor, pending.extra), e => e.status === 409)
    assert.deepEqual(await recordSnapshot(h), before, 'conflict rolls back every row, blob, receipt and audit')
    if (transfers) assert.deepEqual(await transferSnapshot(h), transfers, 'conflict preserves transfer state, copies, jobs and stored archive bytes')
   },
   async close() { await rm(dir, { recursive: true, force: true }) },
  }
 } catch(e) { await rm(dir, { recursive: true, force: true }); throw e }
}
