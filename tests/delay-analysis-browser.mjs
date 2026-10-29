import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { delayDraft } from './delay-analysis-flow.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

/** One native review journey at desktop width; capture the changed screens at both release widths. */
export async function delayAnalysisPage(browser, { root, origin, run, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const owner = await session(browser, root, origin, 'owner', 1440), { page, context } = owner
  let agentEmail
  let agent
  try {
    const job = await run('vacancy', { title: 'Synthetic delay diagnosis review', location: 'Denver, CO', manager: ownerEmail, headcount: 2, compensation: RANGE })
    await run('rubric', { id: job.id, criteria: RUBRIC })
    await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
    const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Reviewed headcount' })
    const published = await run('publish', { id: job.id })
    const add = async n => (await run('candidate', { name: 'Synthetic delay case ' + n, email: ['synthetic-lodge-delay-browser-' + n, 'example.test'].join('@'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    const first = await add(1), second = await add(2)
    for (const app of [first, second]) await run('move', { application: app.id, to: job.stages[1].id, reason: 'Human reviewed case' })
    const offer = await run('offer', { application: first.id, opening: published.openings[0].id, startDate: '2027-01-01', salary: { currency: 'USD', amount: 9500000, period: 'year' } })
    const requested = await run('request-offer-approval', { id: offer.id, approver: ownerEmail })
    await run('decide-approval', { id: requested.id, version: requested.version, decision: 'approved', reason: 'Reviewed exact terms' })
    await run('offer-outcome', { id: offer.id, outcome: 'declined', reason: 'Recorded response' })
    const iv = await run('interview', { application: first.id, planItem: published.plan[0].id, participants: [ownerEmail], slots: ['2030-10-10T12:00:00.000Z'] })
    await run('availability', { interview: iv.id, slots: [0] })
    assert.equal((await context.request.post(origin + '/availability/' + iv.candidateToken, { headers: { origin }, form: { slot: '0' } })).status(), 200)
    await run('schedule', { interview: iv.id, slot: 0 })
    const acceptedOffer = await run('offer', { application: second.id, opening: published.openings[1].id, startDate: '2027-01-01', salary: { currency: 'USD', amount: 9500000, period: 'year' } })
    const acceptedApproval = await run('request-offer-approval', { id: acceptedOffer.id, approver: ownerEmail })
    await run('decide-approval', { id: acceptedApproval.id, version: acceptedApproval.version, decision: 'approved', reason: 'Reviewed second offer terms' })
    await run('offer-outcome', { id: acceptedOffer.id, outcome: 'accepted', reason: 'Human recorded acceptance' })
    agentEmail = ['synthetic-lodge-delay-agent-' + job.id.slice(0, 8), 'dev.localhost'].join('@')
    await run('member', { email: agentEmail, name: 'Synthetic delay browser agent', roles: [], agent: true, actsFor: ownerEmail })
    const invitation = await context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email: agentEmail } })
    assert.equal(invitation.status(), 200)
    agent = await session(browser, root, origin, agentEmail, 1440)
    const response = await agent.context.request.get(origin + '/api/lodge/delay-analysis?vacancy=' + job.id)
    assert.equal(response.status(), 200)
    const report = await response.json()
    assert.deepEqual(report.scheduling.map(row => [row.measured, row.unknown]), [[1, 0], [1, 0], [1, 0]])
    const body = delayDraft(report, ownerEmail)
    body.measurement.metric = 'mean-submission-to-acceptance-hours'
    body.measurement.targetHours = report.hiring.elapsed.meanHours * 0.8
    body.findings[0].citations.push(report.sources.find(s => s.kind === 'application' && s.id === second.id))
    body.findings[0].citations.push({ ...report.sources.find(s => s.kind === 'interview'), observation: 2 })
    body.summary += ' ' + job.id.slice(0, 8)
    body.sampleLimits = 'Two cases in this browser cohort; incomplete and unfinished histories remain excluded from means.'
    const packet = await api(agent.context, origin, 'propose', body)
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    const panel = page.getByRole('region', { name: 'Native delay evidence', exact: true })
    await panel.getByText('Inspect native delay evidence', { exact: true }).click()
    await panel.getByLabel('Delay evidence job').selectOption(job.id)
    await panel.getByRole('button', { name: 'Load delay evidence', exact: true }).click()
    await panel.getByText('2 cases · 3 completed stage intervals', { exact: false }).waitFor()
    assert.deepEqual([report.hiring.elapsed.measuredApplications, report.hiring.elapsed.unknownApplications], [1, 1])
    assert.ok((await panel.innerText()).includes('1 measured applications · 1 unknown'), 'the joined metric distinguishes the measured application from the case without acceptance')
    const sourceCase = panel.getByText('Source case: Synthetic delay case 1', { exact: true }).locator('..')
    await sourceCase.locator('summary').first().click()
    await sourceCase.getByText('Exact event citation', { exact: true }).first().click()
    const acceptedCase = panel.getByText('Source case: Synthetic delay case 2', { exact: true }).locator('..')
    await acceptedCase.locator('summary').first().click()
    assert.ok((await acceptedCase.innerText()).includes('Submission to recorded acceptance: '))
    assert.ok((await acceptedCase.innerText()).includes(report.cases.find(c => c.application === second.id).hiring.submittedAt))
    assert.ok((await acceptedCase.innerText()).includes(acceptedOffer.id), 'the native interval drills through to its actual accepted-offer source')
    const capture = async name => {
      await iconTooltips(page)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    assert.ok((await panel.innerText()).includes('Survey feedback: unknown'))
    assert.ok((await sourceCase.innerText()).includes('1 of 1 panel declarations'))
    assert.ok((await sourceCase.innerText()).includes(report.sources.find(s => s.kind === 'interview').revision))
    const waits = panel.getByRole('region', { name: 'Recorded scheduling waits', exact: true })
    assert.equal(await waits.getByRole('row').count(), 4)
    assert.ok((await sourceCase.innerText()).includes('observations 3, 4'), 'the measured queue links its availability and schedule observations')
    await panel.getByRole('button', { name: 'Read human-only survey context' }).click()
    await panel.getByText('No retained survey observations for this job.', { exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await capture('delay-source-drill')
    const draft = page.getByRole('article', { name: 'Delay diagnosis draft', exact: true }).filter({ hasText: body.summary })
    await draft.getByText('Finding citations', { exact: true }).click()
    await draft.getByText('Evidence read for this draft', { exact: true }).click()
    assert.ok((await draft.innerText()).includes('No hiring decision or configuration changes here'))
    assert.ok((await draft.innerText()).includes(report.sources.find(s => s.kind === 'offer').revision))
    assert.ok((await draft.innerText()).includes('Observation 3: candidate-availability'), 'the draft shows the exact cited observation')
    assert.ok((await draft.innerText()).includes('applications with recorded acceptance'), 'the draft retains the joined application denominator')
    await capture('delay-draft-review')
    const before = await current(context, origin)
    await draft.getByLabel('Draft decision').selectOption('rejected')
    await draft.getByLabel('Draft review reason', { exact: true }).fill('Need a larger cohort before a trial')
    await draft.getByRole('button', { name: 'Record draft review', exact: true }).click()
    await draft.getByText('Agent-authored diagnosis draft · rejected', { exact: true }).waitFor()
    const after = await current(context, origin)
    for (const key of ['applications', 'offers', 'vacancies', 'sandboxes']) assert.deepEqual(after[key], before[key])
    await capture('delay-rejected-draft')
    await panel.getByText('Source case: Synthetic delay case 1', { exact: true }).click()
    await sourceCase.getByRole('button', { name: 'Open application history', exact: true }).click()
    await page.getByRole('heading', { name: 'Synthetic delay case 1', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Apply change', exact: true }).count(), 0, 'a diagnosis is not offered as a hiring command')
    await capture('delay-application-history')
    assert.equal(after.proposals.find(p => p.id === packet.id).status, 'rejected')
    const date = at => new Intl.DateTimeFormat('sv-SE', { timeZone: report.cohort.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
    const bounded = await (await agent.context.request.get(origin + '/api/lodge/delay-analysis?vacancy=' + job.id + '&from=' + date(first.submittedAt) + '&to=' + date(second.submittedAt))).json()
    const trialBody = delayDraft(bounded, ownerEmail); trialBody.summary = 'Synthetic native queue trial ' + job.id.slice(0, 8)
    trialBody.measurement.metric = 'mean-ready-to-schedule-hours'
    trialBody.measurement.targetHours = bounded.scheduling.find(row => row.metric === 'readyToSchedule').meanHours * 0.8
    const trialPacket = await api(agent.context, origin, 'propose', trialBody)
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    const trialDraft = page.getByRole('article', { name: 'Delay diagnosis draft', exact: true }).filter({ hasText: trialBody.summary })
    await trialDraft.getByLabel('Draft decision').selectOption('accepted')
    await trialDraft.getByLabel('Draft review reason', { exact: true }).fill('Review an internal task sandbox without candidate contact')
    await trialDraft.getByRole('button', { name: 'Record draft review', exact: true }).click()
    await trialDraft.getByRole('button', { name: 'Open native trial settings', exact: true }).click()
    const settings = page.getByRole('region', { name: 'Native delay trial settings', exact: true })
    await settings.getByText('Trial for ' + trialBody.summary, { exact: true }).click()
    await settings.getByLabel('Hours before an internal review task').fill('12')
    await settings.getByRole('button', { name: 'Preview internal task trial', exact: true }).click()
    await settings.getByText('Trial status: review', { exact: true }).waitFor()
    assert.ok((await settings.innerText()).includes('10 interviews'), 'trial settings retain the reviewed measurement denominator')
    await capture('delay-native-trial-preview')
    await settings.getByLabel('Approve this exact internal task policy', { exact: true }).check()
    await settings.getByRole('button', { name: 'Activate reviewed native trial', exact: true }).click()
    await settings.getByText('Trial status: active', { exact: true }).waitFor()
    await settings.getByRole('button', { name: 'Measure observed comparison', exact: true }).click()
    await settings.getByText('Insufficient sample or comparison window still open', { exact: false }).waitFor()
    await capture('delay-native-trial-comparison')
    await settings.getByRole('button', { name: 'Roll back native trial', exact: true }).click()
    await settings.getByText('Trial status: rolled-back', { exact: true }).waitFor()
    const ended = await current(context, origin)
    assert.equal(ended.proposals.find(p => p.id === trialPacket.id).delayTrial.status, 'rolled-back')
    for (const key of ['applications', 'offers', 'vacancies', 'sandboxes']) assert.deepEqual(ended[key], after[key], 'native trial configuration changes no hiring records')
  } catch (error) {
    await page.screenshot({ path: evidence + '/delay-failure.png', fullPage: true })
    throw error
  } finally { await agent?.context.close(); await context.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('@playwright/test')
  const { start } = await import('./browser-runtime.mjs')
  const root = process.cwd(), server = await start(root, 8787)
  const browser = await chromium.launch({ executablePath: process.env.LODGE_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    const owner = await session(browser, root, server.origin, 'owner', 1440)
    try {
      const w = await current(owner.context, server.origin)
      if (!w.business) await api(owner.context, server.origin, 'business', (await import('./harness.mjs')).BUSINESS)
      await delayAnalysisPage(browser, { root, origin: server.origin, run: (op, body) => api(owner.context, server.origin, op, body), evidence: process.env.LODGE_EVIDENCE, ownerEmail: w.actor.email })
    } finally { await owner.context.close() }
    console.log('Native delay diagnosis browser journey passed at 1440; screenshots captured at 1440 and 390')
  } finally { await browser.close(); await server.close() }
}
