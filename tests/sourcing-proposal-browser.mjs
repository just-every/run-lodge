import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { sourcingCase, sourcingPacket, resumePassage } from './sourcing-proposal-flow.mjs'

/** Exercise review at one width and inspect the changed screens once at both release widths. */
export async function sourcingProposalPage(browser, { root, origin, run, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const owner = await session(browser, root, origin, 'owner', 1440)
  const { page, context } = owner
  let agent, agentEmail
  try {
    const f = await sourcingCase(run, ownerEmail, '-' + Date.now())
    const id = f.job.id.slice(0, 8)
    agentEmail = ['synthetic-lodge-sourcing-agent-' + id, 'dev.localhost'].join('@')
    await run('member', { email: agentEmail, name: 'Synthetic sourcing browser agent', roles: [], agent: true, actsFor: ownerEmail })
    const invitation = await context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email: agentEmail } })
    assert.equal(invitation.status(), 200)
    agent = await session(browser, root, origin, agentEmail, 1440)
    const evidencePath = '/api/lodge/sourcing-evidence?brief=' + f.brief.id + '&candidate=' + f.candidate.id
    const response = await agent.context.request.get(origin + evidencePath)
    assert.equal(response.status(), 200)
    const report = await response.json(), packet = await api(agent.context, origin, 'propose', sourcingPacket(report, ownerEmail))
    const visibleTemplate = (await current(context, origin)).messageTemplates.find(t => t.id === f.template.id)
    assert.ok(visibleTemplate, 'the human reviewer can select the reviewed role template')
    const tab = label => page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: label, exact: true }).click()
    await page.reload(); await tab('Settings')
    const settings = page.getByRole('region', { name: 'Sourcing research settings', exact: true })
    await settings.getByLabel('Sourcing role', { exact: true }).selectOption(f.job.id)
    await settings.getByRole('checkbox', { name: 'Takeoffs: Describes concrete takeoff work', exact: true }).check()
    await settings.locator('select[name=template]').selectOption(f.template.id)
    await settings.getByLabel('I reviewed these criteria, template and language', { exact: true }).check()
    await settings.getByRole('button', { name: 'Save sourcing criteria', exact: true }).click()
    await page.getByText('Saved.', { exact: true }).waitFor()
    assert.ok((await current(context, origin)).sourcingBriefs.filter(b => b.vacancy === f.job.id).length >= 2, 'a human selects the actual role criteria in Settings')
    const capture = async name => {
      await iconTooltips(page)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await capture('sourcing-settings')
    await tab('Proposals')
    const draft = page.getByRole('article', { name: 'Sourcing research draft', exact: true }).filter({ hasText: packet.summary })
    await draft.getByText('Inspect cited source', { exact: true }).click()
    await draft.getByText('Consent and retention evidence', { exact: true }).click()
    await draft.getByText('Template review provenance', { exact: true }).click()
    assert.ok((await draft.innerText()).includes(resumePassage))
    assert.ok((await draft.innerText()).includes(packet.claims[0].source.revision))
    assert.ok((await draft.innerText()).includes('Talent-pool permission: recorded'))
    assert.ok((await draft.innerText()).includes(packet.research.template.revision))
    assert.ok((await draft.innerText()).includes('Unsent · human-selected language en'))
    assert.equal(await draft.getByRole('button', { name: /send|apply|book|activate/i }).count(), 0)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'research screen fits at the assertion width')
    await capture('sourcing-source-review')
    const before = await current(context, origin)
    await draft.getByLabel('Sourcing draft decision').selectOption('kept')
    await draft.getByLabel('Sourcing review reason').fill('Keep the source-bound draft; no contact authorized')
    await draft.getByRole('button', { name: 'Record sourcing review', exact: true }).click()
    await draft.getByText('Agent-authored research packet · kept', { exact: true }).waitFor()
    const after = await current(context, origin)
    assert.equal(after.proposals.find(p => p.id === packet.id).status, 'kept')
    for (const key of ['applications', 'interviews', 'scorecards', 'messages', 'offers', 'vacancies']) assert.deepEqual(after[key], before[key], key + ' stays unchanged')
    const rejected = await api(agent.context, origin, 'propose', sourcingPacket(report, ownerEmail))
    await page.reload(); await tab('Proposals')
    const other = page.getByRole('article', { name: 'Sourcing research draft', exact: true }).filter({ hasText: 'Agent-authored research packet · proposed' })
    await other.getByLabel('Sourcing draft decision').selectOption('rejected')
    await other.getByLabel('Sourcing review reason').fill('Do not retain this draft for outreach')
    await other.getByRole('button', { name: 'Record sourcing review', exact: true }).click()
    await page.getByRole('article', { name: 'Sourcing research draft', exact: true }).filter({ hasText: packet.summary }).getByText('Agent-authored research packet · rejected', { exact: true }).waitFor()
    assert.equal((await current(context, origin)).proposals.find(p => p.id === rejected.id).status, 'rejected')
    await capture('sourcing-reviewed-drafts')
    await run('correct-candidate', { ...f.candidate, talentPool: false, reason: 'Withdrawn pool permission' })
    await page.reload(); await tab('Proposals')
    assert.equal(await page.getByRole('article', { name: 'Sourcing research draft', exact: true }).filter({ hasText: packet.summary }).count(), 0, 'the entire narrative disappears after consent withdrawal')
    assert.equal((await agent.context.request.get(origin + evidencePath)).status(), 404)
  } catch (error) {
    await page.screenshot({ path: evidence + '/sourcing-failure-1440.png', fullPage: true }).catch(() => {})
    throw error
  } finally {
    if (agentEmail) await run('member', { email: agentEmail, name: 'Synthetic sourcing browser agent', roles: [], active: false })
    await agent?.context.close(); await context.close()
  }
}
