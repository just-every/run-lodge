// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import assert from "node:assert/strict"
import { browserWidths } from "./browser-widths.mjs"
import { join } from "node:path"
import { current, session } from "./browser-journey.mjs"

/** INT-002 registry slice, through the same HTTP doors used by the settings forms. */
export async function checkConnectors(h) {
  const input = { provider: 'docusign', scopes: ['signature'], bindings: ['DOCUSIGN_ACCESS_TOKEN'], sender: 'owner@example.test', mappings: [{ from: 'document', to: 'document' }] }
  const send = (op, body, cookie = h.owner) => h.send('/api/lodge/command/' + op, body, cookie)
  for (const cookie of [h.manager, h.panel, h.agent]) {
    assert.equal((await send('connector-register', input, cookie)).status, 403)
    assert.equal((await h.state(cookie)).connectors, null)
  }
  const before = (await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind IN ('message','interview','esign-envelope')").first()).n
  let saved = await h.command('connector-register', input)
  assert.equal(saved.health, 'unknown'); assert.equal(saved.status, 'registered')
  let view = (await h.state()).connectors.catalog.find(p => p.id === 'docusign')
  assert.equal(view.adapter, 'unavailable')
  assert.deepEqual(view.registration.mappings, input.mappings)
  assert.equal((await send('connector-register', { ...input, generation: saved.generation, credential: 'synthetic-lodge-1' })).status, 400)
  assert.equal((await send('connector-register', { ...input, generation: saved.generation, bindings: ['UNDECLARED_BINDING'] })).status, 400)
  assert.equal((await send('connector-register', { ...input, generation: saved.generation, scopes: ['all'] })).status, 400)
  assert.equal((await send('connector-register', { ...input, generation: saved.generation, mappings: [{ from: 'document', to: 'unavailableField' }] })).status, 400)
  const originalGeneration = saved.generation
  saved = await h.command('connector-binding-change', { provider: input.provider, generation: originalGeneration, action: 'rotation-recorded' })
  assert.ok(saved.generation > originalGeneration)
  assert.equal(saved.health, 'unknown')
  assert.equal((await send('connector-binding-change', { provider: input.provider, generation: originalGeneration, action: 'disconnect' })).status, 409)
  saved = await h.command('connector-binding-change', { provider: input.provider, generation: saved.generation, action: 'disconnect' })
  assert.equal(saved.status, 'disconnected')
  assert.equal((await send('connector-binding-change', { provider: input.provider, generation: saved.generation, action: 'rotation-recorded' })).status, 409)
  const current = (await h.state()).connectors
  assert.ok(current.catalog.every(p => !p.registration || p.registration.health === 'unknown'))
  assert.equal(JSON.stringify(current).includes('synthetic-lodge-1'), false)
  const rows = (await h.db.prepare("SELECT value FROM l_records WHERE kind IN ('connector','audit')").all()).results
  assert.equal(JSON.stringify(rows).includes('synthetic-lodge-1'), false, 'refused credential input never reaches persisted records or exported audit data')
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind IN ('message','interview','esign-envelope')").first()).n, before, 'registry creates no provider work')
}

export async function connectorsPage(browser, { root, origin, run, evidence, ownerEmail }) {
  for (const width of browserWidths) {
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
