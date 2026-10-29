import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {chromium} from '@playwright/test'

// The native person sees the same named agent, retained reviews and refusals.
// Optional local screenshots stay outside the public source tree.
export default async function ({request,origin,cookie}) {
  const inventory=await request(origin+'/agents/api/agents',{headers:{Cookie:cookie}})
  assert.equal(inventory.status,200)
  const {agents}=await inventory.json()
  assert.ok(agents.some(a=>a.sponsor?.id&&a.name))
  const audit=await request(origin+'/agents/api/audit?limit=500',{headers:{Cookie:cookie}})
  assert.equal(audit.status,200)
  const evidence=await audit.json()
  assert.equal(evidence.differs_from_policy,0)
  assert.ok(evidence.rows.some(row=>row.outcome==='refused'))
  if(!process.env.LODGE_EVIDENCE)return
  await mkdir(process.env.LODGE_EVIDENCE,{recursive:true})
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:1000}})
      try {
        const page=await context.newPage()
        await page.route('**/*',async route=>{
          const incoming=route.request(),url=new URL(incoming.url())
          if(url.origin!==origin)return route.abort()
          const response=await request(url.href,{method:incoming.method(),headers:{...incoming.headers(),Cookie:cookie},body:incoming.postDataBuffer()??undefined})
          const headers=Object.fromEntries(response.headers)
          for(const name of ['content-encoding','content-length','transfer-encoding','set-cookie'])delete headers[name]
          await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())})
        })
        await page.goto(origin+'/agents')
        await page.getByRole('heading',{name:'Agents',exact:true}).waitFor()
        if(width===1440) {
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
          const controls=await page.locator('button:visible').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height))
          assert.ok(controls.every(height=>height>=44))
        }
        await page.screenshot({path:join(process.env.LODGE_EVIDENCE,`agents-${width}.png`),fullPage:true})
      } finally {await context.close()}
    }
  } finally {await browser.close()}
}
