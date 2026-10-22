// Explicit sandbox journey, never run by push Verify. All resources are run-owned and removed.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const deployKit = new URL('./', import.meta.resolve('@runeditrun/rer/modules/deploy-kit/provider'))
const { uploadWorker } = await import(new URL('worker.mjs', deployKit))
const { collectFiles, publicAssetPaths } = await import(new URL('artifact.mjs', deployKit))
import { BUSINESS } from './harness.mjs'
import { brandInput, employerLogo, careersJob } from './careers-flow.mjs'
import { careersPublicPage } from './careers-page.mjs'

const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN
assert.equal(account, 'b20c0ca9cab0c2b70e13d7cf724b89bd', 'sandbox must use RunEditRun')
assert.ok(token, 'run via the held-key helper')
const worker = 'lodge-sx-c22-proof', hostname = 'careers-sx-lodge-c22.loadseed.com', zone = 'e7b4a4cb93088b96f08e7c4cfd5c08c3'
const origin = `https://${worker}.runeditrun.workers.dev`
const evidence = resolve(process.env.LODGE_EVIDENCE ?? '.cache/careers-live')
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'commit the exact sandbox candidate before running')
const deployment = JSON.parse(await readFile('deploy.json', 'utf8'))
let database, uploaded = false, txtId, browser, domainId
async function api(path, { method = 'GET', body, assetToken } = {}) {
  const full = path.startsWith('/zones/') ? path : '/accounts/' + account + path
  const multipart = body instanceof FormData
  const r = await fetch('https://api.cloudflare.com/client/v4' + full, { method, redirect: 'manual', headers: { authorization: 'Bearer ' + (assetToken ?? token), ...(!multipart && body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) })
  const j = await r.json()
  if (!r.ok || j.success !== true) { const error = new Error('Cloudflare sandbox ' + method + ' ' + path.split('?')[0] + ' returned HTTP ' + r.status); error.status = r.status; throw error }
  return j.result
}
const delay = ms => new Promise(r => setTimeout(r, ms))
try {
  await mkdir(evidence, { recursive: true })
  try { await api('/workers/scripts/' + worker); throw new Error('Sandbox Worker already exists; refusing to replace it') } catch (e) { if (e.status !== 404) throw e }
  assert.equal((await api('/d1/database?name=' + worker)).length, 0, 'sandbox database name must be unused')
  assert.equal((await api('/zones/' + zone + '/dns_records?name=' + hostname)).length, 0)
  assert.equal((await api('/workers/domains')).filter(d => d.hostname === hostname).length, 0)
  database = await api('/d1/database', { method: 'POST', body: { name: worker } })
  for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort()) await api('/d1/database/' + database.uuid + '/query', { method: 'POST', body: { sql: await readFile('migrations/core/' + file, 'utf8') } })
  const bundle = await build({ entryPoints: ['tests/lodge-worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd','worker','browser'], external: ['node:*'], loader: { '.css': 'text' }, target: 'es2023', logLevel: 'error' })
  const assets = await collectFiles('public'), allowed = new Set(publicAssetPaths(assets.map(f => f.path)))
  const setupToken = crypto.randomUUID() + crypto.randomUUID(), sessionSecret = crypto.randomUUID() + crypto.randomUUID()
  const bindings = [{ type: 'd1', name: 'DB', id: database.uuid }, { type: 'assets', name: 'ASSETS' }, ...Object.entries({ AUTH_ORIGIN: origin, OWNER_EMAIL: 'owner@example.test', CAREERS_CF_ACCOUNT_ID: account, CAREERS_CF_ZONE_ID: zone, CAREERS_CF_WORKER: worker, RER_DEPLOY_SOURCE: head }).map(([name,text]) => ({ type: 'plain_text', name, text }))]
  const secrets = { bindings: [{ type:'secret_text', name:'SETUP_TOKEN', text:setupToken }, { type:'secret_text', name:'SESSION_SECRET', text:sessionSecret }, { type:'secret_text', name:'CAREERS_CF_API_TOKEN', text:token }] }
  await uploadWorker({ request: api }, { plan: { worker, compatibilityDate: deployment.compatibilityDate, compatibilityFlags: deployment.compatibilityFlags }, artifact: { main:'lodge.mjs', modules:[{path:'lodge.mjs',base64:Buffer.from(bundle.outputFiles[0].text).toString('base64')}], assets:assets.filter(f=>allowed.has(f.path)) }, bindings, secrets, fingerprint:head })
  uploaded = true
  await api('/workers/scripts/' + worker + '/subdomain', { method:'POST', body:{ enabled:true, previews_enabled:false } })
  let ready = false
  for (let i=0;i<12;i++) { try { ready = (await fetch(origin+'/health')).ok } catch {} if (ready) break; console.log('Waiting for sandbox Worker routing'); await delay(10000) }
  assert.ok(ready)
  const boot = await fetch(origin+'/auth/bootstrap', { method:'POST', redirect:'manual', headers:{origin,'content-type':'application/json'}, body:JSON.stringify({token:setupToken,displayName:'Hudson Owner'}) })
  assert.equal(boot.status,303,'native owner bootstrap')
  const cookie = boot.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  assert.ok(cookie)
  async function run(op,body, expected=200) {
    const r=await fetch(origin+'/api/lodge/command/'+op,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)})
    assert.equal(r.status,expected,op+' HTTP status'); return r.json()
  }
  async function domain() { const r=await fetch(origin+'/api/lodge/state',{headers:{cookie}});assert.equal(r.status,200);return (await r.json()).careers.domain }
  await run('business',{...BUSINESS,name:'Hudson Builders'})
  await run('careers-brand',{...brandInput,logo:await employerLogo()})
  const jobs={onsite:await careersJob(run,'Residential site supervisor'),remote:await careersJob(run,'Remote project coordinator','remote','Austin, TX')}
  let state=await run('careers-domain-challenge',{hostname})
  await run('careers-domain-connect',{generation:state.generation},409)
  state=await domain()
  const txt=await api('/zones/'+zone+'/dns_records',{method:'POST',body:{type:'TXT',name:state.dns.name,content:state.dns.value,ttl:60,comment:'sx-lodge-c22 disposable ATTR-001 proof'}})
  txtId=txt.id
  let verified=false
  for(let i=0;i<12;i++) {
    const r=await fetch(origin+'/api/lodge/command/careers-domain-verify',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({generation:state.generation})})
    assert.ok([200,409].includes(r.status),'DNS verification is successful or explicitly not visible')
    state=await domain();if(r.status===200){verified=true;break}console.log('Waiting for authoritative DNS challenge visibility');await delay(15000)
  }
  assert.ok(verified,'the live exact TXT ownership challenge verifies')
  state=await run('careers-domain-connect',{generation:state.generation})
  const associations=await api('/workers/domains');domainId=associations.find(d=>d.hostname===hostname&&d.service===worker)?.id;assert.ok(domainId)
  for(let i=0;state.tlsStatus!=='ready'&&i<15;i++){console.log('Waiting for managed certificate and HTTPS readback');await delay(20000);state=await run('careers-domain-verify',{generation:state.generation})}
  assert.equal(state.tlsStatus,'ready','a trusted live TLS request answered the current installation challenge')
  assert.equal((await fetch('https://'+hostname+'/api/lodge/state')).status,404)
  assert.equal((await fetch(origin+'/jobs')).status,200)
  const {chromium}=await import(process.env.LODGE_PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.LODGE_PLAYWRIGHT_MODULE)).href:'@playwright/test')
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await careersPublicPage(browser,{origin:'https://'+hostname,jobs,evidence,prefix:'live-'})
  await browser.close();browser=null
  state=await run('careers-domain-disconnect',{generation:state.generation})
  assert.equal(state.status,'disconnected')
  assert.equal((await api('/workers/domains')).some(d=>d.hostname===hostname),false)
  domainId=null
  await writeFile(resolve(evidence,'sandbox.json'),JSON.stringify({head,hostname,worker,account,database:database.uuid,zone,verifiedDns:true,httpsReadback:true,privateRoutesRefused:true,installationJobsAvailable:true,publicJourneyWidths:[1440,390],disconnected:true,at:new Date().toISOString()},null,2)+'\n')
  console.log('ATTR-001 live DNS, managed TLS, private-host isolation and 1440/390 careers application/recovery passed at '+head)
} finally {
  await browser?.close()
  // Remove only associations and resources created by this journey.
  if(uploaded){const own=(await api('/workers/domains')).filter(d=>d.hostname===hostname&&d.service===worker);for(const d of own)await api('/workers/domains/'+d.id,{method:'DELETE'});await api('/workers/scripts/'+worker,{method:'DELETE'})}
  if(txtId)await api('/zones/'+zone+'/dns_records/'+txtId,{method:'DELETE'})
  if(database)await api('/d1/database/'+database.uuid,{method:'DELETE'})
}
