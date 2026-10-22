import assert from 'node:assert/strict'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'

export async function connectorsPage(browser, { root, origin, run, evidence, ownerEmail }) {
  for (const width of [1440, 390]) {
    const s = await session(browser, root, origin, 'owner', width)
    try {
      const { page } = s
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'People', exact: true }).click()
      const card = page.getByRole('article', { name: 'DocuSign registry', exact: true })
      await card.getByLabel('Selected sender', { exact: true }).fill(ownerEmail)
      await card.getByLabel('Requested scope: signature', { exact: true }).check()
      await card.getByLabel('Declared secret binding: DOCUSIGN_ACCESS_TOKEN', { exact: true }).check()
      await card.getByLabel('Map field: document', { exact: true }).check()
      await card.getByRole('button', { name: 'Save DocuSign registration', exact: true }).click()
      await card.getByRole('button', { name: 'Record DocuSign credential rotation', exact: true }).waitFor()
      const before = (await current(s.context, origin)).connectors.catalog.find(p => p.id === 'docusign').registration
      await card.getByRole('button', { name: 'Record DocuSign credential rotation', exact: true }).click()
      await page.waitForFunction(generation => document.querySelector('[aria-label="DocuSign registry"]')?.textContent.includes('generation ' + (generation + 1)), before.generation)
      const rotated = (await current(s.context, origin)).connectors.catalog.find(p => p.id === 'docusign').registration
      assert.equal(rotated.health, 'unknown')
      assert.ok(rotated.generation > before.generation)
      await card.getByRole('button', { name: 'Disconnect DocuSign registry', exact: true }).click()
      await card.locator('p').filter({ hasText: /^disconnected · generation/ }).waitFor()
      assert.equal((await current(s.context, origin)).connectors.catalog.find(p => p.id === 'docusign').registration.status, 'disconnected')
      await page.screenshot({ path: join(evidence, `INT-002-registry-${width}.png`), fullPage: true })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'connector forms fit viewport')
    } finally { await s.context.close() }
  }
}
