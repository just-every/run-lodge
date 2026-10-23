import assert from 'node:assert/strict'
import { BUSINESS, harness } from './harness.mjs'
import { careersJob } from './careers-flow.mjs'

const form = fields => { const body = new FormData(); for (const [key, value] of Object.entries(fields)) body.set(key, value); return body }

// CAND-001 extends the receipt and PRIV-001 doors with native email identity.
// Only the harness mail provider edge is replaced; every account and record is real.
export async function checkCandidate() {
  const h = await harness()
  try {
    await h.command('business', BUSINESS)
    const job = await careersJob(h.command, 'Residential site lead')
    const apply = async (name, email) => {
      const result = await h.send('/jobs/' + job.slug, form({ name, email, phone: '+1 555 0101', noticeVersion: '1', consent: 'yes', coverNote: 'Original application evidence.' }))
      assert.equal(result.status, 200, result.text)
      return { receipt: result.text.match(/LDG-[A-F0-9]{8}/)[0], recovery: result.text.match(/data-recovery-code>([a-f0-9]{64})</)[1] }
    }
    const alice = await apply('Alice Candidate', 'alice-candidate@example.test')
    const bob = await apply('Bob Candidate', 'bob-candidate@example.test')
    const base = '/candidate/receipts/' + alice.receipt
    const other = '/candidate/receipts/' + bob.receipt
    const missing = '/candidate/receipts/LDG-00000000'
    const invite = async email => {
      const result = await h.send('/auth/invite', { email, displayName: 'Candidate native identity', role: 'member', returnTo: '/candidate' }, h.owner)
      assert.equal(result.status, 202, result.text)
      const rows = await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()
      const mail = rows.results.map(row => JSON.parse(row.message)).find(message => message.to.includes(email))
      assert.ok(mail, 'native invitation is delivered to the mail edge')
      const token = new URL(mail.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
      const confirmed = await h.send('/auth/confirm', { token })
      assert.equal(confirmed.status, 303, confirmed.text)
      assert.ok(confirmed.cookie)
      return confirmed.cookie
    }
    const cookie = await invite('alice-candidate@example.test')
    const bobCookie = await invite('bob-candidate@example.test')
    assert.ok(!(await h.state()).members.some(member => member.email === 'alice-candidate@example.test'), 'Base membership grants no Lodge hiring role')
    assert.equal((await h.send('/api/lodge/state', undefined, cookie)).status, 403)
    assert.equal((await h.send('/api/lodge/command/vacancy', { title: 'Forbidden' }, cookie)).status, 403)
    for (const path of ['/candidate', base, base + '/requests']) {
      const unsigned = await h.send(path)
      assert.equal(unsigned.status, 401)
      assert.match(unsigned.text, /href="[^"]*signin/)
    }
    const signedIn = await h.signIn('alice-candidate@example.test')
    const list = await h.send('/candidate', undefined, signedIn)
    assert.equal(list.status, 200)
    assert.ok(list.text.includes(base)); assert.ok(!list.text.includes(bob.receipt))
    const original = await h.send(base, undefined, cookie)
    assert.equal(original.status, 200)
    assert.ok(original.text.includes(alice.receipt))
    assert.match(original.text, /Your privacy requests/)
    assert.ok(original.text.includes(base + '/requests'))
    const recovered = await h.send('/jobs/receipt', form({ code: alice.recovery }))
    assert.equal(recovered.status, 200)
    assert.ok(recovered.text.includes(alice.receipt))
    assert.ok(!recovered.text.includes(base + '/requests'), 'possession recovery stays receipt-only')

    const rows = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
    const beforeRefusal = await rows()
    for (const suffix of ['', '/requests', '/requests/synthetic-lodge-1']) {
      const [known, unknown] = await Promise.all([h.send(other + suffix, undefined, cookie), h.send(missing + suffix, undefined, cookie)])
      assert.equal(known.status, 404); assert.equal(unknown.status, 404)
      assert.equal(known.text, unknown.text, 'another valid receipt and an unknown receipt have the same refusal')
    }
    for (const path of [other, missing]) assert.equal((await h.send(path + '/requests', form({ type: 'access' }), cookie)).status, 404)
    assert.deepEqual(await rows(), beforeRefusal, 'refused receipt and request reads/posts save nothing')
    const requestForm = await h.send(base + '/requests', undefined, cookie)
    assert.equal(requestForm.status, 200)
    assert.equal((await h.send(base + '/requests', form({ type: 'correction' }), cookie)).status, 400)
    assert.equal((await h.send(base + '/requests', form({ type: 'access' }), cookie, { origin: 'https://foreign.example.test' })).status, 403)
    const workspace = await h.state()
    const application = workspace.applications.find(app => app.id === workspace.receipts.find(receipt => receipt.id === alice.receipt).application)
    const person = workspace.candidates.find(candidate => candidate.id === application.candidate)
    await h.command('hold', { candidate: person.id, reason: 'Pending employment claim' })
    const evidenceBefore = await rows()
    const requests = {}
    for (const type of ['access', 'deletion', 'correction']) {
      const sent = await h.send(base + '/requests', form({ type, details: type === 'correction' ? 'Please correct my phone to +1 555 0199.' : '', name: 'Forged identity', email: 'bob-candidate@example.test', receipt: bob.receipt }), cookie)
      assert.equal(sent.status, 303, sent.text)
      const location = sent.headers.get('location')
      assert.ok(location.startsWith(base + '/requests/'), location)
      const status = await h.send(location, undefined, cookie)
      assert.equal(status.status, 200)
      for (const text of [/Your privacy request/, /Verified/, /Acknowledged/, /Answer due by/, /Being processed/]) assert.match(status.text, text)
      const record = (await h.state()).dataRequests.find(request => request.id === location.split('/').at(-1))
      assert.equal(record.candidate, person.id)
      assert.deepEqual(record.requester, { name: person.name, email: person.email })
      assert.equal(record.identity.verified, true)
      const due = new Date(Date.parse(record.receivedAt + 'T00:00:00Z') + 45 * 86400000).toISOString().slice(0, 10)
      assert.equal(record.dueOn, due); assert.ok(status.text.includes(due))
      assert.equal((await h.send(location, undefined, bobCookie)).status, 404)
      assert.equal((await h.send(other + '/requests/' + record.id, undefined, bobCookie)).status, 404)
      assert.equal((await h.send(location)).status, 401)
      requests[type] = { record, location }
    }
    const evidenceKinds = new Set(['candidate', 'application', 'receipt', 'document', 'hold'])
    assert.deepEqual((await rows()).filter(row => evidenceKinds.has(row.kind)), evidenceBefore.filter(row => evidenceKinds.has(row.kind)), 'requests preserve original evidence and holds, without edits or erasure')
    await h.command('extend-data-request', { id: requests.access.record.id, days: 10, reason: 'Archived files need retrieval' })
    assert.match((await h.send(requests.access.location, undefined, cookie)).text, /Archived files need retrieval/)
    assert.equal((await h.send('/api/lodge/download/candidate/' + person.id + '?request=' + requests.access.record.id, undefined, h.owner)).status, 200)
    assert.match((await h.send(requests.access.location, undefined, cookie)).text, /Completed[\s\S]*Export provided/)
    assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: person.id, confirm: person.name, reason: 'Applicant request' }, h.owner)).status, 409)
    await h.command('refuse-data-request', { id: requests.deletion.record.id, basis: 'legal-hold', explanation: 'An employment claim requires us to retain these records.' })
    assert.match((await h.send(requests.deletion.location, undefined, cookie)).text, /Refused[\s\S]*employment claim/)
    // Staff own correction fulfilment; submission itself has changed no evidence.
    await h.command('complete-data-request', { id: requests.correction.record.id, outcome: 'Correction reviewed; original submitted evidence retained.' })
    assert.match((await h.send(requests.correction.location, undefined, cookie)).text, /Completed[\s\S]*Correction reviewed/)
    await h.command('correct-candidate', { id: person.id, name: person.name, email: 'alice-current@example.test', phone: person.phone, reason: 'Applicant proved their new email' })
    assert.equal((await h.send(base, undefined, cookie)).status, 404, 'the former email no longer owns the live canonical candidate')
    const currentCookie = await invite('alice-current@example.test')
    assert.equal((await h.send(base, undefined, currentCookie)).status, 200)
    await h.db.prepare('UPDATE oa_sessions SET expires_at=0 WHERE operator_id=(SELECT id FROM oa_operators WHERE email=?)').bind('alice-current@example.test').run()
    const beforeExpired = await rows()
    for (const path of ['/candidate', base, base + '/requests', requests.access.location]) assert.equal((await h.send(path, undefined, currentCookie)).status, 401, 'expired native sessions cannot use candidate pages')
    assert.equal((await h.send(base + '/requests', form({ type: 'access' }), currentCookie)).status, 401)
    assert.deepEqual(await rows(), beforeExpired, 'expired-session reads and submission save nothing')
  } finally { await h.close() }
}
