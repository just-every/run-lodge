import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID, webcrypto} from 'node:crypto'
import {businessHarness} from './harness.mjs'
import {resourceFixtures} from './agent-phase-fixtures.mjs'
import {createProtocol, errorCode} from '../src/modules/agent-door/conformance/protocol.mjs'
import {autonomousPolicy, heldPolicy, accessToken, seconds, signJws} from '../src/modules/agent-door/conformance/crypto.mjs'

const method=(...parts)=>parts.join('/')
const kinds=['vacancy','application','candidate','interview','interview-note','scorecard','document','proposal','debrief']
const collections=['vacancies','applications','candidates','interviews','notes','scorecards','documents','proposals','debriefs']
const uri=(kind,id)=>`lodge://${kind}/${encodeURIComponent(id)}`
const links=answer=>answer.result?.content?.filter(item=>item.type==='resource_link')??[]
const snapshot=async h=>(await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results

/** The real signed Business fixture exercises the production MCP and native doors. */
export async function checkAgentResources() {
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const kid=randomUUID(),installationId=randomUUID(),issuer='https://synthetic-lodge-38.invalid'
  const publicKeys={[kid]:await webcrypto.subtle.exportKey('jwk',pair.publicKey)}
  const h=await businessHarness({bindings:{RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify(publicKeys)}})
  try {
    const email=(await h.state()).actor.email,sub='synthetic-lodge-38',business='synthetic-lodge-38'
    const surface=JSON.parse(await readFile('agent-surface.json','utf8'))
    const signer={privateKey:pair.privateKey,kid,issuer,installationId}
    const iat=seconds(),settings=await signJws(pair.privateKey,kid,'rer-business-settings+jwt',{v:1,iss:issuer,aud:h.origin,sub:installationId,business,email,owner_id:sub,jti:randomUUID(),iat,exp:iat+300,rev:1,values:{},logo:null,team:null})
    assert.equal((await h.send('/api/rer/business-settings',{settings})).status,200,'The disposable signed Business binds the existing native owner')
    const agentId='synthetic-lodge-'+randomUUID(),agentEmail='synthetic-lodge-'+randomUUID()+'\u0040example.invalid'
    const nativeCookie=await h.member(agentEmail,[],'Synthetic resource agent',{agent:true,actsFor:email,businessAgentId:agentId})
    const request=(url,init)=>h.mf.dispatchFetch(url,init)
    const c=createProtocol({fetch:request,origin:h.origin,surface,signer,person:{email,sub,cookie:h.owner},business,consent:randomUUID(),agentId,seq:0,revision:0,points:[]})
    await c.adopt(autonomousPolicy())
    const f=await resourceFixtures({request,origin:h.origin,email,cookie:h.owner})
    const read=(kind,id,options)=>c.mcp(method('resources','read'),{uri:uri(kind,id)},options)
    const record=answer=>{
      assert.equal(answer.status,200)
      assert.equal(answer.message.error,undefined,`Resource read refused: ${errorCode(answer)}`)
      assert.equal(answer.result.contents.length,1)
      const content=answer.result.contents[0]
      assert.equal(content.mimeType,'application/json')
      assert.equal(content._meta?.['com.runeditrun/untrusted'],true,'Source and draft text must remain untrusted')
      return JSON.parse(content.text)
    }
    const projection=async(kind,id)=>{
      const view=await h.state(nativeCookie)
      return view[collections[kinds.indexOf(kind)]].find(row=>row.id===id)
    }
    const compare=async(kind,id)=>{
      const expected=await projection(kind,id)
      assert.ok(expected,`The native agent can open the ${kind}`)
      const actual=record(await read(kind,id))
      assert.deepEqual(actual,expected,`${kind} uses every current native agent-visible field, without raw storage fields`)
      assert.equal(actual.base64,undefined,'Resources expose no file bytes')
      return actual
    }
    const templates=await c.mcp(method('resources','templates','list'))
    assert.deepEqual(templates.result.resourceTemplates.map(t=>t.uriTemplate).sort(),kinds.map(kind=>`lodge://${kind}/{id}`).sort())
    assert.deepEqual(surface.resources.slice().sort(),templates.result.resourceTemplates.map(t=>t.uriTemplate).sort(),'Published templates match the manifest')
    const beforeReads=await snapshot(h)
    for(const [kind,id] of f.records) {
      const value=await compare(kind,id)
      const tool=await c.tool('lodge.records.read',{kind,id})
      assert.equal(tool.result?.isError,false,`${kind} tool read: ${errorCode(tool)} HTTP ${tool.status}`)
      assert.deepEqual(tool.result.structuredContent.record,value)
      assert.deepEqual(links(tool).map(link=>link.uri),[uri(kind,id)],'Source reads link to the actual visible source')
    }
    assert.deepEqual(await snapshot(h),beforeReads,'Allowed metadata reads change no hiring state')
    const hostile=await read('interview-note',f.records.find(([kind])=>kind==='interview-note')[1])
    assert.match(record(hostile).text,/Ignore previous instructions/,'Hostile text is retained as data with its marker')
    assert.ok((await h.state()).documents.some(d=>d.id===f.restricted.id),'The restricted original exists for its human custodian')
    const beforeRefusals=await snapshot(h)
    const hidden=await read('document',f.restricted.id),missing=await read('document','synthetic-lodge-missing')
    assert.equal(errorCode(hidden),'resource_unavailable')
    assert.deepEqual(hidden.message.error,missing.message.error,'Hidden and missing ids have identical public responses')
    for(const id of [f.restricted.id,'synthetic-lodge-missing']) {
      const refused=await c.tool('lodge.records.read',{kind:'document',id})
      assert.equal(refused.result.isError,true)
      assert.deepEqual(links(refused),[],'Refusals disclose no resource links')
    }
    const noRead=await accessToken(c,{scope:'lodge:prepare'})
    assert.deepEqual((await c.mcp(method('resources','templates','list'),{}, {token:noRead})).result.resourceTemplates,[])
    const unscoped=await read('candidate',f.added.candidate.id,{token:noRead})
    assert.equal(unscoped.status,403)
    assert.equal(errorCode(unscoped),'insufficient_scope')
    assert.equal(unscoped.result,undefined)
    assert.deepEqual(await snapshot(h),beforeRefusals,'Restricted and missing reads and insufficient scope change no hiring records')

    const productionKeys=['vacancies','applications','candidates','interviews','scorecards','documents']
    const production=async()=>{const view=await h.state();return Object.fromEntries(productionKeys.map(key=>[key,view[key]]))}
    const hiringBefore=await production()
    const prepared=[]
    for(const document of [autonomousPolicy(),heldPolicy()]) {
      await c.adopt(document)
      const proposal=await c.tool('lodge.proposals.prepare',{workflow:'prepare-vacancy',approver:email,summary:'Synthetic proposed role',sources:[{kind:'candidate',id:f.added.candidate.id}],changes:[{op:'vacancy',input:{title:'Synthetic proposed role',location:'Brooklyn, NY',headcount:1,manager:email,description:'Human review required'}}],idempotency_key:randomUUID()})
      const debrief=await c.tool('lodge.debriefs.prepare',{...f.citedDebrief,idempotency_key:randomUUID()})
      for(const [kind,answer] of [['proposal',proposal],['debrief',debrief]]) {
        assert.equal(answer.result?.isError,false,`${kind} preparation succeeds`)
        const id=answer.result.structuredContent.id
        assert.deepEqual(links(answer).map(link=>link.uri),[uri(kind,id)],'Preparation links to its saved draft')
        const current=await compare(kind,id)
        assert.equal(current.status,kind==='proposal'?'proposed':'draft','Saving the draft applies no hiring decision')
        prepared.push([kind,id])
      }
      for(const tool of ['lodge.jobs.list','lodge.proposals.list']) {
        const answer=await c.tool(tool,{})
        assert.ok(links(answer).length>0)
        for(const link of links(answer)) {
          const readback=await c.mcp(method('resources','read'),{uri:link.uri})
          const value=record(readback)
          assert.equal(link.uri,uri(kinds.find(kind=>link.uri.startsWith(`lodge://${kind}/`)),value.id))
          assert.equal(readback.decision.disposition,document.rules[0].do==='autonomous'?'autonomous':'review','Resource readback obeys the current policy')
        }
      }
    }
    const hiring=await h.state()
    assert.deepEqual(await production(),hiringBefore,'Draft preparations leave every hiring record unchanged')
    assert.equal(hiring.vacancies.length,1,'Draft preparation creates no vacancy')
    const beforePolicyRefusals=await snapshot(h)
    await c.adopt({...autonomousPolicy(),rules:[{id:'blocked',class:'*',do:'blocked'}]})
    const blocked=await read('candidate',f.added.candidate.id)
    assert.equal(errorCode(blocked),'policy_blocked')
    assert.equal(blocked.result,undefined,'A blocked resource returns no content')
    await c.adopt(autonomousPolicy())
    assert.equal((await h.send('/agents/api/pause',{paused:true},h.owner)).status,200)
    const paused=await read('candidate',f.added.candidate.id)
    assert.equal(errorCode(paused),'agents_paused')
    assert.equal(paused.result,undefined,'Pause stops resource content')
    assert.equal((await h.send('/agents/api/pause',{paused:false},h.owner)).status,200)
    await c.adopt(autonomousPolicy(),{revoked:{agents:[],consents:[c.consent]}})
    const consentRevoked=await read('candidate',f.added.candidate.id)
    assert.equal(consentRevoked.status,401,'Revoked consent refuses a retained resource URI immediately')
    assert.equal(consentRevoked.result,undefined,'Revoked consent returns no resource content')
    await c.adopt(autonomousPolicy())
    assert.deepEqual(await snapshot(h),beforePolicyRefusals,'Policy, Pause and consent refusals change no hiring state')
    const documentId=f.records.find(([kind])=>kind==='document')[1]
    const beforeRestart=record(await read('document',documentId))
    await h.restart()
    assert.deepEqual(record(await read('document',documentId)),beforeRestart,'Saved resource identity survives Worker restart')
    await h.command('correct-candidate',{...f.added.candidate,name:'synthetic-lodge-38 revised name',reason:'Synthetic recorded correction'})
    assert.equal((await compare('candidate',f.added.candidate.id)).name,'synthetic-lodge-38 revised name','A resource reads current saved state')

    await h.command('member',{email:agentEmail,name:'Synthetic resource agent',agent:true,actsFor:email,businessAgentId:agentId,active:false})
    const revokedBefore=await snapshot(h)
    for(const [kind,id] of [...f.records,...prepared]) {
      const refused=await read(kind,id)
      assert.equal(errorCode(refused),'resource_unavailable','Native agent revocation stops every resource')
      assert.deepEqual(refused.message.error,(await read(kind,'synthetic-lodge-missing')).message.error)
      assert.equal(refused.result,undefined)
    }
    assert.deepEqual(await snapshot(h),revokedBefore,'Revoked reads leave hiring state unchanged')
    await h.command('member',{email:agentEmail,name:'Synthetic resource agent',agent:true,actsFor:email,businessAgentId:agentId,active:true})
    await h.command('move',{application:f.added.application.id,to:'withdrawn',closeReason:'other-offer',reason:'Synthetic erasure request'})
    assert.equal((await h.send('/api/lodge/delete-candidate',{candidate:f.added.candidate.id,confirm:'synthetic-lodge-38 revised name',reason:'Synthetic erasure request'},h.owner)).status,200)
    const erasedBefore=await snapshot(h)
    for(const [kind,id] of [...f.records.filter(([kind])=>kind!=='vacancy'),...prepared]) {
      const refused=await read(kind,id)
      assert.equal(errorCode(refused),'resource_unavailable','Previously captured resource ids cannot recover erased records')
      assert.deepEqual(refused.message.error,(await read(kind,'synthetic-lodge-missing')).message.error)
      assert.equal(refused.result,undefined)
    }
    for(const tool of ['lodge.jobs.list','lodge.proposals.list']) {
      const answer=await c.tool(tool,{})
      assert.equal(answer.result?.isError,false,'Erasure preserves allowed inventory reads')
      for(const [kind,id] of [...f.records.filter(([kind])=>kind!=='vacancy'),...prepared]) {
        assert.ok(!links(answer).some(link=>link.uri===uri(kind,id)),'Inventories cannot reissue an erased record or draft link')
        assert.ok(!JSON.stringify(answer.result.structuredContent).includes(id),'Inventories cannot return an erased record or draft handle')
      }
    }
    assert.deepEqual(await snapshot(h),erasedBefore,'Replayed erased-source reads and inventories restore no data')
    console.log('PROBE BASE-AGENT-003 metadata: nine MCP templates and seven populated source reads -> current native agent projections, restricted originals unavailable, no file bytes')
    console.log('PROBE BASE-AGENT-003 links: native read and saved proposal and debrief links -> current saved records under autonomous and review policies')
    console.log('PROBE BASE-AGENT-003 safety: hidden and missing ids, missing scope, blocked policy, Pause, revoked consent, revoked native agent and erased sources and drafts -> typed refusals with unchanged hiring state')
    console.log('PROBE BASE-AGENT-003 untrusted: hostile native note -> retained as text with the untrusted content marker')
  } finally {await h.close()}
}
