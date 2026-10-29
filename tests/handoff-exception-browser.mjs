import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { handoffAddress, handoffJob, handoffProposal } from './handoff-exception-flow.mjs'

/** Assertions run at desktop width; the changed states are also captured on a phone. */
export async function handoffExceptionPage(browser, { root, origin, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const { page, context } = await session(browser, root, origin, 'owner', 1440), errors = []
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  const run = (op, body) => api(context, origin, op, body)
  let agent, approvalSession
  const capture = async name => {
    await iconTooltips(page)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  try {
    const suffix = '-' + crypto.randomUUID().slice(0, 8)
    const approvalEmail = handoffAddress('browser-approver' + suffix)
    await run('member', { email: approvalEmail, name: 'Synthetic Lodge independent approver', roles: ['approver'] })
    assert.equal((await context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email: approvalEmail } })).status(), 200)
    approvalSession = await session(browser, root, origin, approvalEmail, 1440)
    const f = await handoffJob(run, ownerEmail, ownerEmail, suffix, approvalEmail, (op, body) => api(approvalSession.context, origin, op, body))
    await page.goto(origin + '/app?settings=handoff')
    const settings = page.getByRole('region', { name: 'Handoff preflight settings', exact: true })
    await settings.getByLabel('Handoff job', { exact: true }).selectOption(f.job.id)
    await settings.getByLabel('Candidate phone', { exact: true }).check()
    await settings.getByLabel('Job department', { exact: true }).check()
    await settings.getByRole('button', { name: 'Save handoff fields', exact: true }).click()
    await settings.getByText('Administrative handoff fields saved.', { exact: true }).waitFor()
    await capture('handoff-settings')
    const agentEmail = handoffAddress('browser-agent' + suffix)
    await run('member', { email: agentEmail, name: 'Synthetic Lodge handoff agent', roles: [], agent: true, actsFor: ownerEmail })
    assert.equal((await context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email: agentEmail } })).status(), 200)
    agent = await session(browser, root, origin, agentEmail, 1440)
    const response = await agent.context.request.get(origin + '/api/lodge/handoff-preflight/' + f.offers[0].id)
    assert.equal(response.status(), 200)
    const row = await response.json(), packet = await api(agent.context, origin, 'propose', { ...handoffProposal(row, ownerEmail), deadline: '2020-01-10T17:00:00.000Z' })
    const before = await current(context, origin)
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    const view = page.getByRole('region', { name: 'Handoff exceptions', exact: true })
    const proposal = view.getByRole('article', { name: 'Handoff proposal for ' + f.people[0].candidate.name, exact: true })
    await proposal.waitFor()
    await proposal.getByText('Signature artifacts and exact sources', { exact: true }).click()
    const content = await proposal.innerText()
    assert.ok(content.includes(row.signature.artifacts[0].sha256))
    assert.ok(content.includes(row.offerRevision))
    assert.ok(content.includes('Candidate phone: Missing') && content.includes('Job department: Missing'))
    assert.ok(content.includes('Human attestation only; not provider-verified.'))
    assert.ok(content.includes('Stored bytes match') && content.includes('Handoff incomplete'))
    await view.getByText('Current local preflights', { exact: true }).click()
    const unsigned = view.getByRole('article', { name: 'Handoff preflight for ' + f.people[1].candidate.name, exact: true })
    assert.ok((await unsigned.innerText()).includes('Recorded acceptance without signature'))
    assert.ok((await unsigned.innerText()).includes('Recorded acceptance is unsigned'))
    await capture('handoff-source-review')
    await proposal.getByLabel('Handoff decision').selectOption('accepted')
    await proposal.getByLabel('Handoff review reason', { exact: true }).fill('Approve the named owner and local next action; destination remains unverified')
    await proposal.getByRole('button', { name: 'Review handoff ownership', exact: true }).click()
    await proposal.getByText('Agent-authored proposal · accepted', { exact: true }).waitFor()
    const owned = view.getByRole('article', { name: 'Owned handoff for ' + f.people[0].candidate.name, exact: true })
    await owned.waitFor()
    assert.ok((await owned.innerText()).includes('Overdue and unresolved'))
    await owned.getByText('Ownership and progress history', { exact: true }).click()
    await capture('handoff-owned-unresolved')
    await owned.getByLabel('Exception next action', { exact: true }).fill('Human to inspect administrative fields and destination record separately')
    await owned.getByLabel('Local exception status').selectOption('stopped')
    await owned.getByLabel('Progress reason', { exact: true }).fill('Explicit human stop while destination access is unavailable')
    await owned.getByRole('button', { name: 'Record handoff progress', exact: true }).click()
    await owned.getByText('Explicitly stopped · Handoff incomplete.', { exact: true }).waitFor()
    const after = await current(context, origin)
    assert.deepEqual(after.offers, before.offers)
    assert.deepEqual(after.applications, before.applications)
    const saved = after.handoffExceptions.cases.find(c => c.id === row.offer)
    assert.deepEqual([saved.history.length, saved.complete, saved.employeeCreated], [2, false, false])
    assert.equal(after.proposals.find(p => p.id === packet.id).status, 'accepted')
    const file = await context.request.get(origin + '/api/lodge/download/handoff/' + row.offer)
    assert.equal(file.status(), 200)
    assert.deepEqual([(await file.json()).complete, (await file.json()).employeeCreated], [false, false])
    await capture('handoff-explicit-stop')
    await proposal.getByRole('button', { name: 'Open source application', exact: true }).click()
    await page.getByRole('heading', { name: f.people[0].candidate.name, exact: true }).waitFor()
    assert.deepEqual(errors, [])
  } catch (error) {
    await page.screenshot({ path: evidence + '/handoff-failure.png', fullPage: true, timeout: 10000 }).catch(() => {})
    throw error
  } finally { await approvalSession?.context.close(); await agent?.context.close(); await context.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('@playwright/test')
  const { start } = await import('./browser-runtime.mjs')
  const root = process.cwd(), server = await start(root, 8787)
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    const owner = await session(browser, root, server.origin, 'owner', 1440)
    let ownerEmail
    try {
      const w = await current(owner.context, server.origin); ownerEmail = w.actor.email
      if (!w.business) await api(owner.context, server.origin, 'business', (await import('./harness.mjs')).BUSINESS)
    } finally { await owner.context.close() }
    await handoffExceptionPage(browser, { root, origin: server.origin, evidence: process.env.LODGE_EVIDENCE, ownerEmail })
    console.log('Native handoff browser journey passed at 1440; changed screens captured at 1440 and 390')
  } finally { await browser.close(); await server.close() }
}
