import assert from 'node:assert/strict'
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability'
import { loadPolicy } from '@runeditrun/rer/internal/cli/portability-policy.mjs'
import { harness } from './harness.mjs'
import { crmFixture, crmClock } from './crm-flow.mjs'

export async function checkNurtureRestore(t) {
 const src = await crmFixture(); t.after(() => src.close())
 await src.verifyRoute()
 const draft = await src.command('crm-enroll', src.input)
 await src.command('crm-enable', { id: draft.id, reviewed: true, enabled: true })
 let entered, release
 const paused = new Promise(resolve => { entered = resolve }), resume = new Promise(resolve => { release = resolve })
 src.edge.beforeCheck = async request => { if (new URL(request.url).pathname.endsWith('/7')) { entered(); await resume } }
 const sending = src.tick('2026-10-26T14:01:00.000Z')
 await paused
 const policy = await loadPolicy(process.cwd(), undefined, 'scripts/installer/portability-policy.mjs'), service = await createPortability({ db: src.db, policy })
 let records
 try {
  const id = await service.exports.create()
  try {
   while ((await service.exports.advance(id, { maxParts: 16 })).phase === 'building') {}
   records = []; for await (const record of readArchive(await service.exports.download(id))) records.push(record)
  } finally { await service.exports.abort(id) }
 } finally { release(); await sending }
 const dst = await harness({ clock: crmClock, claim: false, bindings: { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'synthetic-lodge-2' } }); t.after(() => dst.close())
 const target = await createPortability({ db: dst.db, policy }), closing = records.at(-1), id = await target.imports.create(records[0])
 for (const part of records.filter(r => r.kind === 'part')) await target.imports.uploadPart(id, part.index, part)
 await target.imports.finalize(id, { contentHash: closing.contentHash, archiveHash: closing.archiveHash })
 assert.equal((await target.imports.status(id)).phase, 'complete')
 const owner = await dst.signIn('owner@example.test')
 let view = (await dst.send('/api/lodge/crm', undefined, owner)).value
 const restored = view.enrollments.find(e => e.id === draft.id)
 assert.equal(restored.status, 'withheld'); assert.equal(restored.outcomes.length, 1); assert.equal(restored.outcomes[0].status, 'withheld')
 assert.equal(view.replyRoute.status, 'withheld'); assert.equal(view.transportReady, false)
 const before = (await dst.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n
 await dst.setTime('2026-10-27T16:00:00.000Z')
 await dst.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse('2026-10-27T16:00:00.000Z'), cron: '0 * * * *' }))
 view = (await dst.send('/api/lodge/crm', undefined, owner)).value
 assert.equal(view.enrollments.find(e => e.id === draft.id).outcomes.length, 1)
 assert.equal((await dst.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, before)
}
