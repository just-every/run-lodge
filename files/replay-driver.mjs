import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID, webcrypto, createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, join, extname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(process.argv[2]), packet = fileURLToPath(new URL('.', import.meta.url))
process.chdir(root)
const load = path => import(pathToFileURL(join(root, path)).href)
const require = createRequire(join(root, 'package.json'))
const { chromium } = require('@playwright/test')
const { businessHarness } = await load('tests/.sx-lodge-c-f54-harness.mjs')
const { default: initializeAgent } = await load('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await load('tests/agent-phase-fixtures.mjs')
const { createProtocol } = await load('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, heldPolicy, seconds, signJws } = await load('src/modules/agent-door/conformance/crypto.mjs')
const sha256 = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
const emailPattern = /[A-Za-z0-9.!#$%&'*+\/=?^_\x60{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const redact = value => JSON.parse(JSON.stringify(value).replace(emailPattern, '[synthetic-address]'))
const sourcePaths = ['src/lodge/agent-door/tools.ts', 'src/modules/agent-door/pipeline.ts', 'src/modules/agent-door/execution.ts', 'src/modules/agent-door/conformance/protocol.mjs', 'tests/harness.mjs', 'tests/initialize-agent.mjs', 'tests/agent-phase-fixtures.mjs', 'src/ui/proposals.tsx', 'src/ui/debriefs.tsx', 'dist/server/index.js']
const receipt = {
  schema: 1, tag: 'sx-lodge-c-f54', clause: 'BASE-AGENT-012', acceptance: 2,
  head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  startedAt: new Date().toISOString(), sourceDigests: {}, cases: [], browser: [],
  scope: 'Completed native draft outcomes only; no crash between mutation and durable outcome; no provider, retention-duration or long-job qualification',
  privacy: 'Only disposable fixture results and native records are recorded. Synthetic addresses are masked; no credentials, cookies, signed policy or authorization headers are retained.',
}
for (const path of sourcePaths) receipt.sourceDigests[path] = sha256(await readFile(path))
const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
const ring = await webcrypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign','verify'])
const kid=randomUUID(), issuer='https://synthetic-lodge-54.invalid', installationId=randomUUID()
const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
const h = await businessHarness({bindings:{
  RER_OWNER_CLAIM_ISSUER:issuer, RER_OWNER_CLAIM_INSTALLATION_ID:installationId,
  RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify(publicKeys),
}})
let proxy, browser, armed, capture, calls=[]
const realFetch = async (url, init={}) => fetch(url, {redirect:'manual', ...init, signal:AbortSignal.timeout(20000)})
const readOwner = async path => {
  const response=await realFetch(h.origin+path,{headers:{Cookie:h.owner}})
  assert.equal(response.status,200,'signed-in native HTTP read '+path)
  return response.json()
}
const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
const admission = headers => {
  const token = new Headers(headers).get('authorization').split(' ')[1]
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString())
  const {iss,aud,sub,email,act,client_id,scope,business,consent}=claims
  return {iss,aud,sub,email,act,client_id,scope,business,consent}
}
try {
  const setup = await realFetch(h.origin+'/setup',{method:'POST',headers:{Origin:h.origin,Cookie:h.owner,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({confirm:'yes',displayName:'Synthetic owner'})})
  assert.equal(setup.status,303,'existing human first-run door')
  await setup.body?.cancel()
  const nativeSession=await readOwner('/auth/session')
  const email=nativeSession.operator.email, sub=randomUUID(), iat=seconds()
  const settings=await signJws(ring.privateKey,kid,'rer-business-settings+jwt',{
    v:1,iss:issuer,aud:h.origin,sub:installationId,business:'synthetic-lodge-54',
    email,owner_id:sub,jti:randomUUID(),iat,exp:iat+300,rev:1,values:{},logo:null,team:null,
  })
  assert.equal((await h.send('/api/rer/business-settings',{settings})).status,200)
  proxy=createServer(async(req,res)=>{
    try {
      const chunks=[]
      for await (const chunk of req) chunks.push(chunk)
      const body=Buffer.concat(chunks)
      const rpc=JSON.parse(body.toString())
      const headers=new Headers(req.headers)
      headers.delete('host'); headers.delete('content-length'); headers.delete('connection')
      const upstream=await realFetch(h.origin+req.url,{method:req.method,headers,body})
      const bytes=Buffer.from(await upstream.arrayBuffer())
      const complete=JSON.parse(bytes.toString())
      assert.equal(upstream.status,200)
      assert.equal(complete.result?.isError,false,'upstream native operation completed before delivery loss')
      const saved=await h.db.prepare('SELECT state,outcome FROM agent_door_calls WHERE agent=? AND key=?').bind(c.agentId,rpc.params.arguments.idempotency_key).first()
      assert.equal(saved?.state,'done','completed outcome is durable before fault')
      const durable=JSON.parse(saved.outcome)
      assert.deepEqual(durable.result,complete.result.structuredContent)
      assert.deepEqual(durable.review,complete.result._meta['com.runeditrun/review'])
      capture={
        mode:armed.mode, requestId:rpc.id, arguments:rpc.params.arguments,
        status:upstream.status, contentType:upstream.headers.get('content-type'),
        upstreamBytes:bytes.length, upstreamSha256:sha256(bytes),
        upstreamBody:complete, durableOutcome:durable, upstreamCompleteAt:new Date().toISOString(),
      }
      const prefix=bytes.subarray(0,Math.floor(bytes.length/2))
      capture.downstreamBytes=prefix.length
      capture.cutoffAt=new Date().toISOString()
      res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type'),'Content-Length':String(bytes.length),'Connection':'close'})
      res.flushHeaders()
      if (armed.mode==='truncate') res.end(prefix)
      else {res.write(prefix); setTimeout(()=>res.destroy(),25)}
    } catch(error) {
      capture={driverError:error.message}
      res.destroy()
    }
  })
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve))
  const proxyOrigin='http://127.0.0.1:'+proxy.address().port
  const request=async(url,init={})=>{
    if (new URL(url).pathname==='/mcp') {
      const rpc=JSON.parse(init.body)
      if (rpc.method===['tools','call'].join('/')) calls.push({id:rpc.id,method:rpc.method,name:rpc.params.name,args:rpc.params.arguments,admission:admission(init.headers)})
      if(armed && rpc.params?.name===armed.tool) return realFetch(proxyOrigin+'/mcp',init)
    }
    return realFetch(url,init)
  }
  const ownerRequest=async(url,init={})=>{
    const headers=new Headers(init.headers)
    headers.set('Origin',h.origin);headers.set('Cookie',h.owner)
    const response=await request(url,{...init,headers})
    assert.ok(response.ok,'native fixture door: HTTP '+response.status)
    return response
  }
  const c=createProtocol({fetch:request,origin:h.origin,surface,points:[],
    signer:{issuer,installationId,kid,privateKey:ring.privateKey},
    person:{email,sub,cookie:h.owner},business:'synthetic-lodge-54',
    agentId:randomUUID(),consent:randomUUID(),seq:0,revision:0,
  })
  // The proxy executes only after this binding is initialized.
  await initializeAgent({agentId:c.agentId,request:ownerRequest,origin:h.origin,email})
  const screenshots=[]
  for(const [phase,policy,disposition] of [
    ['autonomous',autonomousPolicy(),'autonomous'], ['held',heldPolicy(),'review'],
  ]) {
    await c.adopt(policy)
    const fixtures=await prepareFixtures({request:ownerRequest,origin:h.origin,cookie:h.owner,email,phase})
    for (const [family,tool,mode] of [
      ['proposals','lodge.proposals.prepare','truncate'],['debriefs','lodge.debriefs.prepare','terminate'],
    ]) {
      const before=await readOwner('/api/lodge/state')
      const inventory=await c.tool('lodge.proposals.list',{})
      assert.equal(inventory.result?.isError,false)
      const args=family==='proposals'?{
        workflow:'prepare-vacancy',summary:'Synthetic lodge 54 '+phase+' recovery draft',
        intake:'Prepare a synthetic estimator vacancy.',approver:email,idempotency_key:randomUUID(),
        changes:[{op:'vacancy',input:{title:'Synthetic lodge 54 '+phase,location:'Brooklyn, NY',headcount:1,manager:email,description:'Prepare estimates from drawings.'}}],
      }:{
        ...fixtures.values.debrief,
        expected_revision:inventory.result.structuredContent.records.find(row=>row.kind==='application'&&row.id===fixtures.values.debrief.application).revision,
        idempotency_key:randomUUID(),
      }
      const policyBefore=await h.db.prepare('SELECT envelope,local_revision,local_paused FROM agent_door_state WHERE id=1').first()
      armed={tool,mode};capture=undefined;let failure
      try {await c.tool(tool,args)} catch(error) {failure={name:error.name,message:error.message,cause:error.cause?.code??null}}
      armed=undefined
      assert.ok(failure,'the actual caller must fail to receive a complete result')
      assert.ok(capture?.upstreamBody,'the driver must capture the full completed upstream response')
      assert.equal(capture.driverError,undefined)
      assert.ok(capture.downstreamBytes<capture.upstreamBytes)
      const first=capture.upstreamBody.result, firstCall=calls.at(-1)
      assert.equal(first._meta['com.runeditrun/decision'].disposition,disposition)
      const id=first.structuredContent.id
      const afterLoss=await readOwner('/api/lodge/state')
      assert.equal(afterLoss[family].length,before[family].length+1,'exactly one new native draft after failed delivery')
      const draft=afterLoss[family].find(row=>row.id===id)
      assert.ok(draft,'the original draft is visible through signed-in HTTP state')
      assert.equal(draft.status,family==='proposals'?'proposed':'draft')
      assert.deepEqual(afterLoss.vacancies,before.vacancies,'unsent proposal never applies a vacancy')
      assert.deepEqual(afterLoss.applications,before.applications,'draft never changes a hiring decision')
      assert.deepEqual(afterLoss.messages,before.messages,'draft never sends or creates a message')
      if(family==='proposals') {
        assert.equal(draft.summary,args.summary)
        assert.deepEqual(draft.changes,args.changes)
      } else assert.equal(draft.statements[0].text,args.statements[0].text)
      const originalRecords=await snapshot()
      const reviewsBefore=await readOwner('/agents/api/reviews')
      const review=first._meta['com.runeditrun/review']
      if(phase==='held') assert.ok(review?.id && reviewsBefore.reviews.some(row=>row.id===review.id&&row.state==='open'),'original review exists')
      else assert.equal(review,undefined)
      const restartStartedAt=new Date().toISOString()
      await h.restart()
      const restartFinishedAt=new Date().toISOString()
      assert.deepEqual(await snapshot(),originalRecords,'same persistent native D1 survives Worker restart')
      const afterRestart=await readOwner('/api/lodge/state')
      assert.deepEqual(afterRestart[family],afterLoss[family],'same native drafts survive restart')
      const repeated=await c.tool(tool,args), retryCall=calls.at(-1)
      assert.equal(repeated.status,200)
      assert.equal(repeated.result?.isError,false)
      assert.notEqual(retryCall.id,firstCall.id,'retry uses a fresh JSON-RPC id')
      assert.deepEqual(retryCall.args,firstCall.args,'identical arguments and idempotency key')
      assert.deepEqual(retryCall.admission,firstCall.admission,'agent, sponsor, consent, client and scopes stay unchanged')
      assert.deepEqual(await h.db.prepare('SELECT envelope,local_revision,local_paused FROM agent_door_state WHERE id=1').first(),policyBefore,'policy stays unchanged through restart and retry')
      assert.deepEqual(repeated.result.structuredContent,first.structuredContent,'the original structured outcome is replayed')
      assert.deepEqual(repeated.result.content,first.content,'the original user-visible content is replayed')
      assert.deepEqual(repeated.result._meta['com.runeditrun/review'],review,'the original review handle is replayed')
      const {id:originalDecisionId,...originalDecision}=first._meta['com.runeditrun/decision']
      const {id:retryDecisionId,...retryDecision}=repeated.decision
      assert.deepEqual(retryDecision,originalDecision,'decision semantics stay equal, independent of fresh decision ids')
      const after=await readOwner('/api/lodge/state')
      assert.deepEqual(after[family],afterLoss[family],'draft identity and full native content are unchanged')
      assert.equal(after[family].length,before[family].length+1,'retry makes no second draft')
      assert.deepEqual(await snapshot(),originalRecords,'all native values and revisions stay unchanged on retry')
      assert.deepEqual(await readOwner('/agents/api/reviews'),reviewsBefore,'retry makes no second review')
      const proof={
        phase,tool,mode,status:'pass',failure,request:{originalId:firstCall.id,retryId:retryCall.id,arguments:args,admission:firstCall.admission},
        transport:capture,restartStartedAt,restartFinishedAt,
        retryResponse:repeated.body,originalDecisionId,retryDecisionId,
        native:{draftId:id,countBefore:before[family].length,countAfterLoss:afterLoss[family].length,countAfterRetry:after[family].length,
          draft,recordSnapshotSha256:sha256(originalRecords),records:originalRecords,valuesAndRevisionsUnchanged:true},
        review:review??null,policyUnchanged:true,admissionUnchanged:true,
      }
      receipt.cases.push(redact(proof))
      await writeFile(join(packet,'replay-receipt.json'),JSON.stringify({...receipt,status:'running'},null,2)+'\n')
      console.log('PROBE BASE-AGENT-012 acceptance 2 '+phase+' '+tool+': completed upstream, '+mode+' downstream -> caller failed; one native draft; restart and new-id retry returned original result and review with unchanged native records')
      screenshots.push({phase,family,id,application:fixtures.values.debrief.application})
    }
  }
  if(!process.env.SKIP_BROWSER) {
    browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:1000}})
      try {
        await context.addCookies([{name:h.owner.split('=')[0],value:h.owner.slice(h.owner.indexOf('=')+1),url:h.origin}])
        const page=await context.newPage()
        await page.route(h.origin+'/**',async route=>{
          const url=new URL(route.request().url())
          const path=join(root,'dist/client',decodeURIComponent(url.pathname))
          if(path.startsWith(join(root,'dist/client')+'/') && !url.pathname.includes('..')) {
            try {
              const bytes=await readFile(path)
              const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'}
              await route.fulfill({status:200,body:bytes,contentType:types[extname(path)]??'application/octet-stream'})
              return
            }catch{}
          }
          await route.continue()
        })
        await page.goto(h.origin+'/app')
        await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Proposals',exact:true}).click()
        await page.getByRole('heading',{name:'Agent proposals',exact:true}).waitFor()
        for(const row of screenshots.filter(row=>row.family==='proposals')) await page.getByRole('heading',{name:'Synthetic lodge 54 '+row.phase+' recovery draft',exact:true}).waitFor()
        const proposalFile='proposals-'+width+'.png'
        await page.screenshot({path:join(packet,proposalFile),fullPage:true})
        receipt.browser.push({width,screen:'native unsent proposals',file:proposalFile,status:'pass'})
        for(const row of screenshots.filter(row=>row.family==='debriefs')) {
          await page.goto(h.origin+'/app?application='+encodeURIComponent(row.application))
          await page.getByRole('tab',{name:'Scorecards',exact:true}).click()
          const section=page.getByRole('region',{name:'Debrief brief',exact:true})
          await section.locator('p').filter({hasText:'Takeoffs has not been assessed.'}).waitFor()
          await section.getByRole('button',{name:'Keep this brief',exact:true}).waitFor()
          await section.scrollIntoViewIfNeeded()
          const file='debrief-'+row.phase+'-'+width+'.png'
          await page.screenshot({path:join(packet,file),fullPage:true})
          receipt.browser.push({width,phase:row.phase,screen:'native draft debrief',file,status:'pass'})
          if(width===1440) assert.ok((await section.innerText()).includes('draft'))
        }
      } finally {await context.close()}
    }
    await browser.close();browser=undefined
  }
  assert.equal(receipt.cases.length,4)
  assert.ok(c.points.every(point=>point.ok),'existing policy adoption conformance points')
  receipt.status='pass'
} catch(error) {
  receipt.status='fail';receipt.failure={name:error.name,message:error.message}
  console.error('Qualification failed: '+error.name+': '+error.message)
  process.exitCode=1
} finally {
  receipt.completedAt=new Date().toISOString()
  await writeFile(join(packet,'replay-receipt.json'),JSON.stringify(redact(receipt),null,2)+'\n')
  if(browser) await browser.close()
  if(proxy) {proxy.closeAllConnections(); await new Promise(resolve=>proxy.close(resolve))}
  await h.close()
}
