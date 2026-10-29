import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { candidateUpdateJob, updateAddress, updateProposal } from './candidate-update-flow.mjs'

/** One desktop sanity journey; the same changed states are photographed at both release widths. */
export async function candidateUpdatePage(browser, { root, origin, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const { page, context } = await session(browser, root, origin, 'owner', 1440), errors = []
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  const run = (op, body) => api(context, origin, op, body)
  let agent, candidateAccount
  const capture = async name => {
    await iconTooltips(page)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  try {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { job, status, rejection, scheduled } = await candidateUpdateJob(run, ownerEmail, ownerEmail, ' ' + suffix)
    const active = await run('candidate', { name: 'Synthetic Lodge debrief ' + suffix, email: updateAddress(suffix + '-1'), source: 'Direct', consentBasis: 'manual', vacancy: job.id })
    const rejected = await run('candidate', { name: 'Synthetic Lodge rejected ' + suffix, email: updateAddress(suffix + '-2'), source: 'Direct', consentBasis: 'manual', vacancy: job.id })
    await run('move', { application: active.application.id, to: job.stages.find(s => s.name === 'Debrief').id, reason: 'Human is waiting for the debrief' })
    await run('move', { application: rejected.application.id, to: 'rejected', closeReason: 'skills', send: 'now', template: scheduled.id, reason: 'Human recorded the disposition' })
    const optedEmail = updateAddress(suffix + '-3')
    const applied = await context.request.post(origin + '/jobs/' + job.slug, { headers: { origin }, form: { name: 'Synthetic Lodge opted out ' + suffix, email: optedEmail, noticeVersion: '1', consent: 'yes' } })
    assert.equal(applied.status(), 200)
    const receipt = (await applied.text()).match(/LDG-[A-F0-9]{8}/)[0]
    await run('member', { email: optedEmail, name: 'Synthetic Lodge candidate', roles: ['interviewer'] })
    assert.equal((await context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email: optedEmail } })).status(), 200)
    candidateAccount = await session(browser, root, origin, optedEmail, 1440)
    assert.equal((await candidateAccount.context.request.post(origin + '/candidate/receipts/' + receipt + '/account/preferences', { headers: { origin }, form: { preference: 'none' }, maxRedirects: 0 })).status(), 303)
    await page.goto(origin + '/app?settings=candidate-updates')
    const settings = page.getByRole('region', { name: 'Candidate response window settings', exact: true })
    await settings.getByLabel('Response window job', { exact: true }).selectOption(job.id)
    await settings.getByLabel('Response window business days', { exact: true }).fill('0')
    await settings.getByLabel('Response window time zone', { exact: true }).fill('America/New_York')
    await settings.getByLabel('Reviewed status template').selectOption(status.id)
    await settings.getByLabel('Reviewed rejection template').selectOption(rejection.id)
    await settings.getByRole('button', { name: 'Save response window', exact: true }).click()
    await settings.getByText('Response window saved · version 1.', { exact: false }).waitFor()
    assert.ok((await settings.innerText()).includes('Sending remains unconnected'))
    await capture('candidate-window-settings')
    const agentEmail = updateAddress(suffix + '-agent')
    await run('member', { email: agentEmail, name: 'Synthetic Lodge external agent', roles: [], agent: true, actsFor: ownerEmail })
    assert.equal((await context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email: agentEmail } })).status(), 200)
    agent = await session(browser, root, origin, agentEmail, 1440)
    const read = await agent.context.request.get(origin + '/api/lodge/candidate-updates')
    assert.equal(read.status(), 200)
    const rows = (await read.json()).cases.filter(r => r.vacancy === job.id)
    assert.deepEqual(rows.map(r => r.application).sort(), [active.application.id, rejected.application.id].sort())
    assert.ok(rows.every(r => r.overdue))
    const packets = []
    for (const row of rows) packets.push(await api(agent.context, origin, 'propose', updateProposal(row, ownerEmail)))
    const before = await current(context, origin)
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    const review = page.getByRole('region', { name: 'Candidate update review', exact: true })
    const draft = review.getByRole('article', { name: 'Update proposal for ' + active.candidate.name, exact: true })
    await draft.waitFor()
    await draft.getByText('Window rules and source revisions', { exact: true }).click()
    assert.ok((await draft.innerText()).includes(rows.find(r => r.application === active.application.id).sources.find(s => s.kind === 'stage-event').revision))
    assert.ok((await review.innerText()).includes('Mailbox correspondence unknown. Delivery unverified.'))
    assert.ok(!(await review.innerText()).includes('Synthetic Lodge opted out ' + suffix))
    const rejectionDraft = review.getByRole('article', { name: 'Update proposal for ' + rejected.candidate.name, exact: true })
    assert.ok((await rejectionDraft.innerText()).includes('Human rejection already recorded'))
    assert.ok((await rejectionDraft.innerText()).includes(rows.find(r => r.application === rejected.application.id).body))
    await capture('candidate-update-review')
    await draft.getByLabel('Update decision').selectOption('accepted')
    await draft.getByLabel('Update review reason', { exact: true }).fill('Keep the exact reviewed text as an unsent draft')
    await draft.getByRole('button', { name: 'Review candidate update', exact: true }).click()
    await draft.getByText('Agent-authored update · accepted · unsent', { exact: true }).waitFor()
    assert.ok((await draft.innerText()).includes('Exact-text approval still required'))
    let after = await current(context, origin)
    for (const key of ['applications', 'vacancies', 'rejectionEmails']) assert.deepEqual(after[key], before[key], key + ' unchanged by draft acceptance')
    const message = after.messages.find(m => m.application === active.application.id && m.candidateUpdate)
    assert.ok(message)
    assert.deepEqual([message.sent, message.delivery, message.complete], [false, 'unverified', false])
    assert.equal((await context.request.get(origin + '/api/lodge/download/message/' + message.id)).status(), 409)
    await capture('candidate-update-accepted-unsent')
    await draft.getByRole('button', { name: 'Review unsent message', exact: true }).click()
    await page.getByRole('heading', { name: active.candidate.name, exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Decisions', exact: true }).click()
    await page.getByRole('heading', { name: message.subject, exact: false }).waitFor()
    // The existing approval door stays distinct from accepting the agent's proposal.
    const request = await run('request-message-approval', { id: message.id, approver: ownerEmail })
    await run('decide-approval', { id: request.id, version: request.version, decision: 'approved', reason: 'Reviewed exact recipient and text' })
    const eml = await context.request.get(origin + '/api/lodge/download/message/' + message.id)
    assert.equal(eml.status(), 200); assert.match(await eml.text(), /X-Unsent: 1/)
    after = await current(context, origin)
    const downloaded = after.messages.find(m => m.id === message.id)
    assert.deepEqual([downloaded.downloads.length, downloaded.sent, downloaded.delivery, downloaded.complete], [1, false, 'unverified', false])
    assert.deepEqual(after.applications, before.applications)
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    await review.getByText('Recorded response windows', { exact: true }).click()
    assert.ok((await review.innerText()).includes('never establish that the candidate was kept informed'))
    await capture('candidate-update-after-eml')
    assert.deepEqual(errors, [])
    assert.equal((await current(context, origin)).proposals.filter(p => packets.some(x => x.id === p.id)).length, 2)
  } catch (error) {
    await page.screenshot({ path: evidence + '/candidate-update-failure.png', fullPage: true, timeout: 10000 }).catch(() => {})
    throw error
  } finally { await candidateAccount?.context.close(); await agent?.context.close(); await context.close() }
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
    await candidateUpdatePage(browser, { root, origin: server.origin, evidence: process.env.LODGE_EVIDENCE, ownerEmail })
    console.log('COORD-005 native browser journey passed at 1440; changed screens captured at 1440 and 390')
  } finally { await browser.close(); await server.close() }
}
