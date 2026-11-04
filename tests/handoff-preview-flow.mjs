import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { businessHarness, harness } from './harness.mjs'
import { handoffAddress, handoffJob } from './handoff-exception-flow.mjs'
import { createPortability, readArchive, makePart } from '@runeditrun/rer/modules/portability'
import { ArchiveVerifier, ContentVerifier } from '@runeditrun/rer/modules/portability/format'
import { loadPolicy } from '@runeditrun/rer/internal/cli/portability-policy.mjs'
import { portabilityOptions } from '../scripts/installer/local.mjs'

export const mappingFields = { name: 'legal_name', email: 'personal_email', role: 'job_title', manager: 'manager_reference', location: 'work_location', employmentType: 'employment_type', payAmount: 'pay_cents', payCurrency: 'currency', payUnit: 'pay_period', startDate: 'start_date', documents: 'originals', custom: 'cost_centre' }
export async function previewFixture(run, owner, suffix = '', approver = owner, approve = run) {
  const f = await handoffJob(run, owner, owner, suffix, approver, approve, async job => {
    await run('field-schema', { id: job.id, fields: [
      { id: 'cost-centre', name: 'Cost centre', record: 'application', type: 'text' },
      { id: 'restricted', name: 'Restricted answer', record: 'application', type: 'text', restricted: true },
    ] })
  })
  const customField = f.job.id + ':cost-centre'
  await run('field-values', { application: f.people[0].application.id, values: { [customField]: 'Operations West' } })
  await run('field-values', { application: f.people[2].application.id, values: { [customField]: 'Operations East' } })
  await run('handoff-policy', { vacancy: f.job.id, fields: ['phone', 'manager'] })
  await run('handoff-mapping', { vacancy: f.job.id, destination: 'willow', tenant: 'synthetic-lodge-tenant', customField, fields: mappingFields })
  return { ...f, customField }
}
const form = fields => { const result = new FormData(); for (const [key, value] of Object.entries(fields)) result.set(key, value); return result }
async function nativeSign(h, f) {
  await h.command('esign-disclosure', { reviewed: true })
  assert.equal((await h.send('/api/lodge/esign/send', { offer: f.offers[2].id }, h.owner)).status, 200)
  const mails = async () => (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence').all()).results.map(r => JSON.parse(r.message)).filter(m => m.to.includes(f.people[2].candidate.email))
  const path = (await mails()).find(m => m.text.includes('/sign/')).text.match(/\/sign\/[0-9a-f]{64}/)[0]
  assert.equal((await h.send(path + '/code', form({}))).status, 200)
  const code = (await mails()).at(-1).text.match(/code is (\d{6})/)[1]
  const verified = await h.send(path + '/verify', form({ code })); assert.equal(verified.status, 303)
  assert.equal((await h.send(path + '/agree', form({ version: '1', box: 'yes' }), verified.cookie)).status, 303)
  assert.equal((await h.send(path + '/sign', form({ name: f.people[2].candidate.name, hash: f.offers[2].document.sha256 }), verified.cookie)).status, 303)
}

export async function checkHandoffPreviews() {
  let outbound = 0, closed = false, dst
  const h = await businessHarness({ clock: '2037-01-09T12:00:00Z', outboundService: () => { outbound++; return new Response('unexpected outbound call', { status: 502 }) } })
  try {
    const { command: run, send, state } = h, owner = (await state()).actor.email
    const f = await previewFixture(run, owner)
    await nativeSign(h, f)
    const reviewerEmail = handoffAddress('preview-reviewer'), reader = await h.member(reviewerEmail, ['manager'], 'Synthetic Lodge mapping reviewer')
    await run('hiring-team', { id: f.job.id, recruiters: [reviewerEmail] })
    const unrelated = await h.member(handoffAddress('preview-unrelated'), ['interviewer'])
    const agent = await h.member(handoffAddress('preview-agent'), [], 'Synthetic Lodge mapping agent', { agent: true, actsFor: owner })
    const mapping = () => state().then(w => w.handoffPreviews.mappings.find(m => m.vacancy === f.job.id))
    const input = async (offer = f.offers[0], documents = []) => ({ offer: offer.id, mappingRevision: (await mapping()).revision, documents })
    const prepare = async (offer = f.offers[0], documents = [], cookie = h.owner) => run('handoff-preview', await input(offer, documents), cookie)
    const review = (row, cookie = reader) => run('handoff-preview-review', { id: row.id, fingerprint: row.fingerprint, reason: 'Inspect exact mapping; destination creation remains unauthorized', acknowledge: true }, cookie)
    const read = (row, cookie = h.owner) => send('/api/lodge/handoff-preview/' + row.id, undefined, cookie)
    const extraBytes = Buffer.from('Synthetic Lodge employment attachment')
    const extra = await run('document', { application: f.people[0].application.id, name: 'employment.txt', kind: 'other', mediaType: 'text/plain', base64: extraBytes.toString('base64') })
    const restricted = await run('document', { application: f.people[0].application.id, name: 'restricted.txt', kind: 'right-to-work', mediaType: 'text/plain', base64: Buffer.from('Synthetic restricted record').toString('base64') })
    const before = await state(), offersBefore = before.offers, appsBefore = before.applications
    const creation = await Promise.all([1, 2].map(async () => send('/api/lodge/command/handoff-preview', await input(f.offers[0], [extra.id]), h.owner)))
    assert.ok(creation.some(r => r.status === 200) && creation.every(r => [200, 409].includes(r.status)))
    let row = creation.find(r => r.status === 200).value
    for (const result of creation.filter(r => r.status === 200)) assert.equal(result.value.id, row.id)
    const values = Object.fromEntries(row.snapshot.fields.map(f => [f.target, f.value]))
    assert.deepEqual(Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'originals')), {
      legal_name: 'Synthetic Lodge hire 0', personal_email: handoffAddress(0), job_title: 'Synthetic Lodge handoff', manager_reference: owner,
      work_location: 'Denver, CO', employment_type: 'full-time', pay_cents: 7000000, currency: 'USD', pay_period: 'year', start_date: '2037-12-07', cost_centre: 'Operations West',
    })
    const expected = new Map([[extra.id, createHash('sha256').update(extraBytes).digest('hex')], [row.snapshot.signature.artifacts[0].document, createHash('sha256').update(f.original).digest('hex')]])
    assert.equal(values.originals.length, 2)
    for (const doc of values.originals) { assert.equal(doc.sha256, expected.get(doc.id)); assert.equal((await send('/api/lodge/download/document/' + doc.id, undefined, h.owner)).status, 200) }
    assert.equal(row.snapshot.signature.kind, 'outside'); assert.equal(row.snapshot.signature.providerVerified, false)
    assert.deepEqual([row.snapshot.tenantVerified, row.snapshot.schemaValidated, row.snapshot.contingencies.status, row.complete, row.employeeCreated, row.creationAuthorized], [false, false, 'unknown', false, false, false])
    assert.equal((await send('/api/lodge/command/handoff-preview', await input(f.offers[1]), h.owner)).status, 409, 'unsigned acceptance refused')
    assert.equal((await send('/api/lodge/command/handoff-preview', await input(f.offers[0], [restricted.id]), h.owner)).status, 404)
    assert.equal((await send('/api/lodge/command/handoff-preview', await input(), unrelated)).status, 404)
    assert.equal((await send('/api/lodge/command/handoff-preview', await input(), agent)).status, 403)
    assert.equal((await read(row, agent)).status, 404)
    assert.equal((await send('/api/lodge/command/handoff-mapping', { ...(await mapping()), fields: mappingFields, customField: f.job.id + ':restricted' }, h.owner)).status, 400)
    assert.equal((await send('/api/lodge/command/handoff-preview-review', { id: row.id, fingerprint: row.fingerprint, acknowledge: true, reason: 'Unsafe completion', employeeCreated: true }, h.owner)).status, 400)
    await review(row)
    assert.equal((await read(row)).value.reviewValid, true)
    assert.equal((await review(row)).history.length, 1)
    const races = await Promise.all([1, 2].map(async () => send('/api/lodge/command/handoff-preview', await input(f.offers[0], [extra.id]), h.owner)))
    assert.ok(races.some(r => r.status === 200) && races.every(r => [200, 409].includes(r.status)))
    for (const result of races.filter(r => r.status === 200)) assert.equal(result.value.id, row.id)
    await h.restart()
    assert.equal((await prepare(f.offers[0], [extra.id])).id, row.id)
    assert.equal((await read(row)).value.reviewValid, true)
    const exported = (await send('/api/lodge/download/candidate/' + f.people[0].candidate.id, undefined, h.owner)).value
    assert.equal(exported['handoff-preview'][0].snapshot.documents.length, 2)
    assert.equal((await send('/api/lodge/download/vacancy/' + f.job.id, undefined, h.owner)).value.handoffPreviews.length, 1)
    const legacy = (await send('/api/lodge/download/handoff/' + f.offers[1].id, undefined, h.owner)).value
    assert.deepEqual([legacy.complete, legacy.employeeCreated, legacy.destinationReadback, legacy.signature], [false, false, 'unknown', null])
    assert.deepEqual((await state()).offers, offersBefore); assert.deepEqual((await state()).applications, appsBefore)
    await run('field-values', { application: f.people[0].application.id, values: { [f.customField]: 'Operations revised' } })
    assert.deepEqual([(await read(row)).value.stale, (await read(row)).value.reviewValid], [true, false])
    assert.equal((await send('/api/lodge/command/handoff-preview-review', { id: row.id, fingerprint: row.fingerprint, acknowledge: true, reason: 'Old sources' }, reader)).status, 409)
    row = await prepare(f.offers[0], [extra.id]); await review(row)
    const oldMapping = await mapping()
    await run('handoff-mapping', { ...oldMapping, fields: { ...mappingFields, manager: '' } })
    assert.equal((await read(row)).value.reviewValid, false)
    row = await prepare(f.offers[0], [extra.id]); assert.deepEqual(row.snapshot.missing, ['Job manager'])
    await review(row)
    const noOffers = await run('permission-level', { name: 'Synthetic Lodge contact only', permissions: ['contact'] })
    await run('job-levels', { id: f.job.id, members: { [reviewerEmail]: noOffers.id }, roles: {} })
    assert.equal((await read(row)).status, 404, 'lost reviewer authority hides the whole frozen record')
    assert.equal((await state()).handoffPreviews.records.some(p => p.id === row.id), false)
    assert.equal(JSON.stringify((await send('/api/lodge/download/candidate/' + f.people[0].candidate.id, undefined, h.owner)).value).includes(row.fingerprint), false)
    await run('job-levels', { id: f.job.id, members: {}, roles: {} })
    assert.equal((await read(row)).value.reviewValid, false, 'restoring grants cannot resurrect old review')
    row = await prepare(f.offers[0], [extra.id]); await review(row)
    await run('member', { email: reviewerEmail, name: 'Synthetic Lodge mapping reviewer', roles: ['manager'], active: false })
    assert.ok([401, 403].includes((await read(row, reader)).status), 'deactivated reader session exposes no snapshot')
    assert.equal((await read(row)).status, 404)
    await run('member', { email: reviewerEmail, name: 'Synthetic Lodge mapping reviewer', roles: ['manager'], active: true })
    assert.equal((await read(row)).value.reviewValid, false, 'member reactivation does not revive review')
    for (const destination of ['bamboohr', 'adp']) {
      await run('handoff-mapping', { ...(await mapping()), destination, fields: mappingFields })
      row = await prepare(f.offers[0], [extra.id]); await review(row)
      assert.equal(row.snapshot.destination, destination)
    }
    const native = await prepare(f.offers[2]); assert.equal(native.snapshot.signature.kind, 'native'); assert.equal(native.snapshot.documents.length, 2)
    for (const doc of native.snapshot.documents) {
      const blob = JSON.parse((await h.db.prepare("SELECT value FROM l_records WHERE kind='blob' AND id=?").bind(doc.id).first()).value)
      assert.equal(doc.sha256, createHash('sha256').update(Buffer.from(blob.base64, 'base64')).digest('hex'))
    }
    await review(native)
    const originalBlob = await h.db.prepare("SELECT * FROM l_records WHERE kind='blob' AND id=?").bind(native.snapshot.documents[0].id).first()
    await h.db.prepare("DELETE FROM l_records WHERE kind='blob' AND id=?").bind(originalBlob.id).run()
    assert.equal((await send('/api/lodge/command/handoff-preview', await input(f.offers[2]), h.owner)).status, 409)
    assert.equal((await read(native)).value.reviewValid, false)
    await h.db.prepare('INSERT INTO l_records (kind,id,revision,value) VALUES (?,?,?,?)').bind(originalBlob.kind, originalBlob.id, originalBlob.revision, originalBlob.value).run()
    const originalDoc = await h.db.prepare("SELECT * FROM l_records WHERE kind='document' AND id=?").bind(originalBlob.id).first()
    await h.db.prepare("DELETE FROM l_records WHERE kind='document' AND id=?").bind(originalDoc.id).run()
    assert.equal((await send('/api/lodge/command/handoff-preview', await input(f.offers[2]), h.owner)).status, 404)
    assert.equal((await read(native)).status, 404, 'missing signature record exposes no preview')
    await h.db.prepare('INSERT INTO l_records (kind,id,revision,value) VALUES (?,?,?,?)').bind(originalDoc.kind, originalDoc.id, originalDoc.revision, originalDoc.value).run()
    const originalOffer = await h.db.prepare("SELECT value FROM l_records WHERE kind='offer' AND id=?").bind(f.offers[2].id).first()
    const staleOffer = { ...JSON.parse(originalOffer.value), startDate: '2037-12-08' }
    await h.db.prepare("UPDATE l_records SET value=? WHERE kind='offer' AND id=?").bind(JSON.stringify(staleOffer), f.offers[2].id).run()
    assert.equal((await send('/api/lodge/command/handoff-preview', await input(f.offers[2]), h.owner)).status, 409)
    await h.db.prepare("UPDATE l_records SET value=? WHERE kind='offer' AND id=?").bind(originalOffer.value, f.offers[2].id).run()
    const declined = await handoffJob(run, owner, owner, '-declined')
    await run('offer-outcome', { id: declined.offers[2].id, outcome: 'declined', reason: 'Human recorded decline' })
    assert.equal((await send('/api/lodge/command/handoff-preview', { offer: declined.offers[2].id }, h.owner)).status, 409)
    const hold = await run('hold', { candidate: f.people[0].candidate.id, reason: 'Synthetic legal hold' })
    const erase = () => send('/api/lodge/delete-candidate', { candidate: f.people[0].candidate.id, confirm: f.people[0].candidate.name, reason: 'Erase native mapping evidence' }, h.owner)
    assert.equal((await erase()).status, 409)
    await run('release-hold', { id: hold.id, reason: 'Hold released' }); assert.equal((await erase()).status, 200)
    assert.equal((await read(row)).status, 404)
    assert.equal((await send('/api/lodge/command/handoff-preview', await input(f.offers[0]), h.owner)).status, 404)
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='handoff-preview' AND instr(value,?)>0").bind(f.people[0].candidate.id).first()).n, 0)
    const survivor = (await run('candidate', { name: 'Synthetic Lodge merged hire', email: f.people[2].candidate.email, source: 'Direct', consentBasis: 'manual' })).candidate
    await run('review-duplicate', { keep: survivor.id, other: f.people[2].candidate.id, decision: 'merge', reason: 'Human confirmed the same signed hire' })
    const mergedPreview = await read(native)
    assert.equal(mergedPreview.status, 200)
    assert.equal(mergedPreview.value.snapshot.candidate, f.people[2].candidate.id, 'frozen identity is never rewritten by a merge')
    assert.equal(mergedPreview.value.stale, true); assert.equal(mergedPreview.value.reviewValid, false)
    assert.equal(outbound, 0, 'preparation and review make zero HRIS calls')
    console.log('PROBE HIRE-001 mapping: native and attested signed hires -> exact USD values, selected original digests, incomplete preview and human review')
    console.log('PROBE HIRE-001 fences: unsigned, declined, stale terms, missing originals, restricted selections and revoked authority -> refusal; replay and restart -> one frozen record')
    console.log('PROBE HIRE-001 lifecycle: held erasure refused; released erasure removes snapshots; legacy handoff remains incomplete; zero HRIS calls')
    const policy = await loadPolicy(process.cwd(), undefined, portabilityOptions.policyModule)
    const service = await createPortability({ db: h.db, policy }), exportId = await service.exports.create()
    while ((await service.exports.advance(exportId, { maxParts: 16 })).phase === 'building') {}
    const records = []
    for await (const record of readArchive(await service.exports.download(exportId))) records.push(record)
    await service.exports.abort(exportId)
    await h.close(); closed = true
    dst = await harness({ claim: false })
    const target = await createPortability({ db: dst.db, policy })
    const items = records.filter(r => r.kind === 'part').flatMap(p => p.items)
    async function restore(mutate) {
      const copy = structuredClone(items), manifest = structuredClone(records[0]); mutate?.(copy)
      const counts = new Map()
      for (const item of copy) if (item.kind === 'row') { item.index = counts.get(item.table) ?? 0; counts.set(item.table, item.index + 1) }
      for (const table of manifest.tables) table.count = counts.get(table.name) ?? 0
      manifest.partCount = 1
      const part = await makePart(0, copy), content = new ContentVerifier(manifest), whole = new ArchiveVerifier(manifest)
      for (const item of copy) content.add(item)
      whole.add(part)
      const id = await target.imports.create(manifest)
      await target.imports.uploadPart(id, 0, part)
      return { id, finalize: () => target.imports.finalize(id, { contentHash: content.digest(), archiveHash: whole.digest() }) }
    }
    for (const mutate of [
      copy => { const row = copy.find(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === 'handoff-preview').row; const value = JSON.parse(row.value); value.candidate = value.snapshot.candidate = f.people[1].candidate.id; row.value = JSON.stringify(value) },
      copy => { const index = copy.findIndex(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === 'handoff-mapping'); copy.splice(index, 1) },
      copy => { const row = copy.find(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === 'handoff-preview').row; row.value = JSON.stringify({ ...JSON.parse(row.value), application: 'synthetic-missing-application' }) },
      copy => { const row = copy.find(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === 'handoff-preview').row; const value = JSON.parse(row.value); value.snapshot.documents[0].sha256 = '0'.repeat(64); row.value = JSON.stringify(value) },
      copy => { const row = copy.find(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === 'handoff-preview').row; row.value = JSON.stringify({ ...JSON.parse(row.value), complete: true }) },
    ]) {
      const attempt = await restore(mutate)
      await assert.rejects(attempt.finalize, e => e.code === 'lodge_staged_validation')
      assert.equal((await dst.db.prepare('SELECT COUNT(*) AS n FROM l_records').first()).n, 0)
      await target.imports.abort(attempt.id)
    }
    const valid = await restore(); await valid.finalize()
    const restoredOwner = await dst.signIn(owner), restored = (await dst.state(restoredOwner)).handoffPreviews.records.find(r => r.id === native.id)
    assert.equal(restored.review, null); assert.equal(restored.reviewValid, false)
    assert.equal(restored.snapshot.candidate, f.people[2].candidate.id)
    assert.equal((await dst.state(restoredOwner)).applications.find(app => app.id === native.application).candidate, survivor.id)
    assert.deepEqual([restored.complete, restored.employeeCreated, restored.creationAuthorized], [false, false, false])
    assert.equal((await dst.send('/api/lodge/handoff-preview/' + native.id, undefined, h.owner)).status, 401, 'source session does not travel')
    console.log('PROBE HIRE-001 archive: invalid relationships, changed digests and completion claims refused before publication; valid merged-lineage restore retains the frozen original identity without live review or creation authority')
  } finally { if (!closed) await h.close(); await dst?.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { await checkHandoffPreviews(); console.log('Employee mapping preview sanity journey passed') }
