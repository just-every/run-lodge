import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { BUSINESS, harness } from './harness.mjs'
import { createPortability, readArchive, makePart } from '@runeditrun/rer/modules/portability'
import { ArchiveVerifier, ContentVerifier } from '@runeditrun/rer/modules/portability/format'
import { loadPolicy } from '@runeditrun/rer/internal/cli/portability-policy.mjs'
import { checkCliPolicy } from './portability-cli.mjs'
import { portabilityOptions } from '../scripts/installer/local.mjs'

// Resolve the actual installer declaration through the actual child-worker loader.
const policy = await loadPolicy(process.cwd(), undefined, portabilityOptions.policyModule)

test('LDG-015 actual seed restore policy rejects broken records and lineage before publication', async () => {
 const src = await harness()
 let dst, sourceClosed = false
 try {
  await src.command('business', BUSINESS)
  const { candidate } = await src.command('candidate', { name: 'Archive candidate', email: 'archive@example.test', source: 'Direct', consentBasis: 'manual' })
  let vacancy = await src.command('vacancy', { title: 'Archive role', location: 'New York', headcount: 1, compensation: { currency: 'USD', min: 100, max: 200, period: 'year' } })
  vacancy = await src.command('rubric', { id: vacancy.id, criteria: [{ name: 'Experience', description: 'Previous work example' }] })
  vacancy = await src.command('interview-plan', { id: vacancy.id, plan: [{ name: 'Review', stageName: 'Interview' }] })
  const approval = await src.command('request-vacancy-approval', { id: vacancy.id, approver: 'owner@example.test' })
  await src.command('decide-approval', { id: approval.id, decision: 'approved', version: approval.version, reason: 'Approved' })
  await src.command('publish', { id: vacancy.id })
  const application = await src.command('apply', { candidate: candidate.id, vacancy: vacancy.id, source: 'Archive test' })
  await src.command('interview', { application: application.id, planItem: vacancy.plan[0].id, participants: ['owner@example.test'], slots: ['2026-12-15T15:00:00Z'] })
  await src.command('note', { application: application.id, text: 'Archive interview evidence' })
  await src.command('scorecard', { application: application.id, ratings: {}, evidence: {} })
  await src.command('message', { application: application.id, purpose: 'other', subject: 'Archive message', body: 'Interview details' })
  await src.command('offer', { application: application.id, title: 'Archive role', salary: { currency: 'USD', amount: 150, period: 'year' }, startDate: '2026-12-20' })
  const publicVacancy = (await src.state()).vacancies.find(v => v.id === vacancy.id)
  const form = new FormData()
  for (const [key,value] of Object.entries({ name: 'Public archive applicant', email: 'public@example.test', consent: 'yes', noticeVersion: '1', accommodation: 'Accessible room', monitoring: 'Prefer not to say' })) form.append(key,value)
  assert.equal((await src.send('/jobs/' + publicVacancy.slug, form)).status, 200)
  const doc = await src.command('document', { candidate: candidate.id, name: 'resume.txt', kind: 'resume', mediaType: 'text/plain', base64: Buffer.from('ORIGINAL-ARCHIVE-DOCUMENT').toString('base64') })
  // CRM-005: both pending originals and accepted, subsequently merged people travel.
  const agency = await src.command('agency', { name: 'Archive Recruiting', email: 'archive-agency@example.test' })
  await src.command('agency-job', { agency: agency.id, vacancy: vacancy.id, feeTerms: 'USD 2,000 on start' })
  assert.equal((await src.send('/api/lodge/invite', { email: agency.email }, src.owner)).status, 200)
  const mailRows = await src.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()
  const mail = mailRows.results.map(r => JSON.parse(r.message)).find(m => m.to.includes(agency.email))
  const token = new URL(mail.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
  const agencyCookie = (await src.send('/auth/confirm', { token })).cookie
  const submission = { vacancy: vacancy.id, name: 'Agency archive applicant', email: 'agency-applicant@example.test', consentNote: 'Candidate agreed to this submission', confirmed: true, resume: { name: 'agency.txt', mediaType: 'text/plain', base64: Buffer.from('AGENCY-FROZEN-ORIGINAL').toString('base64') } }
  const pending = await src.command('agency-submit', submission, agencyCookie)
  const toAccept = await src.command('agency-submit', { ...submission, name: 'Accepted agency applicant', email: 'accepted-agency@example.test' }, agencyCookie)
  const accepted = await src.command('agency-review', { id: toAccept.id, outcome: 'Accepted-credited', reason: 'Consent and ownership reviewed' })
  const survivor = (await src.command('candidate', { name: 'Merged agency applicant', source: 'Direct', consentBasis: 'manual' })).candidate
  await src.command('review-duplicate', { keep: survivor.id, other: accepted.candidate, decision: 'merge', reason: 'Same person' })
  const pendingFile = (await src.state(agencyCookie)).agencyPortal.submissions.find(s => s.id === pending.id).files[0]
  await src.command('agency', { ...agency, active: false })
  const employee = await src.member('archive-employee@example.test', ['employee'], 'Archive Employee')
  const referral = await src.command('referral-submit', { vacancy: vacancy.id, name: 'Referral archive applicant', email: 'referral-archive@example.test', consentNote: 'Candidate agreed to sharing the resume', confirmed: true, resume: { name: 'referral.txt', mediaType: 'text/plain', base64: Buffer.from('REFERRAL-FROZEN-ORIGINAL').toString('base64') } }, employee)
  const referralFile = (await src.state(employee)).referrals.submissions.find(r => r.id === referral.id).files[0]

  const people=[]
  for (const name of ['Lineage A','Lineage B','Lineage C','Deleted person']) people.push((await src.command('candidate',{name,source:'Direct',consentBasis:'manual'})).candidate)
  const [a,b,c,deleted]=people
  await src.command('review-duplicate',{keep:b.id,other:c.id,decision:'merge',reason:'Same person'})
  await src.command('review-duplicate',{keep:a.id,other:b.id,decision:'merge',reason:'Same person'})
  assert.equal((await src.send('/api/lodge/delete-candidate',{candidate:deleted.id,confirm:deleted.name,reason:'Erase'},src.owner)).status,200)
  // OPS-001: the complete audit round-trips through the archive unchanged, with no erased person's text in it.
  const audit = (await src.send('/api/lodge/audit', undefined, src.owner)).value
  assert.ok(audit.total > 20 && audit.events.some(e => e.action === 'candidate-deleted' && e.record === 'candidate:' + deleted.id) && !JSON.stringify(audit).includes('Deleted person'))
  const service = await createPortability({ db: src.db, policy })
  const exportId = await service.exports.create()
  while ((await service.exports.advance(exportId, { maxParts: 16 })).phase === 'building') {}
  const records = []
  for await (const record of readArchive(await service.exports.download(exportId))) records.push(record)
  const originalItems = records.filter(r => r.kind === 'part').flatMap(p => p.items)
  await service.exports.abort(exportId)
  // Stop the source before opening the destination: a single live Worker at a time.
  await src.close(); sourceClosed = true
  dst = await harness({ claim: false })
  const target = await createPortability({ db: dst.db, policy })
  const changePerson = (items,id,changes) => {
   const row=items.find(i=>i.kind==='row'&&i.table==='l_records'&&i.row.kind==='candidate'&&i.row.id===id).row
   row.value=JSON.stringify({...JSON.parse(row.value),...changes})
  }
  const agencyRow = (items, kind, id) => items.find(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === kind && i.row.id === id).row
  const changeAgency = (items, kind, id, changes) => {
   const row = agencyRow(items, kind, id)
   row.value = JSON.stringify({ ...JSON.parse(row.value), ...changes })
  }
  const removeAgency = (items, kind, id) => items.splice(items.findIndex(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === kind && i.row.id === id), 1)
  const mutations = [
   ['missing referral original', (_d,_b,items) => removeAgency(items, 'blob', referralFile.id)],
   ['missing referral member', (_d,_b,items) => removeAgency(items, 'member', 'archive-employee@example.test')],
   ['missing agency reference', (_d,_b,items) => changeAgency(items, 'agency-submission', pending.id, { agency: 'missing-agency' })],
   ['missing agency vacancy', (_d,_b,items) => changeAgency(items, 'agency-job', agency.id + ':' + vacancy.id, { vacancy: 'missing-vacancy' })],
   ['missing agency member', (_d,_b,items) => removeAgency(items, 'member', agency.email)],
   ['mixed agency capabilities', (_d,_b,items) => changeAgency(items, 'member', agency.email, { roles: ['agency', 'admin'] })],
   ['agency private grant', (_d,_b,items) => changeAgency(items, 'member', agency.email, { seePrivate: true })],
   ['agency agent', (_d,_b,items) => changeAgency(items, 'member', agency.email, { agent: true, actsFor: 'owner@example.test' })],
   ['missing agency original', (_d,_b,items) => removeAgency(items, 'blob', pendingFile.id)],
   ['tampered agency original', (_d,_b,items) => changeAgency(items, 'blob', pendingFile.id, { base64: Buffer.from('TAMPERED-AGENCY-ORIGINAL').toString('base64') })],
   ['missing accepted agency candidate', (_d,_b,items) => changeAgency(items, 'agency-submission', accepted.id, { candidate: 'missing-candidate' })],
   ['missing accepted agency application', (_d,_b,items) => changeAgency(items, 'agency-submission', accepted.id, { application: 'missing-application' })],
   ['unrelated accepted agency candidate', (_d,_b,items) => changeAgency(items, 'agency-submission', accepted.id, { candidate: candidate.id })],
   ['dangling merged candidate', (_d,_b,items)=>changePerson(items,a.id,{mergedInto:'missing-person'})],
   ...[null,42,{},[],false,''].map(value=>['malformed merged target '+JSON.stringify(value),(_d,_b,items)=>changePerson(items,a.id,{mergedInto:value})]),
   ['self merge', (_d,_b,items)=>changePerson(items,a.id,{mergedInto:a.id})],
   ['merge cycle', (_d,_b,items)=>changePerson(items,a.id,{mergedInto:c.id,mergedFrom:[b.id]})],
   ['merge into tombstone', (_d,_b,items)=>changePerson(items,a.id,{mergedInto:deleted.id})],
   ['transitive rather than immediate mergedFrom', (_d,_b,items)=>changePerson(items,a.id,{mergedFrom:[b.id,c.id]})],
   ['bytes with recomputed envelope', (d, b) => { b.base64 = Buffer.from('ALTERED-ARCHIVE-DOCUMENT').toString('base64') }],
   ['digest', d => { d.sha256 = '0'.repeat(64) }],
   ['decoded size', d => { d.size += 1 }],
   ['invalid base64', (d, b) => { b.base64 = 'not!base64' }],
   ['noncanonical base64', (d, b) => { b.base64 = 'YQ==' .replace('Q', 'R'); d.size = 1; d.sha256 = createHash('sha256').update('a').digest('hex') }],
   ['empty bytes', (d, b) => { b.base64 = ''; d.size = 0; d.sha256 = createHash('sha256').update('').digest('hex') }],
   ['media mismatch', (d, b) => { b.mediaType = 'application/pdf' }],
   ['malformed media type', (d, b) => { d.mediaType = b.mediaType = 'text/plain\r\nInjected: yes' }],
   ['missing blob', (_d, _b, items) => removeAgency(items, 'blob', doc.id)],
   ['malformed blob JSON', (_d, _b, _items, row) => { row.value = '{broken' }],
   ['missing candidate reference', d => { d.candidate = 'no-such-candidate' }],
   ['missing vacancy reference', (_d, _b, items) => { const row = items.find(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === 'application').row; row.value = JSON.stringify({ ...JSON.parse(row.value), vacancy: 'no-such-vacancy' }) }],
   ['missing document application', d => { d.application = 'no-such-application' }],
   ['orphan blob document', (_d, _b, items) => removeAgency(items, 'document', doc.id)],
   ...['interview', 'interview-note', 'scorecard', 'stage-event', 'message', 'offer', 'receipt', 'monitoring'].map(kind => ['detached ' + kind, (_d, _b, items) => {
    const row = items.find(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === kind).row
    row.value = JSON.stringify({ ...JSON.parse(row.value), application: 'no-such-application' })
   }]),
   ['detached hiring application', (_d, _b, items) => { const row = items.find(i => i.kind === 'row' && i.table === 'l_records' && i.row.kind === 'application').row; row.value = JSON.stringify({ ...JSON.parse(row.value), candidate: 'no-such-candidate' }) }],
   ['restricted-kind contradiction', d => { d.kind = 'right-to-work'; d.restricted = false }],
  ]
  async function archive(mutate) {
   const items = structuredClone(originalItems), manifest = structuredClone(records[0])
   const docRow = agencyRow(items, 'document', doc.id)
   const blobRow = agencyRow(items, 'blob', doc.id)
   const document = JSON.parse(docRow.value), blob = JSON.parse(blobRow.value)
   mutate?.(document, blob, items, blobRow)
   docRow.value = JSON.stringify(document)
   if (blobRow.value !== '{broken') blobRow.value = JSON.stringify(blob)
   const counts = new Map()
   for (const item of items) if (item.kind === 'row') { item.index = counts.get(item.table) ?? 0; counts.set(item.table, item.index + 1) }
   for (const table of manifest.tables) table.count = counts.get(table.name) ?? 0
   manifest.partCount = 1
   const part = await makePart(0, items), verifier = new ContentVerifier(manifest), whole = new ArchiveVerifier(manifest)
   for (const item of items) verifier.add(item)
   whole.add(part)
   const closing = { ...records.at(-1), partCount: 1, contentHash: verifier.digest(), archiveHash: whole.digest() }
   const bytes = new TextEncoder().encode([manifest, part, closing].map(r => JSON.stringify(r)).join('\n') + '\n')
   // The attacker recomputed the entire envelope correctly: semantic validation must refuse.
   for await (const ignored of readArchive(new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }))) {}
   return { manifest, part, closing }
  }
  for (const [name, mutate] of mutations) {
   const { manifest, part, closing } = await archive(mutate)
   const id = await target.imports.create(manifest)
   try {
    await target.imports.uploadPart(id, 0, part)
    await assert.rejects(() => target.imports.finalize(id, { contentHash: closing.contentHash, archiveHash: closing.archiveHash }), e => e.code === 'lodge_staged_validation', name)
    assert.equal((await target.imports.status(id)).phase, 'staging')
    assert.equal((await dst.db.prepare('SELECT COUNT(*) AS n FROM l_records').first()).n, 0, `${name} published rows`)
    assert.equal((await dst.db.prepare('SELECT COUNT(*) AS n FROM ik_jobs').first()).n, 0, `${name} published import custody`)
   } finally { await target.imports.abort(id) }
  }
  const valid = await archive(), invalid = []
  for (const name of ['detached hiring application','dangling merged candidate','merge cycle','missing agency original']) invalid.push([name,await archive(mutations.find(([label])=>label===name)[1])])
  const id = await target.imports.create(valid.manifest)
  await target.imports.uploadPart(id, 0, valid.part)
  await target.imports.finalize(id, { contentHash: valid.closing.contentHash, archiveHash: valid.closing.archiveHash })
  assert.equal((await target.imports.status(id)).phase, 'complete')
  // The restored owner is the same person and signs in with an ordinary emailed link.
  const owner = await dst.signIn('owner@example.test')
  assert.deepEqual((await dst.send('/api/lodge/audit', undefined, owner)).value.events, audit.events)
  const download = await dst.send('/api/lodge/download/document/' + doc.id, undefined, owner)
  assert.equal(download.status, 200)
  assert.equal(download.text, 'ORIGINAL-ARCHIVE-DOCUMENT')
  assert.equal(createHash('sha256').update(download.text).digest('hex'), doc.sha256)
  assert.equal((await dst.send('/api/lodge/agency/file/' + pendingFile.id, undefined, owner)).text, 'AGENCY-FROZEN-ORIGINAL')
  assert.equal((await dst.send('/api/lodge/download/document/' + accepted.files[0].id, undefined, owner)).text, 'AGENCY-FROZEN-ORIGINAL')
  const employeeRestored = await dst.signIn('archive-employee@example.test')
  assert.equal((await dst.send('/api/lodge/referral/file/' + referralFile.id, undefined, employeeRestored)).text, 'REFERRAL-FROZEN-ORIGINAL')
  assert.equal((await dst.state(employeeRestored)).referrals.submissions[0].name, 'Referral archive applicant')
  const agencyPerson = await dst.signIn(agency.email)
  assert.equal((await dst.send('/api/lodge/state', undefined, agencyPerson)).status, 403, 'restored revoked agency stays revoked')
  const restored=await dst.send('/api/lodge/download/candidate/'+a.id,undefined,owner)
  assert.equal(restored.status,200)
  assert.deepEqual(restored.value.candidate.mergedFrom,[b.id])
  assert.deepEqual(restored.value.mergedCandidates.find(person=>person.id===b.id).mergedFrom,[c.id])
  assert.deepEqual(restored.value.mergedCandidates.map(person=>person.id).sort(),[b.id,c.id].sort())
  assert.equal(JSON.parse((await dst.db.prepare("SELECT value FROM l_records WHERE kind='candidate' AND id=?").bind(deleted.id).first()).value).deleted,true)
  const nonempty = await target.imports.create(valid.manifest)
  try {
   await target.imports.uploadPart(nonempty, 0, valid.part)
   await assert.rejects(() => target.imports.finalize(nonempty, { contentHash: valid.closing.contentHash, archiveHash: valid.closing.archiveHash }), /target_not_empty/)
  } finally { await target.imports.abort(nonempty) }
  await dst.close(); dst = null
  await checkCliPolicy(valid, invalid, doc.id)
 } finally { if (dst) await dst.close(); else if (!sourceClosed) await src.close() }
})
