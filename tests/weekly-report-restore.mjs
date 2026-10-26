import assert from 'node:assert/strict'
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability'
import { loadPolicy } from '@runeditrun/rer/internal/cli/portability-policy.mjs'
import { harness } from './harness.mjs'
import { weeklyFixture, weeklyApi } from './weekly-report-flow.mjs'

export async function checkWeeklyRestore(t) {
  const src = await weeklyFixture(); t.after(() => src.close())
  const schedule = await src.enable()
  await src.tick('2026-11-02T14:00:00.000Z')
  const attempts = (await src.rows()).find(r => r.id === schedule.id).attempts
  assert.equal(attempts.length, 1); assert.equal(attempts[0].status, 'handed')
  const policy = await loadPolicy(process.cwd(), undefined, 'scripts/installer/portability-policy.mjs'), service = await createPortability({ db: src.db, policy })
  const id = await service.exports.create(); let records
  try {
    while ((await service.exports.advance(id, { maxParts: 16 })).phase === 'building') {}
    records = []; for await (const record of readArchive(await service.exports.download(id))) records.push(record)
  } finally { await service.exports.abort(id) }
  const dst = await harness({ clock: '2026-11-02T14:00:00.000Z', claim: false, bindings: { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'synthetic-lodge-2' } }); t.after(() => dst.close())
  const target = await createPortability({ db: dst.db, policy }), closing = records.at(-1), imported = await target.imports.create(records[0])
  for (const part of records.filter(r => r.kind === 'part')) await target.imports.uploadPart(imported, part.index, part)
  await target.imports.finalize(imported, { contentHash: closing.contentHash, archiveHash: closing.archiveHash })
  assert.equal((await target.imports.status(imported)).phase, 'complete')
  let owner = await dst.signIn('owner@example.test')
  const restored = (await dst.send(weeklyApi, undefined, owner)).value.schedules.find(r => r.id === schedule.id)
  assert.equal(restored.enabled, false); assert.equal(restored.status, 'withheld')
  assert.deepEqual(restored.attempts, attempts, 'durable period and recipient claims survive restore')
  const before = (await dst.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n
  await dst.setTime('2026-11-09T14:00:00.000Z')
  await dst.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse('2026-11-09T14:00:00.000Z'), cron: '0 * * * *' }))
  assert.equal((await dst.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, before, 'restored schedules cannot send a backlog')
  owner = await dst.signIn('owner@example.test')
  assert.equal((await dst.send(weeklyApi, undefined, owner)).value.schedules.find(r => r.id === schedule.id).attempts.length, 1)
}
