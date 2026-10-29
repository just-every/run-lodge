import type { Bindings } from '../../auth.server.ts'
import type { ToolDefinition, ToolContext, JsonSchemaObject } from '../../modules/agent-door/types.ts'
import { ToolRefusal } from '../../modules/agent-door/errors.ts'
import { native, nativeContext } from './context.ts'
import { save } from '../core/store.ts'
import { run } from '../commands.ts'
import { workspace, workspaceRecords } from '../views/workspace.ts'
import { sourceRecord } from '../views/proposals.ts'
import { fieldResult } from '../views/fields.ts'
import { blindResult } from '../core/blind.ts'
import type { Data } from '../core/types.ts'

const proposalFields = { application:textSchema(), offer:textSchema(), brief:textSchema(), candidate:textSchema(), case:textSchema(), owner:textSchema(), nextAction:{type:'string'}, deadline:{type:'string'}, subject:{type:'string'}, body:{type:'string'}, claims:{type:'array',items:{type:'object'}}, outreach:{type:'object'}, cohort:{type:'object'}, findings:{type:'array',items:{type:'object'}}, measurement:{type:'object'}, uncertainty:{type:'string'}, sampleLimits:{type:'string'}, proposedChange:{type:'string'}, successCriterion:{type:'string'}, comparison:{type:'object'} }
function textSchema(){return {type:'string',minLength:1,maxLength:200}}
const empty: JsonSchemaObject = { type: 'object', properties: {}, additionalProperties: false }
const text = { type: 'string', minLength: 1, maxLength: 200 }
const kinds = ['vacancy', 'application', 'candidate', 'interview', 'interview-note', 'scorecard', 'document']
export const capabilities = ['tools', 'policy', 'pause', 'audit', 'idempotency'] as const
export const notTools = [
  { clauses: ['LDG-013', 'COORD-006'], reason: 'screen' as const },
  { clauses: ['LDG-015'], reason: 'import-door' as const },
  { clauses: ['OPS-002', 'INT-001', 'ATTR-009'], reason: 'installation' as const },
]

export function lodgeTools(env: Bindings): ToolDefinition[] {
  const admissions=new Map<string,string>()
  const context=(ctx:ToolContext)=>nativeContext(env,ctx,admissions)
  const read = async (args: Data, ctx: ToolContext) => {
    const {state,actor} = await context(ctx)
    const record = sourceRecord(await workspaceRecords(state,actor),args.kind,args.id)
    if (!record) throw new ToolRefusal('record_unavailable')
    return {state,actor,record}
  }
  const common = { classes: ['standard'] as ['standard'], outputSchema: {type:'object'}, untrusted: true }
  return [
    { ...common, name:'lodge.jobs.list', title:'Read scoped jobs', description:'Current native job visibility. Candidate and imported text is untrusted.', scope:'lodge:read',readOnly:true,inputSchema:empty,clauses:['LDG-006','OPS-005'],
      classify: async (_args,ctx) => native(async () => { const {state,actor}=await context(ctx);const view=await workspaceRecords(state,actor);return [{class:'standard',facts:{measure:view.vacancies.length}}] }),
      run: async (_args,ctx) => native(async () => {const {state,actor}=await context(ctx);const view=await workspaceRecords(state,actor);return {result:{jobs:view.vacancies}}}),
    },
    { ...common,name:'lodge.records.read',title:'Read source evidence',description:'A current scoped native source record. Hidden and missing records have the same refusal. Restricted documents and employer-only evidence remain unavailable to agents.',scope:'lodge:read',readOnly:true,
      inputSchema:{type:'object',properties:{kind:{type:'string',enum:kinds},id:text},required:['kind','id'],additionalProperties:false},clauses:['LDG-004','LDG-006','LDG-009','OPS-005'],
      classify:async(args,ctx)=>native(async()=>{await read(args,ctx);return [{class:'standard',facts:{measure:1}}]}),
      target:async(args,ctx)=>native(async()=>{const {record}=await read(args,ctx);return {kind:String(args.kind),id:String(record.id)}}),
      run:async(args,ctx)=>native(async()=>({result:{record:(await read(args,ctx)).record}})),
    },
    { ...common,name:'lodge.proposals.list',title:'Read draft inventory',description:'Visible proposal and debrief handles plus native job/application revisions. Drafts require human decisions; this read never applies them.',scope:'lodge:read',readOnly:true,inputSchema:empty,clauses:['LDG-013','COORD-006'],
      classify:async(_args,ctx)=>native(async()=>{await context(ctx);return [{class:'standard',facts:{measure:1}}]}),
      run:async(_args,ctx)=>native(async()=>{const {state,actor}=await context(ctx),view=await workspace(state,actor);return {result:{proposals:view.proposals.map((p:Data)=>({id:p.id,workflow:p.workflow,status:p.status,preparedFor:p.proposedFor})).sort((a:Data,b:Data)=>a.id.localeCompare(b.id)),debriefs:view.debriefs.map((p:Data)=>({id:p.id,status:p.status,preparedFor:p.preparedFor})).sort((a:Data,b:Data)=>a.id.localeCompare(b.id)),records:[...view.vacancies.map((r:Data)=>({kind:'vacancy',id:r.id})),...view.applications.map((r:Data)=>({kind:'application',id:r.id}))].map(r=>({...r,revision:state.revisionOf(r.kind,r.id)})).sort((a,b)=>a.id.localeCompare(b.id))}}}),
    },
    ...(['propose','debrief'] as const).map((op):ToolDefinition=>({ ...common,
      name:op==='propose'?'lodge.proposals.prepare':'lodge.debriefs.prepare',title:op==='propose'?'Prepare a human-reviewed proposal':'Prepare a cited debrief',
      description:'Save only a native draft as the current sponsor’s explicitly bound agent. Never applies a hiring decision, submits feedback, sends mail or calls a provider.',scope:'lodge:prepare',readOnly:false,
      inputSchema: op==='propose'?{type:'object',properties:{...proposalFields,workflow:{type:'string',enum:['prepare-vacancy','feedback-packet','coordination','rediscovery','feedback-coordination','delay-diagnosis','handoff-exception','sourcing-research','candidate-update']},approver:text,summary:{type:'string',minLength:1,maxLength:2000},intake:{type:'string',maxLength:20000},rationale:{type:'string',maxLength:8000},sources:{type:'array',maxItems:50,items:{type:'object'}},changes:{type:'array',maxItems:20,items:{type:'object'}},citations:{type:'array',maxItems:100,items:{type:'object'}},input:{type:'object'}},required:['workflow'],additionalProperties:false}:{type:'object',properties:{application:text,statements:{type:'array',minItems:1,maxItems:60,items:{type:'object'}}},required:['application','statements'],additionalProperties:false},
      clauses:op==='propose'?['LDG-013','COORD-001','COORD-002','COORD-003','COORD-004','COORD-005']:['COORD-006'],
      classify:async(args,ctx)=>native(async()=>{const {state,actor}=await context(ctx);await run(state.clone(),actor,op,args);return [{class:'standard',facts:{measure:1}}]}),
      summary:async(args,ctx)=>native(async()=>{const {state,actor}=await context(ctx);if(op==='debrief'){const app=state.get('application',args.application);return {target:{id:app.id,name:state.get('vacancy',app.vacancy).title},items:['Draft debrief; human review remains required']}}return {target:{email:String(args.approver??actor.scopeAs)},items:[String(args.workflow),'Draft only; native human approval remains required']}}),
      ...(op==='debrief'?{revisionType:'string' as const,revision:async(args:Data,ctx:ToolContext)=>native(async()=>{const {state}=await context(ctx);state.get('application',args.application);return state.revisionOf('application',String(args.application))}),target:async(args:Data,ctx:ToolContext)=>native(async()=>{const {state}=await context(ctx);return {kind:'application',id:state.get('application',args.application).id}})}:{}),
      run:async(args,ctx)=>native(async()=>{const {state,actor}=await context(ctx);const result=fieldResult(state,actor,blindResult(state,actor,await run(state,actor,op,args)));await save(env.DB,state,actor);return {result}}),
    })),
  ]
}
