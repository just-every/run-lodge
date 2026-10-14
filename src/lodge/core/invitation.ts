import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { authority } from './store'
import type { State } from './state'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { Fault, type Actor, type Data } from './types'

/** Keep Base's native invitation transaction, adding Lodge's saved authorization fences. */
export async function invite(request: Request, env: Bindings, state: State, actor: Actor, member: Data) {
  const db = env.DB
  const guarded = new Proxy(db, {
    get(target, property) {
      if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
        const auth = authority(actor)
        const guard = (sql: string, params: unknown[]) => db.prepare(`INSERT INTO l_guard SELECT CASE WHEN ${sql} THEN 1 ELSE 0 END`).bind(...params)
        const fences = state.pending().fences.map(f => guard('(SELECT revision FROM l_records WHERE kind=? AND id=?) IS ?', [f.kind, f.id, f.revision]))
        try {
          const results = await db.batch([guard(auth.sql, auth.params), ...fences, ...statements, db.prepare('DELETE FROM l_guard')])
          return results.slice(1 + fences.length, -1)
        } catch (error) {
          if (String(error).includes('CHECK constraint')) throw new Fault(409, 'Your access or the invitation changed; reload and try again')
          throw error
        }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  try { return await operatorAuth(runtimeBindings({ ...env, DB: guarded })).invite(request, { email: member.email, displayName: member.name, role: 'member', returnTo: '/app' }) }
  catch (error) { if (error instanceof AuthError) throw new Fault(error.status, 'Native invitation permission required'); throw error }
}
