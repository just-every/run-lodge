import assert from 'node:assert/strict'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { session } from './browser-journey.mjs'

/** Native Settings management in the built app; token values never enter proof images. */
export async function integrationsPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const job = await run('vacancy', { title: 'Synthetic integration browser job', location: 'New York', headcount: 1, manager: ownerEmail, compensation: { currency: 'USD', min: 100, max: 200, period: 'year' } })
  const owner = await session(browser, root, origin, 'owner', 1440), page = owner.page
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  try {
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Settings', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Application integrations', exact: true })
    await panel.getByRole('heading', { name: 'Application integrations', exact: true }).waitFor()
    const metadata = await owner.context.request.get(origin + '/api/lodge/integrations')
    assert.equal(metadata.status(), 200, await metadata.text())
    assert.ok((await metadata.json()).jobs.some(j => j.id === job.id), 'the settings list contains the authorized job')
    await panel.locator('select[name="job"]').selectOption(job.id)
    await panel.getByLabel('Integration name', { exact: true }).fill('Synthetic browser reader')
    await panel.getByLabel('Allow candidate names', { exact: true }).check()
    async function capture(state) {
      for (const width of browserWidths) {
        await page.setViewportSize({ width, height: 1000 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'integration settings fit release width')
        await iconTooltips(page)
        await page.screenshot({ path: evidence + '/integrations-' + state + '-' + width + '.png', fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await capture('settings')
    await panel.getByRole('button', { name: 'Create app credential', exact: true }).click()
    const tokenControl = panel.getByLabel('App credential', { exact: true })
    await tokenControl.waitFor()
    assert.equal(await tokenControl.getAttribute('type'), 'password')
    const firstToken = await tokenControl.inputValue()
    const entry = panel.getByRole('region', { name: 'Integration Synthetic browser reader', exact: true })
    await entry.getByText('Authorized', { exact: false }).waitFor()
    await capture('created')
    await panel.getByRole('button', { name: 'Dismiss credential', exact: true }).click()
    assert.equal(await tokenControl.count(), 0)
    await entry.getByRole('button', { name: 'Rotate Synthetic browser reader', exact: true }).click()
    await tokenControl.waitFor()
    const rotated = await tokenControl.inputValue()
    assert.notEqual(rotated, firstToken)
    const read = token => owner.context.request.get(origin + '/api/integrations/v1/applications', { headers: { authorization: 'Bearer ' + token } })
    assert.equal((await read(firstToken)).status(), 401)
    assert.equal((await read(rotated)).status(), 200)
    await capture('rotated')
    await entry.getByRole('button', { name: 'Revoke Synthetic browser reader', exact: true }).click()
    await entry.getByText('Revoked', { exact: false }).waitFor()
    assert.equal((await read(rotated)).status(), 401)
    assert.equal(await tokenControl.count(), 0)
    await capture('revoked')
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Settings', exact: true }).click()
    await entry.getByText('Revoked', { exact: false }).waitFor()
    assert.equal(await tokenControl.count(), 0, 'native reads never reveal the token again')
    assert.deepEqual(errors, [])
  } catch (error) {
    await page.screenshot({ path: evidence + '/integrations-failure.png', fullPage: true })
    throw error
  } finally { await owner.context.close() }
}
