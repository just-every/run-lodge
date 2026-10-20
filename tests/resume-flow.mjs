import assert from 'node:assert/strict'
import { resumeFiles, unreadableResume } from './resume-fixtures.mjs'
import { checkResumeLifecycle } from './resume-lifecycle.mjs'

/** DATA-002's public HTTP/D1 journey; real binary decoding is exercised by resume-page at both widths. */
export async function checkResumeIntake(h, { manager, interviewer }) {
 const cmd = h.command, send = h.send
 let job = await cmd('vacancy', { title: 'Resume intake role', location: 'New York, NY', headcount: 1, manager: 'morgan@example.test', compensation: { currency: 'USD', min: 5000000, max: 7000000, period: 'year' } })
 await cmd('rubric', { id: job.id, criteria: [{ name: 'Inventory', description: 'Evidence of inventory planning' }] })
 await cmd('interview-plan', { id: job.id, plan: [{ name: 'Review', stageName: 'Interview' }] })
 const approval = await cmd('request-vacancy-approval', { id: job.id, approver: 'owner@example.test' })
 await cmd('decide-approval', { id: approval.id, decision: 'approved', reason: 'Budgeted', version: approval.version })
 job = await cmd('publish', { id: job.id })
 const before = await h.state()
 const fixtures = [...resumeFiles(), unreadableResume], rows = []
 const download = async (id, who = h.owner) => {
  const response = await h.mf.dispatchFetch(h.origin + '/api/lodge/download/resume-intake/' + id, { headers: { cookie: who } })
  assert.equal(response.status, 200)
  return Buffer.from(await response.arrayBuffer())
 }
 for (const file of fixtures) {
  let row = await cmd('resume-upload', { file: { name: file.name, mediaType: file.mediaType, base64: file.bytes.toString('base64') }, vacancy: job.id })
  assert.deepEqual(await download(row.id), file.bytes, 'the original is downloadable before any decoding, even a corrupt file')
  if (row.status === 'uploaded') row = await cmd('resume-parsed', file.source ? { id: row.id, text: file.source } : { id: row.id, failure: 'PDF decoding failed: unreadable.pdf' })
  rows.push(row)
 }
 const staged = await h.state()
 assert.equal(staged.candidates.length, before.candidates.length)
 assert.equal(staged.applications.length, before.applications.length, 'upload and parse do not create people or applications')
 for (const row of rows.slice(0, 3)) {
  assert.equal(row.extraction.email.value, 'robin.intake@example.test')
  assert.equal(row.extraction.phone.value, '+1 (212) 555-0147')
  for (const key of ['name', 'email', 'phone']) { assert.ok(row.sourceText.includes(row.extraction[key].passage)); assert.equal(typeof row.extraction[key].uncertain, 'boolean') }
  for (const key of ['employment', 'education', 'skills']) { assert.ok(row.extraction[key].length); assert.ok(row.extraction[key].every(f => row.sourceText.includes(f.passage) && f.uncertain)) }
  assert.deepEqual(Object.keys(row.extraction).sort(), ['education', 'email', 'employment', 'name', 'phone', 'skills'])
  assert.ok(!JSON.stringify(row.extraction).includes('woman') && !JSON.stringify(row.extraction).includes('Age:'), 'personal details are not classified or inferred')
 }
 assert.equal(rows[3].status, 'failed'); assert.match(rows[3].parseError, /unreadable.pdf/)
 assert.deepEqual(await download(rows[3].id), unreadableResume.bytes)
 assert.equal((await send('/api/lodge/download/resume-intake/' + rows[0].id, undefined, interviewer)).status, 404)
 assert.ok(!(await h.state(interviewer)).resumeIntakes.length)
 assert.ok(!(await h.state(manager)).resumeIntakes.some(r => r.id === rows[0].id), 'one recruiter does not receive another recruiter’s pending intake')
 assert.equal((await send('/api/lodge/command/resume-upload', { file: { name: 'x.txt', mediaType: 'text/plain', base64: 'eA==' } }, manager)).status, 403)
 const fields = { name: 'Robin Carter corrected', email: 'robin.intake@example.test', phone: '+1 (212) 555-0147', skills: 'Inventory planning, forklift inspections', employment: 'Warehouse lead at Cedar Supply, 2021-2026', education: 'Associate degree in logistics, North College, 2020', source: 'Recruiter resume intake', consentBasis: 'application', consentNote: 'Submitted for this job' }
 let preview = await cmd('resume-preview', { id: rows[0].id, ...fields })
 assert.equal((await h.state()).candidates.length, before.candidates.length, 'a durable corrected preview is still inert')
 assert.equal((await send('/api/lodge/command/resume-commit', { id: rows[0].id, token: preview.token }, h.owner)).status, 409)
 const first = await cmd('resume-commit', { id: rows[0].id, token: preview.token, confirmed: true, duplicates: [] })
 assert.equal(first.candidate.name, fields.name)
 assert.equal(first.application.vacancy, job.id)
 assert.deepEqual(await download(rows[0].id), fixtures[0].bytes)
 const unchanged = JSON.stringify((await h.state()).candidates.find(c => c.id === first.candidate.id))
 const replay = await cmd('resume-commit', { id: rows[0].id, token: preview.token, confirmed: true })
 assert.equal(replay.replayed, true); assert.equal(replay.candidate.id, first.candidate.id)
 preview = await cmd('resume-preview', { id: rows[1].id, ...fields, name: 'Unapproved overwrite' })
 assert.deepEqual(preview.duplicates.map(d => d.reasons), [['same email', 'same phone']])
 assert.equal((await send('/api/lodge/command/resume-commit', { id: rows[1].id, token: preview.token, confirmed: true, duplicates: [] }, h.owner)).status, 409)
 await cmd('correct-candidate', { ...first.candidate, name: fields.name + ' updated', reason: 'Recruiter correction after preview' })
 const decision = { candidate: first.candidate.id, decision: 'existing', reason: 'Confirmed the original belongs to this person' }
 assert.equal((await send('/api/lodge/command/resume-commit', { id: rows[1].id, token: preview.token, confirmed: true, duplicates: [decision] }, h.owner)).status, 409, 'candidate revision changes invalidate duplicate confirmation')
 preview = await cmd('resume-preview', { id: rows[1].id, ...fields, name: 'Unapproved overwrite' })
 const originalPerson = (await h.state()).candidates.find(c => c.id === first.candidate.id)
 const linked = await cmd('resume-commit', { id: rows[1].id, token: preview.token, confirmed: true, duplicates: [decision] })
 assert.equal(linked.application.id, first.application.id, 'existing active application is reused')
 assert.deepEqual((await h.state()).candidates.find(c => c.id === first.candidate.id), originalPerson, 'using existing never overwrites its fields')
 assert.notEqual(unchanged, JSON.stringify(originalPerson), 'the deliberate public correction took effect')
 // Another same-email upload is explicitly confirmed as a different person through native LDG-005.
 preview = await cmd('resume-preview', { id: rows[2].id, ...fields, name: 'Another Robin' })
 const separate = await cmd('resume-commit', { id: rows[2].id, token: preview.token, confirmed: true, duplicates: [{ ...decision, decision: 'distinct', reason: 'Shared household contact; checked with recruiter' }] })
 assert.notEqual(separate.candidate.id, first.candidate.id)
 assert.ok((await h.state()).duplicateReviews.some(d => [d.first, d.second].includes(separate.candidate.id) && d.decision === 'distinct'))
 // An unreadable resume can be corrected manually without dropping its bytes.
 preview = await cmd('resume-preview', { id: rows[3].id, name: 'Manual intake person', source: 'Resume intake', consentBasis: 'manual', consentNote: 'Recruiter checked the original' })
 const manual = await cmd('resume-commit', { id: rows[3].id, token: preview.token, confirmed: true, duplicates: [] })
 assert.deepEqual(await download(rows[3].id), unreadableResume.bytes)
 const exportFile = await send('/api/lodge/download/candidate/' + first.candidate.id, undefined, h.owner)
 assert.equal(exportFile.value.document.length, 2)
 assert.equal(exportFile.value['resume-extraction'].length, 2)
 for (const file of fixtures.slice(0, 2)) assert.deepEqual(Buffer.from(exportFile.value.document.find(d => d.name === file.name).base64, 'base64'), file.bytes)
 assert.equal((await h.state(interviewer)).resumeExtractions.length, 0)
 assert.equal((await h.state()).resumeExtractions.find(r => r.candidate === manual.candidate.id).parseError, rows[3].parseError)
 await checkResumeLifecycle()
 // Erasure removes committed evidence and invalidates uncommitted originals in the same native transaction.
 const pending = await cmd('resume-upload', { file: { name: 'pending.txt', mediaType: 'text/plain', base64: Buffer.from('Pending resume').toString('base64') } })
 await cmd('move', { application: first.application.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Candidate withdrew' })
 await send('/api/lodge/delete-candidate', { candidate: first.candidate.id, confirm: originalPerson.name, reason: 'Access request completed' }, h.owner).then(r => assert.equal(r.status, 200))
 const erased = await h.state()
 assert.ok(!erased.resumeExtractions.some(r => r.candidate === first.candidate.id))
 for (const id of [rows[0].id, rows[1].id, pending.id]) assert.equal((await send('/api/lodge/download/resume-intake/' + id, undefined, h.owner)).status, 404)
}
