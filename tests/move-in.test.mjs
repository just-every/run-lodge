// LDG-014: the Workable full-export move-in kit on Base import-kit's D1 journal,
// driven through Lodge's import routes with the documented-shape fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BUSINESS, harness } from './harness.mjs'
import { folderEntries, zip } from './zip.mjs'
import { recordSnapshot, transactions } from './record-transactions.mjs'

const FIXTURE = 'fixtures/workable-full-export'

test('LDG-014 Workable package: preview writes nothing, commit is exact and repeatable, undo keeps what people changed', async () => {
  const h = await harness()
  try {
    const { command: cmd, send, state, owner } = h
    await cmd('business', BUSINESS)
    const native = (await cmd('candidate', { name: 'Native applicant', source: 'Direct', consentBasis: 'manual' })).candidate
    const nativeDocs = []
    async function addNativeDocument(label) {
      const bytes = 'Native original bytes ' + label
      const doc = await cmd('document', { candidate: native.id, name: label + '.txt', mediaType: 'text/plain', base64: Buffer.from(bytes).toString('base64') })
      const stored = await h.db.prepare("SELECT revision,value FROM l_records WHERE kind='blob' AND id=?").bind(doc.id).first()
      nativeDocs.push({ doc, stored, bytes })
    }
    await addNativeDocument('before import')
    const pkg = { filename: 'workable-export.zip', base64: zip(await folderEntries(FIXTURE)).toString('base64') }
    const count = async () => (await h.db.prepare("SELECT (SELECT COUNT(*) FROM l_records WHERE kind <> 'audit') + (SELECT COUNT(*) FROM ik_jobs) AS n").first()).n

    const before = await count()
    const preview = await send('/api/lodge/import/preview', pkg, owner)
    assert.equal(preview.status, 200, JSON.stringify(preview.value))
    assert.equal(await count(), before, 'preview writes nothing')
    const { report, plan } = preview.value
    const reasons = report.quarantined.map(q => `${q.file}:${q.line ?? ''}:${q.reason}`).join('\n')
    assert.match(reasons, /candidates\.csv:9:Row has 6 fields; the header has 26/, 'a short row is set aside, not padded (line 9: the cover letter above spans two lines)')
    assert.match(reasons, /Candidate 5004 has an email Lodge cannot read/)
    assert.match(reasons, /comment refers to candidate 7777/)
    assert.deepEqual(report.orphanedAttachments, ['7002/9999-unknown/stray.txt'])
    assert.ok(report.missingAttachments.some(m => m.candidate === '5005' && m.file === 'missing.pdf'))
    assert.deepEqual(report.omitted.map(o => o.file).sort(), ['Read Me.txt', 'email_templates.csv'])
    assert.equal(plan.counts.rejected, 2, 'rejected entries are kept in the reviewed plan')

    assert.equal((await send('/api/lodge/import/commit', { ...pkg, fingerprint: 'not-the-preview' }, owner)).status, 409)
    const committed = await send('/api/lodge/import/commit', { ...pkg, fingerprint: plan.fingerprint }, owner)
    assert.equal(committed.status, 200, JSON.stringify(committed.value))
    // OPS-001: the import is in the complete audit.
    assert.equal((await send('/api/lodge/audit?action=import-commit', undefined, owner)).value.total, 1)
    const job = committed.value.job
    assert.equal(job.state, 'completed')

    let s = await state()
    assert.deepEqual(s.vacancies.map(v => [v.title, v.status]).sort(), [['Estimator', 'imported'], ['Site supervisor', 'imported']])
    const lee = s.candidates.find(c => c.name === 'Lee Moreno')
    assert.equal(s.applications.filter(a => a.candidate === lee.id).length, 2, 'one person, two applications')
    assert.ok(!s.candidates.some(c => c.name === 'Robin Hale'))
    const dana = s.candidates.find(c => c.name === 'Dana Whitfield')
    assert.deepEqual([dana.consent.talentPool, dana.consent.sourceTalentPool], [false, true], 'a talent-pool flag is not permission to contact')
    const resume = s.documents.find(d => d.name === 'dana-resume.txt')
    assert.equal((await send('/api/lodge/download/document/' + resume.id, undefined, owner)).text, await readFile(`${FIXTURE}/7001/5001-dana-whitfield/dana-resume.txt`, 'utf8'))
    assert.ok(s.applications.find(a => a.candidate === dana.id).status === 'imported')
    assert.equal(s.importedHistory.notes[0].body, 'Strong references from two GCs.')
    assert.equal(s.members.length, 1, 'Workable team members get no Lodge access')
    assert.equal(s.importedHistory.members.length, 2)
    assert.equal((await send('/api/lodge/command/move', { application: s.applications.find(a => a.candidate === dana.id).id, to: 'rejected', closeReason: 'skills', reason: 'x' }, owner)).status, 409, 'imported applications are history')

    await addNativeDocument('after import')

    // The same package again: the same batch, no duplicates.
    const records = await count()
    const again = await send('/api/lodge/import/commit', { ...pkg, fingerprint: plan.fingerprint }, owner)
    assert.equal(again.value.job.id, job.id)
    assert.equal(await count(), records)

    const status = (await send('/api/lodge/import/status', { id: job.id }, owner)).value
    assert.ok(status.originals.length >= 10 && status.originals.every(o => o.status === 'retained'), 'every original file is kept unchanged')

    // A person corrects one imported candidate and links another to a native vacancy.
    await cmd('correct-candidate', { id: dana.id, name: 'Dana Whitfield', email: 'dana.w@example.test', reason: 'Updated email' })
    const v = await cmd('vacancy', { title: 'Foreman', location: 'Brooklyn', headcount: 1, compensation: { currency: 'USD', min: 1, max: 2, period: 'year' } })
    await cmd('rubric', { id: v.id, criteria: [{ name: 'Crew', description: 'Led a crew' }] })
    await cmd('interview-plan', { id: v.id, plan: [{ name: 'Talk', stageName: 'Interview' }] })
    const request = await cmd('request-vacancy-approval', { id: v.id, approver: s.members[0].email })
    await cmd('decide-approval', { id: request.id, decision: 'approved', reason: 'ok', version: request.version })
    await cmd('publish', { id: v.id })
    await cmd('apply', { candidate: lee.id, vacancy: v.id, source: 'Imported talent' })

    const erase = await send('/api/lodge/delete-candidate', { candidate: dana.id, confirm: 'Dana Whitfield', reason: 'Erasure request' }, owner)
    assert.equal(erase.status, 409, 'imported originals still hold her data, so deletion is refused rather than partial')
    // Native guards compare exact stored JSON, including extra fields and formatting.
    const tx = await transactions(h)
    try {
      const [nativeDoc] = nativeDocs
      const row = await tx.lodgeTargets.read(h.db, 'lodge', 'document', nativeDoc.doc.id)
      const guard = tx.lodgeTargets.matches(row, 'lodge', 'document', nativeDoc.doc.id)
      assert.equal((await h.db.prepare('SELECT ' + guard.sql + ' AS matches').bind(...guard.params).first()).matches, 1)
      const changed = JSON.stringify({ ...JSON.parse(nativeDoc.stored.value), hiddenEdit: 'must invalidate snapshot' }, null, 2)
      await h.db.prepare("UPDATE l_records SET value=? WHERE kind='blob' AND id=?").bind(changed, nativeDoc.doc.id).run()
      const beforeConflict = await recordSnapshot(h)
      await assert.rejects(() => h.db.batch([
        h.db.prepare("DELETE FROM l_records WHERE kind='candidate' AND id=?").bind(lee.id),
        h.db.prepare('INSERT INTO l_guard SELECT CASE WHEN ' + guard.sql + ' THEN 1 ELSE 0 END').bind(...guard.params),
      ]), /CHECK constraint/)
      assert.deepEqual(await recordSnapshot(h), beforeConflict, 'same-revision hidden blob edit rolls back destructive native work')
      await h.db.prepare("UPDATE l_records SET value=? WHERE kind='blob' AND id=?").bind(nativeDoc.stored.value, nativeDoc.doc.id).run()
    } finally { await tx.close() }
    const undo = await send('/api/lodge/import/undo', { id: job.id }, owner)
    assert.equal(undo.status, 200, JSON.stringify(undo.value))
    const report2 = (await send('/api/lodge/import/status', { id: job.id }, owner)).value.undo
    assert.ok(report2.dispositions.some(d => d.targetId === dana.id && d.disposition === 'retained' && d.reason === 'edited'))
    assert.ok(report2.dispositions.some(d => d.targetId === lee.id && d.disposition === 'retained' && d.reason === 'dependency'))
    s = await state()
    assert.deepEqual(s.candidates.map(c => c.name).sort(), ['Dana Whitfield', 'Lee Moreno', 'Native applicant'], 'only what people changed or rely on stays')
    for (const { doc, stored, bytes } of nativeDocs) {
      assert.deepEqual(await h.db.prepare("SELECT revision,value FROM l_records WHERE kind='blob' AND id=?").bind(doc.id).first(), stored, 'native blob representation stays byte-exact')
      const download = await send('/api/lodge/download/document/' + doc.id, undefined, owner)
      assert.equal(download.status, 200); assert.equal(download.text, bytes)
    }
    assert.ok(!s.vacancies.some(x => x.imported), 'unchanged imported vacancies are removed')
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='blob' AND id LIKE 'workable:%'").first()).n, 0, 'unchanged document bytes are removed with their records')
  } finally { await h.close() }
})

// Legacy links are independent of account-backed source migration acceptance.
test('MIG-009 old source links resolve only to currently public mapped jobs and posts', async t => {
  const { checkLegacyLinks } = await import('./legacy-links.mjs')
  await checkLegacyLinks(t)
})
