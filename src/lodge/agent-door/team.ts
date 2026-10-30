import { operatorAuth, type Bindings } from '../../auth.server.ts'
import type { TeamAdapter } from '../../modules/business-settings/types.ts'
import { actorFor, load } from '../core/store.ts'
import { member } from '../records/people.ts'
import { uid } from '../core/types.ts'

/** Reconcile the signed roster through OA invitations and Lodge's real member service. */
export function lodgeTeam(env: Bindings): TeamAdapter {
  const native=operatorAuth(env).businessTeam!
  return {
    ownerEmail:()=>native.ownerEmail(),
    async prepare(input) {
      const state=await load(env.DB)
      const owner=await env.DB.prepare("SELECT id,email,display_name AS displayName,role,version FROM oa_operators WHERE role='owner' AND status='active' ORDER BY created_at,id LIMIT 1").first<{id:string;email:string;displayName:string;role:string;version:number}>()
      if(!owner || owner.email!==input.ownerEmail) throw Error('Native owner unavailable')
      const actor=actorFor({operator:owner,id:''},state)
      const conflicts=input.members.filter(m=>state.find('member',m.email) && !input.managed.some(row=>row.email===m.email&&row.operatorId))
      const plan=await native.prepare({...input,members:input.members.filter(m=>!conflicts.includes(m))})
      const statements=[...plan.statements]
      const guard=(sql:string,args:unknown[])=>env.DB.prepare(`INSERT INTO l_guard SELECT CASE WHEN (${input.guard.sql}) AND (${sql}) THEN 1 ELSE 0 END`).bind(...input.guard.args,...args)
      statements.push(guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND role='owner' AND status='active')",[owner.id,owner.version]))
      for(const row of plan.rows) {
        if(!row.operatorId || row.state==='conflict')continue
        const operator=await env.DB.prepare('SELECT email FROM oa_operators WHERE id=?').bind(row.operatorId).first<{email:string}>()
        const email=operator?.email??row.email,existing=state.find('member',email)
        const desired=input.members.find(m=>m.email===row.email)
        member(state,actor,{email,name:desired?.name??existing?.name??email,roles:desired?[desired.role==='admin'?'admin':'interviewer']:existing?.roles??['interviewer'],active:!!desired&&row.state!=='inactive',seePrivate:existing?.seePrivate===true})
      }
      const pending=state.pending()
      for(const fence of pending.fences) statements.push(guard('(SELECT revision FROM l_records WHERE kind=? AND id=?) IS ?',[fence.kind,fence.id,fence.revision]))
      for(const write of pending.writes) {
        statements.push(write.value?env.DB.prepare(`INSERT INTO l_records(kind,id,revision,value) SELECT ?,?,?,? WHERE ${input.guard.sql} ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,value=excluded.value`).bind(write.kind,write.id,uid(),JSON.stringify(write.value),...input.guard.args):env.DB.prepare(`DELETE FROM l_records WHERE kind=? AND id=? AND ${input.guard.sql}`).bind(write.kind,write.id,...input.guard.args))
      }
      statements.push(env.DB.prepare('DELETE FROM l_guard'))
      return {statements,rows:[...plan.rows,...conflicts.map(m=>({email:m.email,operatorId:null,invite:m.invite,state:'conflict' as const}))],afterCommit:plan.afterCommit}
    },
  }
}
