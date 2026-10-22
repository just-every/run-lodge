import assert from 'node:assert/strict'

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
