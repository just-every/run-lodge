import { applyD1ImportBatches, createD1ImportJob, planD1Import, readD1ImportJob, readD1ImportOriginals, readD1ImportUndoReport, resumeD1Import, undoD1Import, type D1ImportContext, type ImportPlan } from '../../modules/import-kit/src/d1/index'
import type { State } from '../core/state'
import { authority } from '../core/store'
import { base64ToBytes, Fault, requireThat, text, type Actor, type Data } from '../core/types'
import { lodgeTargets } from './target'
import { MAPPING_VERSION, NAMESPACE, buildWorkable } from './workable'

// Workable move-in through Base import-kit's D1 journal: a preview that writes
// nothing, a commit bound to the exact previewed fingerprint, bounded batches
// with explicit resume, and conflict-preserving undo. Jobs belong to the owner
// who started them; every batch re-checks that owner's live session in SQL.

const context = (db: D1Database, a: Actor): D1ImportContext => ({
  destination: 'main', namespace: NAMESPACE, mappingVersion: MAPPING_VERSION, reversalPolicy: 'preserve-conflicts',
  storage: { database: db as any, targets: lodgeTargets },
  authorization: { principalId: a.id, predicate: () => authority(a, true) as any },
  batchSize: 50, maxBatches: 4,
})

function summary(plan: ImportPlan) {
  return {
    fingerprint: plan.fingerprint, counts: plan.counts,
    rejected: plan.entries.filter(e => e.rejection).map(e => ({ kind: e.source.kind, sourceId: e.source.sourceId, location: e.source.location, reason: e.rejection })),
    diagnostics: plan.diagnostics.map(d => ({ severity: d.severity, code: d.code, message: d.message })),
    artifacts: plan.source.artifacts.map(a => ({ name: a.name, sha256: a.sha256, size: a.size })),
  }
}

async function planFor(db: D1Database, a: Actor, b: Data, retainUntil: string) {
  const filename = text(b.filename, 'Package file name', 200)
  requireThat(typeof b.base64 === 'string' && b.base64.length > 0, 'Choose the Workable export ZIP')
  const built = await buildWorkable(filename, base64ToBytes(b.base64), retainUntil, new Date().toISOString().slice(0, 10))
  return { ...built, plan: await planD1Import(built.source, built.mapping, context(db, a)) }
}

const kitError = (error: unknown) => {
  if (error instanceof Fault) return error
  const message = String((error as Error)?.message ?? error)
  // Kit refusals are named conditions (changed authority, edits, busy targets), never retried here.
  return new Fault(409, 'The import could not continue: ' + message.split('\n')[0].slice(0, 300))
}

export async function imports(db: D1Database, a: Actor, op: string, b: Data, retainUntil: string) {
  requireThat(a.owner, 'Only the owner moves data in', 403)
  try {
    if (op === 'preview') {
      const { plan, report } = await planFor(db, a, b, retainUntil)
      return { plan: summary(plan), report }
    }
    if (op === 'commit') {
      const { plan, report } = await planFor(db, a, b, retainUntil)
      requireThat(b.fingerprint === plan.fingerprint, 'The package or mapping changed since your preview; preview it again', 409)
      const ctx = context(db, a)
      const job = await createD1ImportJob(plan, { ...ctx, reviewedFingerprint: b.fingerprint, operationKey: b.fingerprint })
      return { job: await applyD1ImportBatches(job.id, ctx), report }
    }
    requireThat(typeof b.id === 'string', 'Choose an import batch')
    const ctx = context(db, a)
    if (op === 'resume') return { job: await resumeD1Import(b.id, ctx) }
    if (op === 'undo') return { job: await undoD1Import(b.id, ctx) }
    if (op === 'status') {
      const originals = await readD1ImportOriginals(b.id, ctx)
      return {
        job: await readD1ImportJob(b.id, ctx), undo: await readD1ImportUndoReport(b.id, ctx),
        originals: originals.map(o => ({ kind: o.kind, name: o.name, sha256: o.sha256, size: o.size, status: o.original.status })),
      }
    }
  } catch (error) { throw kitError(error) }
  throw new Fault(404, 'Unknown import action')
}

/** The owner's batches, newest first, without plan contents; each named by the package and day its commit recorded. */
export async function importJobs(db: D1Database, a: Actor, s: State) {
  if (!a.owner) return []
  const { results } = await db.prepare("SELECT id,principal_id AS principalId,state,checkpoint,total,error FROM ik_jobs WHERE destination='main' AND namespace=? ORDER BY rowid DESC").bind(NAMESPACE).all<Data>()
  const commits = new Map(s.all('audit').filter(e => e.action === 'import-commit').map(e => [e.record.slice('import:'.length), e]))
  return results.map(j => ({ ...j, mine: j.principalId === a.id, package: commits.get(j.id)?.package ?? null, startedAt: commits.get(j.id)?.at ?? null }))
}
