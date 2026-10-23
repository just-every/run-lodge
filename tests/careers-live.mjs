// Explicit sandbox journey, never run by push Verify. All resources are run-owned and removed.
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const deployKit = new URL('./', import.meta.resolve('@runeditrun/rer/modules/deploy-kit/provider'))
const { uploadWorker } = await import(new URL('worker.mjs', deployKit))
const { packageBuild } = await import(new URL('prepare.mjs', deployKit))
import { BUSINESS } from './harness.mjs'
import { brandInput, employerLogo, careersJob } from './careers-driver.mjs'
import { careersPublicPage } from './careers-driver.mjs'

const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN
assert.equal(account, 'b20c0ca9cab0c2b70e13d7cf724b89bd', 'sandbox must use RunEditRun')
assert.ok(token, 'run via the held-key helper')
const worker = 'lodge-sx-c22-proof', hostname = 'careers-sx-lodge-c22.loadseed.com', zone = 'e7b4a4cb93088b96f08e7c4cfd5c08c3'
const origin = `https://${worker}.runeditrun.workers.dev`
const evidence = resolve(process.env.LODGE_EVIDENCE ?? '.cache/careers-live')
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'commit the exact sandbox candidate before running')
const deployment = JSON.parse(await readFile('deploy.json', 'utf8'))
let database, uploaded = false, txtId, browser, ownerContext
async function api(path, { method = 'GET', body, assetToken } = {}) {
  const full = path.startsWith('/zones/') ? path : '/accounts/' + account + path
  const multipart = body instanceof FormData
  const r = await fetch('https://api.cloudflare.com/client/v4' + full, { method, redirect: 'manual', headers: { authorization: 'Bearer ' + (assetToken ?? token), ...(!multipart && body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) })
  const text = await r.text()
  if (method === 'DELETE' && r.ok && !text) return null
  let j; try { j = JSON.parse(text) } catch { throw new Error('Cloudflare sandbox response was not JSON for ' + method + ' ' + path.split('?')[0]) }
  if (!r.ok || j.success !== true) { const error = new Error('Cloudflare sandbox ' + method + ' ' + path.split('?')[0] + ' returned HTTP ' + r.status); error.status = r.status; throw error }
  return j.result
}
const delay = ms => new Promise(r => setTimeout(r, ms))
try {
  await mkdir(evidence, { recursive: true })
  try { await api('/workers/scripts/' + worker + '/settings'); throw new Error('Sandbox Worker already exists; refusing to replace it') } catch (e) { if (e.status !== 404) throw e }
  assert.equal((await api('/d1/database?name=' + worker)).length, 0, 'sandbox database name must be unused')
  assert.equal((await api('/zones/' + zone + '/dns_records?name=' + hostname)).length, 0)
  assert.equal((await api('/workers/domains')).filter(d => d.hostname === hostname).length, 0)
  database = await api('/d1/database', { method: 'POST', body: { name: worker } })
  for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort()) await api('/d1/database/' + database.uuid + '/query', { method: 'POST', body: { sql: await readFile('migrations/core/' + file, 'utf8') } })
  console.log('Building the real installed Worker and browser assets')
  const buildEnv = { PATH: resolve(process.execPath, '..') + ':' + process.env.PATH, HOME: process.env.HOME, CI:'true', WRANGLER_SEND_METRICS:'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false' }
  execFileSync(process.execPath, [fileURLToPath(import.meta.resolve('@runeditrun/rer/internal/global/rer.mjs')), 'build'], { env:buildEnv, stdio:'pipe', timeout:900000, maxBuffer:4*1024*1024 })
  const artifact = await packageBuild({ root:process.cwd(), source:{sha:head,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim()}, runIdentity:{id:'0',attempt:'1'}, productDirectory:'' })
  const setupToken = crypto.randomUUID() + crypto.randomUUID(), sessionSecret = crypto.randomUUID() + crypto.randomUUID()
  const bindings = [{ type: 'd1', name: 'DB', id: database.uuid }, { type: 'assets', name: 'ASSETS' }, ...Object.entries({ AUTH_ORIGIN: origin, OWNER_EMAIL: 'owner@example.test', CAREERS_CF_ACCOUNT_ID: account, CAREERS_CF_ZONE_ID: zone, CAREERS_CF_WORKER: worker, RER_DEPLOY_SOURCE: head }).map(([name,text]) => ({ type: 'plain_text', name, text }))]
  const secrets = { bindings: [{ type:'secret_text', name:'SETUP_TOKEN', text:setupToken }, { type:'secret_text', name:'SESSION_SECRET', text:sessionSecret }, { type:'secret_text', name:'CAREERS_CF_API_TOKEN', text:token }] }
  await uploadWorker({ request: api }, { plan: { worker, compatibilityDate: deployment.compatibilityDate, compatibilityFlags: deployment.compatibilityFlags }, artifact, bindings, secrets, fingerprint:head })
  uploaded = true
  await api('/workers/scripts/' + worker + '/subdomain', { method:'POST', body:{ enabled:true, previews_enabled:false } })
  let ready = false
  for (let i=0;i<12;i++) { try { ready = (await fetch(origin+'/health')).ok } catch {} if (ready) break; console.log('Waiting for sandbox Worker routing'); await delay(10000) }
  assert.ok(ready)
  const {chromium}=await import(process.env.LODGE_PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.LODGE_PLAYWRIGHT_MODULE)).href:'@playwright/test')
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  ownerContext=await browser.newContext({viewport:{width:1440,height:1000}})
  const ownerPage=await ownerContext.newPage()
  const boot=await ownerContext.request.post(origin+'/auth/bootstrap',{headers:{origin},data:{token:setupToken,displayName:'Hudson Owner'},maxRedirects:0})
  assert.equal(boot.status(),303,'native owner bootstrap through this browser context')
  await ownerPage.goto(origin+'/app')
  await ownerPage.getByRole('checkbox').check()
  await ownerPage.getByRole('button',{name:'Finish setup',exact:true}).click()
  await ownerPage.getByRole('navigation',{name:'Workspace',exact:true}).waitFor()
  async function run(op,body,expected=200) {
    const r=await ownerContext.request.post(origin+'/api/lodge/command/'+op,{headers:{origin},data:body})
    assert.equal(r.status(),expected,op+' HTTP status');return r.json()
  }
  async function domain() { const r=await ownerContext.request.get(origin+'/api/lodge/state');assert.equal(r.status(),200);return (await r.json()).careers.domain }
  async function domainScreen(name) {
    for(const width of [1440,390]) {
      await ownerPage.setViewportSize({width,height:1000})
      await ownerPage.goto(origin+'/app')
      await ownerPage.getByRole('navigation',{name:'Workspace',exact:true}).getByRole('button',{name:'People',exact:true}).click()
      const panel=ownerPage.getByRole('article',{name:'Careers custom domain',exact:true})
      await panel.getByText(hostname,{exact:true}).waitFor()
      assert.ok(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
      await panel.screenshot({path:resolve(evidence,`careers-domain-${name}-${width}.png`)})
    }
  }
  await run('business',{...BUSINESS,name:'Hudson Builders'})
  await run('careers-brand',{...brandInput,logo:await employerLogo()})
  const jobs={onsite:await careersJob(run,'Residential site supervisor'),remote:await careersJob(run,'Remote project coordinator','remote','Austin, TX')}
  await ownerPage.goto(origin+'/app')
  await ownerPage.getByRole('navigation',{name:'Workspace',exact:true}).getByRole('button',{name:'People',exact:true}).click()
  const domainPanel=ownerPage.getByRole('article',{name:'Careers custom domain',exact:true})
  await domainPanel.getByLabel('Careers hostname',{exact:false}).fill(hostname)
  await Promise.all([ownerPage.waitForResponse(r=>r.url().endsWith('/api/lodge/command/careers-domain-challenge')&&r.status()===200),domainPanel.getByRole('button',{name:'Create domain challenge',exact:true}).click()])
  let state=await domain()
  await domainScreen('unverified')
  await run('careers-domain-connect',{generation:state.generation},409)
  state=await domain()
  const txt=await api('/zones/'+zone+'/dns_records',{method:'POST',body:{type:'TXT',name:state.dns.name,content:state.dns.value,ttl:60,comment:'sx-lodge-c22 disposable ATTR-001 proof'}})
  txtId=txt.id
  let verified=false
  for(let i=0;i<12;i++) {
    const r=await ownerContext.request.post(origin+'/api/lodge/command/careers-domain-verify',{headers:{origin},data:{generation:state.generation}})
    assert.ok([200,409].includes(r.status()),'DNS verification is successful or explicitly not visible')
    state=await domain();if(r.status()===200){verified=true;break}console.log('Waiting for authoritative DNS challenge visibility');await delay(15000)
  }
  assert.ok(verified,'the live exact TXT ownership challenge verifies')
  await domainScreen('verified')
  await Promise.all([ownerPage.waitForResponse(r=>r.url().endsWith('/api/lodge/command/careers-domain-connect')&&r.status()===200),domainPanel.getByRole('button',{name:'Connect domain and check TLS',exact:true}).click()])
  state=await domain()
  const associations=await api('/workers/domains');const association=associations.find(d=>d.hostname===hostname&&d.service===worker);assert.ok(association)
  await writeFile(resolve(evidence,'cloudflare-domain.json'),JSON.stringify(association,null,2)+'\n')
  for(let i=0;state.tlsStatus!=='ready'&&i<15;i++){console.log('Waiting for managed certificate and HTTPS readback');await delay(20000);state=await run('careers-domain-verify',{generation:state.generation})}
  assert.equal(state.tlsStatus,'ready','a trusted live TLS request answered the current installation challenge')
  assert.equal((await fetch('https://'+hostname+'/api/lodge/state')).status,404)
  assert.equal((await fetch(origin+'/jobs')).status,200)
  await domainScreen('connected')
  await careersPublicPage(browser,{origin:'https://'+hostname,jobs,evidence,prefix:'live-'})
  await Promise.all([ownerPage.waitForResponse(r=>r.url().endsWith('/api/lodge/command/careers-domain-disconnect')&&r.status()===200),domainPanel.getByRole('button',{name:'Disconnect domain',exact:true}).click()])
  state=await domain()
  await domainScreen('disconnected')
  assert.equal(state.status,'disconnected')
  assert.equal((await api('/workers/domains')).some(d=>d.hostname===hostname),false)
  console.log('ATTR-001 live DNS, managed TLS, private-host isolation and 1440/390 careers application/recovery passed at '+head)
} finally {
  await ownerContext?.close()
  await browser?.close()
  // Remove only associations and resources created by this journey.
  if(uploaded){const own=(await api('/workers/domains')).filter(d=>d.hostname===hostname&&d.service===worker);for(const d of own)await api('/workers/domains/'+d.id,{method:'DELETE'});await api('/workers/scripts/'+worker,{method:'DELETE'})}
  if(txtId)await api('/zones/'+zone+'/dns_records/'+txtId,{method:'DELETE'})
  if(database)await api('/d1/database/'+database.uuid,{method:'DELETE'})
}
