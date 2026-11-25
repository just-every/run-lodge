import { Fault, now, uid, type Actor, type Data } from './types'

export interface Row { kind: string; id: string; revision: string; value: Data }
const key = (kind: string, id: string) => kind + '\u0000' + id

/**
 * One request's view of the hiring records. Every record a command reads by id
 * is remembered with the revision it saw; saving fences those revisions and the
 * actor's session in the same D1 batch, so a decision made on stale data or by
 * a revoked session never commits.
 */
export class State {
  readonly resumeTexts = new Map<string, string>()
  artifactReader?: (id: string) => Promise<{ sha256: string; revision: string } | null>
  async artifactDigest(id: string) {
    const artifact = await this.artifactReader?.(id) ?? null
    const k = key('blob', id)
    if (!this.reads.has(k) && !this.changed.has(k)) this.reads.set(k, artifact?.revision ?? null)
    return artifact
  }
  applicationMailEpoch?: string
  original(kind: string, id: string) { return this.initialRows.find(r => r.kind === kind && r.id === id)?.value }

  private rows = new Map<string, Row>()
  private reads = new Map<string, string | null>()
  private changed = new Set<string>()

  private scans = new Map<string, number>()

  /**
   * `scope` names the only kinds this state holds. Reading another kind throws, so a
   * missed dependency fails loudly instead of answering as if the records did not exist;
   * save() runs no cross-record syncs for a scoped state, which cannot see the records they read.
   */
  constructor(private initialRows: Row[], readonly scope?: ReadonlySet<string>) {
    const rows = initialRows
    for (const row of rows) this.rows.set(key(row.kind, row.id), row)
  }

  private within(kind: string) {
    if (this.scope && !this.scope.has(kind)) throw new Error(`This request loaded only ${[...this.scope].join(', ')} records, not ${kind}`)
  }

  private track(kind: string, id: string) {
    const k = key(kind, id)
    if (!this.reads.has(k) && !this.changed.has(k)) this.reads.set(k, this.rows.get(k)?.revision ?? null)
    return this.rows.get(k)
  }

  find(kind: string, id: unknown): Data | undefined {
    this.within(kind)
    if (typeof id !== 'string' || !id) return undefined
    return this.track(kind, id)?.value
  }

  get(kind: string, id: unknown, label = kind): Data {
    const value = this.find(kind, id)
    if (!value) throw new Fault(404, `${label[0].toUpperCase() + label.slice(1)} not found`)
    return value
  }

  /** Untracked listing; commands that depend on a listed record read it with get(). */
  all(kind: string): Data[] {
    this.within(kind)
    const result: Data[] = []
    for (const row of this.rows.values()) if (row.kind === kind) result.push(row.value)
    return result
  }

  /** A decision over a whole set also fences absence: newly inserted rows
   * must invalidate it, even when none of the previously read rows changed. */
  scan(kind: string): Data[] {
    this.within(kind)
    if (!this.scans.has(kind)) {
      const original = this.initialRows.filter(row => row.kind === kind)
      this.scans.set(kind, original.length)
      for (const row of original) {
        const k = key(kind, row.id)
        if (!this.reads.has(k)) this.reads.set(k, row.revision)
      }
    }
    return this.all(kind)
  }

  put(kind: string, id: string, value: Data): Data {
    const k = key(kind, id)
    this.track(kind, id)
    const record = { ...value, id }
    this.rows.set(k, { kind, id, revision: this.rows.get(k)?.revision ?? '', value: record })
    this.changed.add(k)
    return record
  }

  remove(kind: string, id: string) {
    const k = key(kind, id)
    this.track(kind, id)
    this.rows.delete(k)
    this.changed.add(k)
  }

  /** Delete a record this request never loaded (document bytes), without a revision fence. */
  drop(kind: string, id: string) {
    const k = key(kind, id)
    this.rows.delete(k)
    this.changed.add(k)
  }

  audit(actor: Actor | null, action: string, record: string, detail: Data = {}) {
    const id = uid()
    this.put('audit', id, { at: now(), actor: actor?.id ?? 'public', email: actor?.email ?? 'public', action, record, ...detail, ...(actor?.door ? { agent: actor.door.agent, sponsor: actor.door.sponsor, preparedBy: actor.door.label } : {}) })
  }

  /** Changes and fences for the store, in a deterministic order. */
  pending() {
    const writes: { kind: string; id: string; value: Data | null }[] = []
    for (const k of this.changed) {
      const [kind, id] = k.split('\u0000')
      writes.push({ kind, id, value: this.rows.get(k)?.value ?? null })
    }
    const fences = [...this.reads].map(([k, revision]) => { const [kind, id] = k.split('\u0000'); return { kind, id, revision } })
    return { writes, fences, scans: [...this.scans].map(([kind, count]) => ({ kind, count })) }
  }

  /** An independent copy for dry runs; changes to it never reach the store. */
  clone() {
    const copy = new State([...this.rows.values()].map(r => ({ ...r, value: structuredClone(r.value) })), this.scope)
    for (const [id, value] of this.resumeTexts) copy.resumeTexts.set(id, value)
    copy.artifactReader = this.artifactReader
    return copy
  }

  revisionOf(kind: string, id: string) { return this.rows.get(key(kind, id))?.revision ?? null }
}
