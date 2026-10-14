import { createPortability } from '@runeditrun/rer/modules/portability'

// Capture the whole set, not just its size: a transfer can be replaced while
// erasure is being prepared. These are read-only queries until save's batch.
const inventory = `SELECT
  (SELECT json_group_array(name) FROM (SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'rer_portability_snap_*' OR name GLOB 'rer_portability_stage_*') ORDER BY name)) AS copies,
  (SELECT json_group_array(id) FROM (SELECT id FROM rer_portability_jobs ORDER BY id)) AS jobs,
  (SELECT json_group_array(json_object('source',source_identity,'epoch',epoch,'import',import_job,'applying',applying)) FROM rer_portability_state) AS state`

/** Erasure invalidates all transient archives in the same fenced record save. */
export async function erasureTransfers(db: D1Database): Promise<D1PreparedStatement[]> {
  const seen = await db.prepare(inventory).first<{ copies: string; jobs: string; state: string }>()
  // Only use Base's public invalidation API. Constructing the service reads the
  // catalogue; it does not initialize state or run an export/import operation.
  const portability = await createPortability({ db, policy: { product: 'just-every/hiring-lodge' } })
  const cleanup = await portability.invalidateTransfersStatements()
  return [
    db.prepare(`INSERT INTO l_guard SELECT CASE WHEN (SELECT copies=? AND jobs=? AND state=? FROM (${inventory})) THEN 1 ELSE 0 END`).bind(seen!.copies, seen!.jobs, seen!.state),
    db.prepare('INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,?)').bind(crypto.randomUUID()),
    // An export that read the old state but has not snapshotted yet must fail
    // Base's epoch guard. Do not journal the candidate key: its safe tombstone
    // deliberately retains that key and must remain restorable in new archives.
    db.prepare('UPDATE rer_portability_state SET epoch=epoch+1 WHERE id=1'),
    db.prepare('INSERT INTO rer_portability_epochs SELECT source_identity,epoch FROM rer_portability_state WHERE id=1 ON CONFLICT(source) DO UPDATE SET epoch=MAX(epoch,excluded.epoch)'),
    ...cleanup,
  ]
}
