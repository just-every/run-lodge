// Test-only D1 meter: counts the rows every statement reads, from D1's own
// meta.rows_read, so a read-budget test can hold a scheduled run or a routine
// poll to a ceiling. It wraps the Worker's DB binding; the application code
// is untouched and sees an ordinary D1Database.
type Stat = { calls: number; rows: number; writes: number }
const queries = new Map<string, Stat>()
const total = { calls: 0, rows: 0, writes: 0 }

function record(sql: string, meta: any) {
  const key = sql.replace(/\s+/g, ' ').trim().slice(0, 160)
  const q = queries.get(key) ?? { calls: 0, rows: 0, writes: 0 }
  q.calls++; q.rows += meta?.rows_read ?? 0; q.writes += meta?.rows_written ?? 0
  queries.set(key, q)
  total.calls++; total.rows += meta?.rows_read ?? 0; total.writes += meta?.rows_written ?? 0
}

function wrap(stmt: any, sql: string): any {
  return {
    _stmt: stmt,
    _sql: sql,
    bind: (...values: unknown[]) => wrap(stmt.bind(...values), sql),
    run: async () => { const r = await stmt.run(); record(sql, r.meta); return r },
    all: async () => { const r = await stmt.all(); record(sql, r.meta); return r },
    raw: async (options?: unknown) => { const r = await stmt.all(); record(sql, r.meta); return stmt.raw(options) },
    first: async (column?: string) => { const r = await stmt.all(); record(sql, r.meta); const row = r.results[0]; return !row ? null : column === undefined ? row : row[column] },
  }
}

export function meterBindings<T extends { DB: D1Database }>(env: T): T {
  const db = env.DB as any
  const DB = new Proxy(db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql)
    if (key === 'batch') return async (statements: any[]) => { const results = await target.batch(statements.map(s => s._stmt ?? s)); results.forEach((r: any, i: number) => record(statements[i]._sql ?? 'batch statement', r.meta)); return results }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return { ...env, DB }
}

/** The totals since the last reset, with the costliest statements first. */
export function meterReport(reset: boolean) {
  const top = [...queries].sort((a, b) => b[1].rows - a[1].rows).slice(0, 8).map(([sql, q]) => ({ sql, ...q }))
  const report = { ...total, top }
  if (reset) { queries.clear(); total.calls = total.rows = total.writes = 0 }
  return report
}
