import assert from 'node:assert/strict'
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability'
import { loadPolicy } from '@runeditrun/rer/internal/cli/portability-policy.mjs'
import { harness } from './harness.mjs'
import { scheduleFixture, scheduleClock, scheduleApi } from './analysis-schedule-flow.mjs'

export async function checkAnalysisScheduleRestore(t) {
 const src = await scheduleFixture(); t.after(() => src.close())
 const enabled = await src.enable('2026-10-26T15:00:00.000Z')
 const policy = await loadPolicy(process.cwd(), undefined, 'scripts/installer/portability-policy.mjs'), service = await createPortability({ db: src.db, policy })
 const id = await service.exports.create(); let records
 try {
  while ((await service.exports.advance(id, { maxParts: 16 })).phase === 'building') {}
  records = []; for await (const record of readArchive(await service.exports.download(id))) records.push(record)
 } finally { await service.exports.abort(id) }
 const dst = await harness({ clock: scheduleClock, claim: false, bindings: { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'synthetic-lodge-2' } }); t.after(() => dst.close())
 const target = await createPortability({ db: dst.db, policy }), closing = records.at(-1), imported = await target.imports.create(records[0])
 for (const part of records.filter(r => r.kind === 'part')) await target.imports.uploadPart(imported, part.index, part)
 await target.imports.finalize(imported, { contentHash: closing.contentHash, archiveHash: closing.archiveHash })
 assert.equal((await target.imports.status(imported)).phase, 'complete')
 const owner = await dst.signIn('owner@example.test')
 const rows = (await dst.send(scheduleApi, undefined, owner)).value.schedules
 assert.equal(rows.find(r => r.id === enabled.id).status, 'withheld')
 const before = (await dst.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n
 await dst.setTime('2026-10-26T16:00:00.000Z')
 await dst.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse('2026-10-26T16:00:00.000Z'), cron: '0 * * * *' }))
 assert.equal((await dst.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, before)
 assert.equal((await dst.send(scheduleApi, undefined, owner)).value.schedules.find(r => r.id === enabled.id).status, 'withheld')
}
