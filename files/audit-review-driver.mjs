import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, webcrypto, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const root = process.cwd(), packet = join(root, '../packet')
const load = path => import(pathToFileURL(join(root, path)))
const { businessHarness } = await load('tests/harness.mjs')
const { default: initializeAgent } = await load('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await load('tests/agent-phase-fixtures.mjs')
const { createProtocol } = await load('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, heldPolicy, seconds, signJws, accessToken } = await load('src/modules/agent-door/conformance/crypto.mjs')
const { chromium } = await load('node_modules/@playwright/test/index.mjs')
let now = '2026-11-01T23:59:59.999Z'
const fixtureNow = '2026-11-05T12:00:00.000Z', weekStart = '2026-11-02T00:00:00.000Z'
const receipt = { schema: 1, head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), clause: 'BASE-AGENT-009', scope: 'Acceptance 3 and existing Mark reviewed portion of acceptance 4', fixtureNow, weekStart, status: 'running', checks: [], widths: [] }
const check = (id, detail) => { receipt.checks.push({ id, result: 'pass', detail }); console.log('PROBE BASE-AGENT-009 ' + id + ': ' + detail) }
const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex')
let h, browser
try {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const ring = await webcrypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, true, ['sign','verify'])
  const kid = randomUUID(), issuer = 'https://synthetic-lodge-49.invalid', installationId = randomUUID()
  h = await businessHarness({ clock: now, bindings: {
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify({[kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey)}),
  }})
  const request = (url, init = {}) => h.mf.dispatchFetch(url, init)
  const ownerRequest = async (url, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Origin', h.origin); headers.set('Cookie', h.owner)
    const response = await request(url, {...init, headers: Object.fromEntries(headers)})
    assert.ok(response.ok, 'owner fixture request succeeds')
    return response
  }
  const session = await h.send('/auth/session', undefined, h.owner)
  const email = session.value.operator.email, sub = randomUUID(), iat = seconds(now)
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
    v:1, iss:issuer, aud:h.origin, sub:installationId, business:'synthetic-lodge-49',
    email, owner_id:sub, jti:randomUUID(), iat, exp:iat+300, rev:1, values:{}, logo:null, team:null,
  })
  assert.equal((await h.send('/api/rer/business-settings', {settings})).status, 200)
  const c = createProtocol({ fetch:request, origin:h.origin, surface, points:[], now:()=>now,
    signer:{issuer, installationId, kid, privateKey:ring.privateKey},
    person:{email, sub, cookie:h.owner}, business:'synthetic-lodge-49',
    agentId:randomUUID(), consent:randomUUID(), seq:0, revision:0,
  })
  await initializeAgent({agentId:c.agentId, request:ownerRequest, origin:h.origin, email})
  const fixtures = {}
  for (const phase of ['autonomous','held']) fixtures[phase] = await prepareFixtures({request:ownerRequest, origin:h.origin, cookie:h.owner, email, phase})
  const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  const hiringOnly = rows => rows.filter(row => !['proposal','debrief','audit'].includes(row.kind))
  const baselineHiring = hiringOnly(await snapshot())
  const generated = []
  const call = async (name, args, disposition) => {
    const answer = await c.tool(name, args)
    assert.equal(answer.status, 200, name + ' completes')
    assert.equal(answer.result?.isError, false, name + ' succeeds')
    assert.equal(answer.decision?.disposition, disposition)
    generated.push({id:answer.decision.id, tool:name, disposition, at:now})
    return answer.result.structuredContent
  }
  for (const at of [now, weekStart, fixtureNow, '2026-11-05T12:00:00.001Z']) {
    now = at; await h.setTime(now)
    for (const [phase, policy, disposition] of [['autonomous',autonomousPolicy(),'autonomous'],['held',heldPolicy(),'review']]) {
      await c.adopt(policy)
      const f = fixtures[phase]
      await call('lodge.jobs.list', {}, disposition)
      await call('lodge.records.read', {kind:'vacancy', id:f.values.job.id}, disposition)
      const inventory = await call('lodge.proposals.list', {}, disposition)
      await call('lodge.proposals.prepare', {workflow:'prepare-vacancy', summary:'Synthetic vacancy remains an unsent preparation draft',
        intake:'Prepare an estimator vacancy.', approver:email, idempotency_key:randomUUID(),
        changes:[{op:'vacancy',input:{title:'Synthetic unapproved estimator',location:'Brooklyn, NY',headcount:1,manager:email,description:'Prepare estimates from drawings.'}}],
      }, disposition)
      const source = inventory.records.find(row=>row.kind==='application' && row.id===f.values.debrief.application)
      await call('lodge.debriefs.prepare', {...f.values.debrief, expected_revision:source.revision,idempotency_key:randomUUID()}, disposition)
    }
  }
  now = fixtureNow; await h.setTime(now); await c.adopt(autonomousPolicy())
  for (let i=0;i<170;i++) await call('lodge.jobs.list', {}, 'autonomous')
  assert.deepEqual(hiringOnly(await snapshot()), baselineHiring, 'tool preparation creates no hiring decision or production job')
  const drafted=await h.state()
  assert.equal(drafted.proposals.length,8); assert.ok(drafted.proposals.every(row=>row.status==='proposed'))
  assert.equal(drafted.debriefs.length,8); assert.ok(drafted.debriefs.every(row=>row.status==='draft'))
  receipt.drafts={proposals:8,proposalStatus:'proposed',debriefs:8,debriefStatus:'draft'}
  check('drafts', 'All five adopted tools completed under both policies at four clock positions; native preparation remained draft only, with unchanged hiring records.')
  const allAudit = async () => {
    const rows = [], cursors = [], differs = []
    let cursor = '0'
    for (let page=0;page<20;page++) {
      const response = await h.send('/agents/api/audit?after='+encodeURIComponent(cursor), undefined, h.owner)
      assert.equal(response.status,200)
      const body = response.value
      assert.ok(Array.isArray(body.rows)); differs.push(body.differs_from_policy)
      rows.push(...body.rows); cursors.push({after:cursor,count:body.rows.length,cursor:body.cursor})
      if (body.cursor===cursor || body.rows.length===0) break
      assert.ok(Number(body.cursor)>Number(cursor), 'cursor progresses')
      cursor = body.cursor
      assert.ok(page<19, 'audit pagination terminates')
    }
    assert.equal(new Set(rows.map(row=>row.id)).size,rows.length)
    assert.ok(differs.every(value=>value===0))
    return {rows,cursors}
  }
  const audit = await allAudit()
  assert.equal(audit.rows.length,generated.length)
  assert.ok(audit.cursors[0].count===200 && audit.cursors[1].count>0, 'fixture crosses the audit page limit')
  for (const generatedRow of generated) {
    const row=audit.rows.find(row=>row.id===generatedRow.id)
    assert.equal(row.tool,generatedRow.tool); assert.equal(row.decision,generatedRow.disposition); assert.equal(row.at,generatedRow.at)
    assert.equal(row.outcome,'done'); assert.equal(row.agent.id,c.agentId)
  }
  const allReviews = async () => {
    const response=await h.send('/agents/api/reviews',undefined,h.owner)
    assert.equal(response.status,200); return response.value.reviews
  }
  let reviews=await allReviews()
  const successfulReviewRows=audit.rows.filter(row=>row.decision==='review' && row.outcome==='done')
  assert.deepEqual(reviews.map(row=>row.decision_id).sort(),successfulReviewRows.map(row=>row.id).sort())
  const sponsor=(await h.send('/agents/api/agents',undefined,h.owner)).value.agents.find(row=>row.id===c.agentId).sponsor
  assert.ok(sponsor.id && sponsor.name)
  assert.equal((await h.send('/agents/api/reviews/'+reviews[0].id+'/flag',{},h.owner)).status,200)
  assert.equal((await h.send('/agents/api/reviews/'+reviews[1].id+'/reviewed',{},h.owner)).status,200)
  reviews=await allReviews()
  const expectedCounts = rows => {
    const counts={}
    for (const row of rows) if (Date.parse(row.at)>=Date.parse(weekStart) && Date.parse(row.at)<=Date.parse(fixtureNow))
      for (const cls of row.classes) counts[cls.class+'|'+row.decision]=(counts[cls.class+'|'+row.decision]??0)+1
    return Object.entries(counts).sort().map(([key,count])=>({key,count}))
  }
  const expected=expectedCounts(audit.rows)
  assert.notDeepEqual(expectedCounts(audit.rows.map(row=>({...row,at:fixtureNow}))), expected, 'outside-period controls affect the naive total')
  assert.equal(audit.rows.filter(row=>Date.parse(row.at)<Date.parse(weekStart)).length,10)
  assert.equal(audit.rows.filter(row=>Date.parse(row.at)>Date.parse(fixtureNow)).length,10)
  receipt.audit={count:audit.rows.length,pages:audit.cursors,policies:['autonomous','review'],tools:[...new Set(generated.map(row=>row.tool))],outsideBefore:10,outsideAfter:10,expectedCounts:expected,allIdsSha256:digest(audit.rows.map(row=>row.id))}
  check('pagination', 'All 210 audit rows were read across a full page, a second page and a terminal page; policy divergence was zero.')
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
  for (const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    try {
      const page=await context.newPage()
      await page.route('**/*',async route=>{
        const incoming=route.request(),url=new URL(incoming.url())
        if(url.origin!==h.origin)return route.abort()
        const response=await request(url.href,{method:incoming.method(),headers:{...incoming.headers(),Cookie:h.owner},body:incoming.postDataBuffer()??undefined})
        const headers=Object.fromEntries(response.headers)
        for(const name of ['content-encoding','content-length','transfer-encoding','set-cookie'])delete headers[name]
        await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())})
      })
      const compare=async()=>{
        await page.getByRole('heading',{name:'Agents',exact:true}).waitFor()
        const counts=await page.locator('[data-agents-count]').evaluateAll(nodes=>nodes.map(node=>({key:node.dataset.class+'|'+node.dataset.decision,count:Number(node.textContent)})).sort((a,b)=>a.key.localeCompare(b.key)))
        assert.deepEqual(counts,expected,'every displayed class and decision total equals independently aggregated audit rows')
        const current=await allReviews()
        const eligible=current.filter(row=>row.state==='open'||row.state==='flagged')
        assert.deepEqual((await page.locator('[data-review-id]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.reviewId,state:node.dataset.reviewState})).sort((a,b)=>a.id.localeCompare(b.id)))),eligible.map(row=>({id:row.id,state:row.state})).sort((a,b)=>a.id.localeCompare(b.id)))
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
        return {counts,eligible}
      }
      await page.goto(h.origin+'/agents')
      const before=await compare()
      const target=before.eligible.find(row=>row.state===(width===1440?'flagged':'open'))
      assert.ok(target,'an eligible review is present')
      const nativeBefore=await snapshot()
      const rawAuditBefore=(await h.db.prepare('SELECT sequence,row,evidence FROM agent_door_audit ORDER BY sequence').all()).results
      const auditBefore=(await allAudit()).rows
      const reviewsBeforeDenial=await allReviews()
      const token=await accessToken(c)
      const denied=await request(h.origin+'/agents/api/reviews/'+target.id+'/reviewed',{method:'POST',headers:{Origin:h.origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'})
      assert.equal(denied.status,403)
      const anonymous=await h.send('/agents/api/reviews/'+target.id+'/reviewed',{},'')
      assert.equal(anonymous.status,401)
      assert.deepEqual(await allReviews(),reviewsBeforeDenial,'refused nonhuman and anonymous marks change no review')
      assert.deepEqual(await snapshot(),nativeBefore,'refused marks change no native records')
      assert.equal((await allReviews()).find(row=>row.id===target.id).state,target.state)
      const beforePath=join(packet,'agents-before-'+width+'.png')
      await page.screenshot({path:beforePath,fullPage:true})
      const markResponse=page.waitForResponse(response=>response.url().endsWith('/'+target.id+'/reviewed')&&response.request().method()==='POST')
      await page.locator('[data-review-id="'+target.id+'"]').getByRole('button',{name:'Mark reviewed',exact:true}).click()
      assert.equal((await markResponse).status(),200)
      await page.locator('[data-review-id="'+target.id+'"]').waitFor({state:'detached'})
      const after=await compare()
      const marked=(await allReviews()).find(row=>row.id===target.id)
      assert.equal(marked.state,'reviewed'); assert.equal(marked.marked_by,sponsor.id); assert.equal(marked.marked_at,fixtureNow)
      assert.equal(after.eligible.length,before.eligible.length-1)
      assert.deepEqual(await snapshot(),nativeBefore,'human review changes neither hiring records nor exact draft contents')
      const auditAfter=(await allAudit()).rows
      assert.deepEqual(auditAfter.map(row=>row.id),auditBefore.map(row=>row.id),'audit identity retained')
      assert.deepEqual((await h.db.prepare('SELECT sequence,row,evidence FROM agent_door_audit ORDER BY sequence').all()).results,rawAuditBefore,'human review preserves original raw audit rows')
      const original=auditBefore.find(row=>row.review?.id===target.id)
      const readback=auditAfter.find(row=>row.id===original.id)
      assert.equal(readback.review.by,sponsor.id)
      assert.deepEqual({...readback,review:{...readback.review,by:original.review.by}},original,'only human review attribution changes in audit projection')
      await page.screenshot({path:join(packet,'agents-after-'+width+'.png'),fullPage:true})
      const summary={width,counts:after.counts,eligibleBefore:before.eligible.map(row=>({id:row.id,state:row.state})),eligibleAfter:after.eligible.map(row=>({id:row.id,state:row.state})),marked:{id:marked.id,decisionId:marked.decision_id,person:sponsor.id,name:sponsor.name,at:marked.marked_at},nativeBeforeSha256:digest(nativeBefore),nativeAfterSha256:digest(await snapshot()),auditCount:auditAfter.length}
      receipt.widths.push(summary)
      check('weekly-'+width,'All class and decision totals match at '+width+'; before-week and future rows excluded, exact open and flagged handles matched.')
      check('review-'+width,'Human Mark reviewed records sponsor and fixture time, removes its handle, retains audit identity and exact drafts; agent and anonymous attempts refused.')
    } finally {await context.close()}
  }
  assert.ok(c.points.every(point=>point.ok),'all reused protocol assertions pass')
  receipt.status='pass'
} catch(error) {
  receipt.status='fail'; receipt.error={name:error.name,message:error.message,stack:error.stack}
  console.error(error)
  process.exitCode=1
} finally {
  if(browser)await browser.close()
  if(h)await h.close()
  await writeFile(join(packet,'audit-review-receipt.json'),JSON.stringify(receipt,null,2)+'\n')
}
