import type { D1Sql, D1TargetAdapter, TargetRow } from '../../modules/import-kit/src/d1/index'

// Base import-kit's native target for Lodge: imported effects are ordinary
// l_records rows, and a document's bytes are its 'blob' row, written and
// removed in the same batch. Snapshots compare the exact stored JSON and
// revision, so any later edit (even one keeping the revision) is detected.

const sql = (text: string, ...params: unknown[]): D1Sql => ({ sql: text, params })
const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []

interface NativeSnapshot { value: string; blob: { value: string; revision: string } | null }
// Keep the native representation beside the portable target; it is transaction
// evidence, not a new field in Base's retained target schema.
const snapshots = new WeakMap<TargetRow, NativeSnapshot>()

async function blob(db: any, id: string) {
  const row = await db.prepare("SELECT value,revision FROM l_records WHERE kind='blob' AND id=?").bind(id).first()
  return row as { value: string; revision: string } | null
}

function toRow(destination: string, r: { kind: string; id: string; revision: string; value: string }, storedBlob: { value: string; revision: string } | null = null): TargetRow {
  const value = JSON.parse(r.value)
  const attachment = storedBlob ? JSON.parse(storedBlob.value) : null
  const row = { destination, targetKind: r.kind, targetId: r.id, revision: r.revision, value, ...(attachment ? { attachment: { base64: attachment.base64, mediaType: attachment.mediaType, sha256: value.sha256 } } : {}) }
  snapshots.set(row, { value: r.value, blob: storedBlob })
  return row
}

const blobJson = (row: TargetRow) => JSON.stringify({ base64: row.attachment!.base64, mediaType: row.attachment!.mediaType })

export const lodgeTargets: D1TargetAdapter = {
  async read(db, destination, kind, id) {
    const r = await db.prepare('SELECT kind,id,revision,value FROM l_records WHERE kind=? AND id=?').bind(kind, id).first<{ kind: string; id: string; revision: string; value: string }>()
    if (!r) return undefined
    return toRow(destination, r, kind === 'document' ? await blob(db, id) : null)
  },
  matches(row, _destination, kind, id) {
    if (!row) return sql('NOT EXISTS(SELECT 1 FROM l_records WHERE kind=? AND id=?)', kind, id)
    const native = snapshots.get(row)
    const value = native?.value ?? JSON.stringify(row.value)
    const record = 'EXISTS(SELECT 1 FROM l_records WHERE kind=? AND id=? AND revision=? AND value=?)'
    if (!row.attachment) return sql(`(${record} AND NOT EXISTS(SELECT 1 FROM l_records WHERE kind='blob' AND id=?))`, kind, id, row.revision, value, id)
    if (native?.blob) return sql(`(${record} AND EXISTS(SELECT 1 FROM l_records WHERE kind='blob' AND id=? AND revision=? AND value=?))`, kind, id, row.revision, value, id, native.blob.revision, native.blob.value)
    return sql(`(${record} AND EXISTS(SELECT 1 FROM l_records WHERE kind='blob' AND id=? AND value=?))`, kind, id, row.revision, value, id, blobJson(row))
  },
  matchesMany(rows, destination) {
    return [this.matchesCount!(rows.length, destination), ...rows.map(r => this.matches(r, destination, r.targetKind, r.targetId))]
  },
  matchesCount(count) {
    return sql("(SELECT COUNT(*) FROM l_records WHERE kind <> 'blob')=?", count)
  },
  write(row) {
    const statements = [sql('INSERT INTO l_records(kind,id,revision,value) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,value=excluded.value', row.targetKind, row.targetId, row.revision, JSON.stringify(row.value))]
    if (row.attachment) statements.push(sql("INSERT INTO l_records(kind,id,revision,value) VALUES('blob',?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,value=excluded.value", row.targetId, row.revision, blobJson(row)))
    return statements
  },
  remove(_destination, kind, id) {
    return [sql('DELETE FROM l_records WHERE kind=? AND id=?', kind, id), sql("DELETE FROM l_records WHERE kind='blob' AND id=? AND ?='document'", id, kind)]
  },
  async list(db, destination) {
    const { results } = await db.prepare("SELECT kind,id,revision,value FROM l_records WHERE kind <> 'blob' ORDER BY kind,id").all<{ kind: string; id: string; revision: string; value: string }>()
    const rows: TargetRow[] = []
    for (const r of results) rows.push(toRow(destination, r, r.kind === 'document' ? await blob(db, r.id) : null))
    return rows
  },
  /**
   * Conflict-preserving undo: an imported record that a person edited, or that
   * a native record still refers to (a stage move, a scorecard, a merged
   * candidate), is retained with its reason instead of silently deleted.
   */
  async preparePreservedUndo(db, destination, effects) {
    const rows = await this.list(db, destination)
    const byKey = new Map(rows.map(r => [r.targetKind + ':' + r.targetId, r]))
    const effectByTarget = new Map(effects.map(e => [e.expected.targetId, e.provenance.id]))
    const dependencies = effects.flatMap(e => rows
      .filter(r => r.targetId !== e.expected.targetId && r.targetKind !== 'audit' && strings(r.value).includes(e.expected.targetId))
      .map(r => ({
        requiredEffectId: e.provenance.id,
        ...(effectByTarget.has(r.targetId) ? { dependentEffectId: effectByTarget.get(r.targetId) } : {}),
        cause: { table: 'l_records', recordId: r.targetId, field: r.targetKind },
        evidence: { reason: 'Another record still refers to this imported record', kind: r.targetKind, id: r.targetId },
      })))
    return {
      observations: effects.map(e => ({ effectId: e.provenance.id, current: byKey.get(e.expected.targetKind + ':' + e.expected.targetId) ?? null, entity: { table: 'l_records', recordId: e.expected.targetId, field: e.expected.targetKind }, evidence: { reason: 'Complete current record snapshot' } })),
      nativeRows: rows, dependencies, guards: this.matchesMany!(rows, destination),
    }
  },
}
