import assert from 'node:assert/strict'
import { folderEntries, zip } from './zip.mjs'

/** Imported communication has the same management boundary as native messages. */
export async function checkImportedHistory(h, panelAgent) {
 const pkg = { filename: 'workable-export.zip', base64: zip(await folderEntries('fixtures/workable-full-export')).toString('base64') }
 const preview = await h.send('/api/lodge/import/preview', pkg, h.owner)
 assert.equal(preview.status, 200)
 const commit = await h.send('/api/lodge/import/commit', { ...pkg, fingerprint: preview.value.plan.fingerprint }, h.owner)
 assert.equal(commit.status, 200)
 const owner = await h.state(), messages = owner.importedHistory.messages
 assert.ok(messages.length > 0)
 for (const application of owner.applications.filter(a => a.imported)) await h.command('assign-reviewers', { application: application.id, reviewers: ['panel@example.test'] })
 for (const cookie of [h.panel, panelAgent]) {
  const view = await h.state(cookie)
  assert.ok(view.applications.some(a => a.imported))
  assert.deepEqual(view.importedHistory.messages, [])
  assert.ok(view.candidates.filter(c => c.imported).every(c => c.email === undefined))
 }
 assert.deepEqual((await h.state()).importedHistory.messages, messages)
}
