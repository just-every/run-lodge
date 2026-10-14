import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Pause between real command preparation and its real D1 transaction; no timed race or test-only application bypass. */
export async function checkRaces(h) {
 const dir = await mkdtemp(join(tmpdir(), 'lodge-race-'))
 try {
  const bundle = await build({ stdin: { contents: "export {load,actorFor,save} from './src/lodge/core/store'; export {run} from './src/lodge/commands';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent' })
  const file = join(dir, 'core.mjs'); await writeFile(file, bundle.outputFiles[0].text)
  const { load, actorFor, save, run } = await import(pathToFileURL(file).href)
  async function prepared(email, op, input) {
   const native = await h.db.prepare('SELECT o.id,o.email,o.display_name AS displayName,o.role,o.version,se.id AS session FROM oa_operators o JOIN oa_sessions se ON se.operator_id=o.id WHERE o.email=? AND se.revoked_at IS NULL').bind(email).first()
   const state = await load(h.db), actor = actorFor({ id: native.session, operator: native }, state)
   await run(state, actor, op, input)
   return { state, actor }
  }
  async function refuse(pending) {
   const before = (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
   await assert.rejects(() => save(h.db, pending.state, pending.actor), e => e.status === 409)
   assert.deepEqual((await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results, before, 'a refused commit rolls back all command rows and audits')
  }
  const input = { ...h.pendingVacancy, description: 'Must not commit after revocation' }
  for (const mutation of [{ roles: ['interviewer'] }, { roles: ['manager'], active: false }]) {
   const pending = await prepared('m1@example.test', 'vacancy', input)
   await h.command('member', { email: 'm1@example.test', name: 'Manager', ...mutation })
   await refuse(pending)
   await h.command('member', { email: 'm1@example.test', name: 'Manager', roles: ['manager'] })
  }
  const proposal = { workflow: 'prepare-vacancy', approver: 'm1@example.test', summary: 'Agent snapshot', sources: [{ kind: 'vacancy', id: h.pendingVacancy.id }], changes: [{ op: 'vacancy', input }] }
  for (const email of ['m1@example.test', 'agent@example.test']) {
   const pending = await prepared('agent@example.test', 'propose', proposal)
   const current = JSON.parse((await h.db.prepare("SELECT value FROM l_records WHERE kind='member' AND id=?").bind(email).first()).value)
   await h.command('member', { ...current, active: false })
   await refuse(pending)
   await h.command('member', { ...current, active: true })
  }
  // LDG-011: two drafts prepared from the same records for one application cannot both commit.
  const { application } = await h.command('candidate', { name: 'Race Candidate', email: 'race-candidate@example.test', source: 'Referral', consentBasis: 'referral', vacancy: h.vacancy.id }, h.manager)
  const draft = { application: application.id, salary: { currency: 'USD', amount: 150, period: 'year' }, startDate: '2026-12-10' }
  const first = await prepared('m1@example.test', 'offer', draft), second = await prepared('m1@example.test', 'offer', draft)
  await save(h.db, first.state, first.actor)
  await refuse(second)
  const sessionPending = await prepared('m1@example.test', 'vacancy', input)
  assert.equal((await h.send('/auth/session/revoke', { sessionId: sessionPending.actor.session }, h.owner)).status, 204)
  await refuse(sessionPending)
 } finally { await rm(dir, { recursive: true, force: true }) }
}
