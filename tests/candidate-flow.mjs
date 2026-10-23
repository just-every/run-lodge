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

/** A fresh submitted application with a native candidate identity, no staff role. */
export async function candidateFixture() {
  const h = await harness()
  try {
    await h.command('business', BUSINESS)
    const job = await careersJob(h.command, 'Residential account coordinator')
    const apply = async (name, email) => {
      const r = await h.send('/jobs/' + job.slug, form({ name, email, noticeVersion: '1', consent: 'yes', coverNote: 'Original evidence synthetic-lodge-1' }))
      assert.equal(r.status, 200, r.text)
      const receipt = r.text.match(/LDG-[A-F0-9]{8}/)[0]
      const workspace = await h.state(), app = workspace.applications.find(a => a.id === workspace.receipts.find(r => r.id === receipt).application)
      return { receipt, app, person: workspace.candidates.find(p => p.id === app.candidate), path: '/candidate/receipts/' + receipt }
    }
    const invite = async email => {
      assert.equal((await h.send('/auth/invite', { email, displayName: 'Candidate', role: 'member', returnTo: '/candidate' }, h.owner)).status, 202)
      const mail = await latestMail(h, email)
      const token = new URL(mail.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
      const confirmed = await h.send('/auth/confirm', { token })
      assert.equal(confirmed.status, 303)
      return confirmed.cookie
    }
    const alice = await apply('Avery Hudson', 'account-alice@example.test'), bob = await apply('Blair Okafor', 'account-bob@example.test')
    const cookie = await invite(alice.person.email), bobCookie = await invite(bob.person.email)
    return { h, job, alice, bob, cookie, bobCookie }
  } catch (e) { await h.close(); throw e }
}
export async function latestMail(h, address) {
  const rows = await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()
  const mail = rows.results.map(r => JSON.parse(r.message)).find(m => m.to.includes(address))
  assert.ok(mail, 'mail reached only the provider network edge')
  return mail
}
export { form as candidateForm }

export async function checkCandidateAccount() {
  const { h, alice, bob, cookie, bobCookie } = await candidateFixture()
  try {
    const path = alice.path + '/account'
    const rows = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
    const initial = await rows()
    assert.equal((await h.send('/auth/email', { email: bob.person.email }, cookie)).status, 403, 'generic account email changes cannot bypass new-inbox verification')
    assert.match((await h.send(path, undefined, cookie)).text, /No progress update shared yet/)
    for (const suffix of ['/account', '/email/confirm']) {
      const other = await h.send(bob.path + suffix, undefined, cookie), absent = await h.send('/candidate/receipts/LDG-00000000' + suffix, undefined, cookie)
      assert.equal(other.status, 404); assert.equal(other.text, absent.text)
    }
    for (const suffix of ['answer', 'preferences', 'withdraw', 'email']) {
      assert.equal((await h.send(bob.path + '/account/' + suffix, form({}), cookie)).status, 404)
      assert.equal((await h.send(path + '/' + suffix, form({}), '', {})).status, 401)
      assert.equal((await h.send(path + '/' + suffix, form({}), cookie, { origin: 'https://foreign.example.test' })).status, 403)
    }
    assert.deepEqual(await rows(), initial, 'refusals save nothing')
    const interviewer = await h.member('synthetic-lodge-1@example.test', ['interviewer'])
    await h.command('candidate-progress', { application: alice.app.id, progress: 'In review' }, interviewer, 403)
    assert.equal((await h.send('/candidate/employer/' + alice.app.id, undefined, cookie)).status, 403)
    await h.command('candidate-progress', { application: alice.app.id, progress: 'In review', message: 'Your application is being reviewed.', request: 'When could you start?' })
    const app = (await h.state()).applications.find(a => a.id === alice.app.id), request = app.candidateAccount.requests[0]
    const shown = await h.send(path, undefined, cookie)
    assert.match(shown.text, /In review/); assert.match(shown.text, /When could you start/)
    assert.ok(!shown.text.includes(alice.app.stage)); assert.ok(!shown.text.includes('Original evidence synthetic-lodge-1'))
    assert.equal((await h.send(path + '/answer', form({ request: request.id, answer: 'Two weeks after notice.' }), cookie)).status, 303)
    assert.equal((await h.send(path + '/answer', form({ request: request.id, answer: 'Overwrite' }), cookie)).status, 409)
    assert.equal((await h.send(bob.path + '/account/answer', form({ request: request.id, answer: 'Forged' }), bobCookie)).status, 404)
    assert.match((await h.send('/candidate/employer/' + alice.app.id, undefined, h.owner)).text, /Two weeks after notice/)
    assert.equal((await h.send(path + '/preferences', form({ preference: 'none', talentPool: '' }), cookie)).status, 303)
    let state = await h.state()
    assert.equal(state.candidates.find(c => c.id === alice.person.id).contactPreference.preference, 'none')
    assert.equal(state.candidates.find(c => c.id === alice.person.id).consent.talentPool, false)
    await h.command('hold', { candidate: alice.person.id, reason: 'Retain original evidence synthetic-lodge-1' })
    const hold = (await rows()).filter(r => r.kind === 'hold')
    const oldCookie = await h.signIn(alice.person.email)
    const originalReceipt = (await rows()).find(r => r.kind === 'receipt' && r.id === alice.receipt)
    const newEmail = 'account-new@example.test'
    const start = await h.send(path + '/email', form({ email: newEmail }), cookie)
    assert.equal(start.status, 200, start.text)
    assert.match(start.text, /handed to the mail provider/)
    assert.equal((await h.state()).candidates.find(c => c.id === alice.person.id).email, alice.person.email)
    const mail = await latestMail(h, newEmail), link = new URL(mail.text.match(/http:\/\/\S+/)[0]), token = link.searchParams.get('token')
    const pendingRows = await rows()
    const exported = await h.send('/api/lodge/download/candidate/' + alice.person.id, undefined, h.owner)
    assert.equal(exported.status, 200)
    const pending = pendingRows.find(r => r.kind === 'candidate-email-change' && r.id === alice.person.id)
    assert.ok(!exported.text.includes(token) && !exported.text.includes(JSON.parse(pending.value).hash), 'verification capabilities stay out of candidate exports')
    assert.ok(!pendingRows.some(r => r.value.includes(token)), 'only the token digest is kept')
    assert.equal((await h.send(link.pathname + link.search, undefined, cookie)).status, 200, 'GET is a read-only preview')
    assert.equal((await h.send(link.pathname, form({ token }), bobCookie)).status, 404)
    assert.equal((await h.send(link.pathname, form({ token: '0'.repeat(64) }), cookie)).status, 404)
    assert.equal((await h.send(path + '/email', form({ email: newEmail }), cookie)).status, 429)
    assert.equal((await h.send(link.pathname, form({ token }), cookie)).status, 303)
    assert.equal((await h.send(path, undefined, oldCookie)).status, 401, 'other old-address sessions ended')
    assert.equal((await h.send(path, undefined, cookie)).status, 200, 'confirming account now owns the verified new email')
    assert.equal((await h.send(link.pathname, form({ token }), cookie)).status, 404, 'single-use confirmation')
    assert.equal((await h.state()).candidates.find(c => c.id === alice.person.id).email, newEmail)
    assert.deepEqual((await rows()).find(r => r.kind === 'receipt' && r.id === alice.receipt), originalReceipt)
    assert.equal((await h.send(path + '/email', form({ email: bob.person.email }), cookie)).status, 409)
    // Expired challenge and expired sign-in each refuse without applying the email change.
    assert.equal((await h.send(path + '/email', form({ email: 'expired-account@example.test' }), cookie)).status, 200)
    const expiredMail = await latestMail(h, 'expired-account@example.test'), expiredLink = new URL(expiredMail.text.match(/http:\/\/\S+/)[0])
    await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.expiresAt',0) WHERE kind='candidate-email-change'").run()
    assert.equal((await h.send(expiredLink.pathname, form({ token: expiredLink.searchParams.get('token') }), cookie)).status, 404)
    assert.equal((await h.send(path + '/withdraw', form({}), cookie)).status, 400)
    const message = await h.command('message', { application: alice.app.id, purpose: 'reminder', subject: 'Follow up', body: 'A pending reminder synthetic-lodge-1' })
    assert.equal((await h.send(path + '/withdraw', form({ confirm: 'yes' }), cookie)).status, 303)
    state = await h.state()
    const withdrawn = state.applications.find(a => a.id === alice.app.id)
    assert.equal(withdrawn.status, 'withdrawn'); assert.equal(withdrawn.coverNote, alice.app.coverNote)
    assert.equal(withdrawn.candidateAccount.requests[0].answer, 'Two weeks after notice.')
    assert.equal(state.messages.find(m => m.id === message.id).cancelled, true)
    assert.equal(state.tasks.filter(t => t.application === alice.app.id && t.status === 'open').length, 0)
    assert.deepEqual((await rows()).filter(r => r.kind === 'hold'), hold, 'withdrawal preserves holds')
    await h.command('message', { application: alice.app.id, purpose: 'reminder', subject: 'No', body: 'No continued sequence' }, h.owner, 409)
    assert.equal((await h.send(path + '/answer', form({ request: request.id, answer: 'Late' }), cookie)).status, 409)
    assert.match((await h.send(path, undefined, cookie)).text, /Withdrawn/)
    const mailCount = (await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n
    await h.mf.getWorker().then(worker => worker.scheduled({ scheduledTime: Date.now(), cron: '0 * * * *' }))
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n, mailCount)
    await h.db.prepare('UPDATE oa_sessions SET expires_at=0 WHERE operator_id=(SELECT id FROM oa_operators WHERE email=?)').bind(newEmail).run()
    assert.equal((await h.send(path, undefined, cookie)).status, 401)
    assert.equal((await h.send(path + '/preferences', form({ preference: 'email' }), cookie)).status, 401)
  } finally { await h.close() }
}


export async function checkCandidateLanguage(h, app, address, language) {
  assert.equal((await h.send('/auth/invite', { email: address, displayName: 'Candidate', role: 'member', returnTo: '/candidate' }, h.owner)).status, 202)
  const invitation = await latestMail(h, address)
  const token = new URL(invitation.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
  const cookie = (await h.send('/auth/confirm', { token })).cookie
  const receipt = (await h.state()).receipts.find(r => r.application === app.id)
  const path = '/candidate/receipts/' + receipt.id + '/account/email'
  const target = 'new-' + address
  if (language === 'fr') {
    const count = (await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n
    assert.equal((await h.send(path, form({ email: target }), cookie)).status, 409, 'no unreviewed language fallback')
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n, count)
    await h.command('candidate-email-copy', { application: app.id, subject: 'Confirmez votre adresse', text: 'Confirmez votre adresse : {link}', reviewed: false }, h.owner, 400)
    await h.command('candidate-email-copy', { application: app.id, subject: 'Confirmez votre adresse', text: 'Confirmez votre adresse : {link}', reviewed: true })
  }
  assert.equal((await h.send(path, form({ email: target }), cookie)).status, 200)
  assert.match((await latestMail(h, target)).subject, language === 'es' ? /Confirma tu nuevo correo/ : /Confirmez votre adresse/)
}

export async function bookingFixture() {
  const f = await candidateFixture(), { h, alice, bob, job } = f
  try {
    const current = (await h.state()).vacancies.find(v => v.id === job.id)
    const start = new Date(Date.now() + 7 * 86400000); start.setUTCHours(15, 0, 0, 0)
    const slots = [0, 1, 2].map(day => new Date(start.getTime() + day * 86400000).toISOString())
    const create = async application => {
      const iv = await h.command('interview', { application, planItem: current.plan[0].id, participants: ['owner@example.test'], slots, durationMinutes: 30, location: 'Site office, front entrance', timezone: 'America/New_York' })
      await h.command('availability', { interview: iv.id, slots: [0, 1] })
      await h.command('interview-self-scheduling', { interview: iv.id, enabled: true })
      return iv
    }
    const interview = await create(alice.app.id), otherInterview = await create(bob.app.id)
    return { ...f, slots, interview, otherInterview, path: alice.path + '/interviews/' + interview.id, otherPath: bob.path + '/interviews/' + otherInterview.id }
  } catch (error) { await h.close(); throw error }
}

export async function checkCandidateBooking() {
  const { h, alice, bob, cookie, bobCookie, slots, interview, otherInterview, path, otherPath } = await bookingFixture()
  try {
    const rows = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
    const before = await rows()
    assert.equal((await h.send(path)).status, 401)
    const shown = await h.send(path, undefined, cookie)
    assert.equal(shown.status, 200); assert.match(shown.text, /Book interview/)
    assert.ok(shown.text.includes(slots[0])); assert.ok(!shown.text.includes(slots[2]), 'a panel-unavailable time is not offered')
    assert.ok(!shown.text.includes('owner@example.test')); assert.ok(!shown.text.includes('Original evidence'))
    for (const other of [otherPath, alice.path + '/interviews/' + otherInterview.id, bob.path + '/interviews/' + interview.id]) {
      const wrong = await h.send(other, undefined, cookie), unknown = await h.send(alice.path + '/interviews/synthetic-lodge-1', undefined, cookie)
      assert.equal(wrong.status, 404); assert.equal(wrong.text, unknown.text)
      assert.equal((await h.send(other, form({ start: slots[0], previousStart: '' }), cookie)).status, 404)
    }
    assert.equal((await h.send(path, form({ start: slots[0], previousStart: '' }), cookie, { origin: 'https://foreign.example.test' })).status, 403)
    assert.deepEqual(await rows(), before, 'refused links and hosts cause no writes')
    assert.equal((await h.send(path, form({ start: slots[2], previousStart: '' }), cookie)).status, 409)
    assert.equal((await h.send(path, form({ start: '2000-01-01T15:00:00.000Z', previousStart: '' }), cookie)).status, 409)
    // Two real candidates compete for one panel time: exactly one transaction can claim it.
    const contenders = await Promise.all([h.send(path, form({ start: slots[0], previousStart: '' }), cookie), h.send(otherPath, form({ start: slots[0], previousStart: '' }), bobCookie)])
    assert.deepEqual(contenders.map(r => r.status).sort(), [303, 409])
    const winner = contenders[0].status === 303 ? { path, cookie, iv: interview } : { path: otherPath, cookie: bobCookie, iv: otherInterview }
    const loser = contenders[0].status === 303 ? { path: otherPath, cookie: bobCookie, iv: otherInterview } : { path, cookie, iv: interview }
    assert.match((await h.send(winner.path, undefined, winner.cookie)).text, /Booked:[\s\S]*Reschedule interview/)
    assert.equal((await h.send(winner.path, form({ start: slots[1], previousStart: '' }), winner.cookie)).status, 409, 'a stale booking form cannot overwrite the appointment')
    assert.equal((await h.send(winner.path, form({ start: slots[1], previousStart: slots[0] }), winner.cookie)).status, 303)
    assert.equal((await h.send(loser.path, form({ start: slots[0], previousStart: '' }), loser.cookie)).status, 303, 'rescheduling releases the old panel slot')
    let state = await h.state()
    assert.equal(state.interviews.filter(iv => [interview.id, otherInterview.id].includes(iv.id) && iv.status === 'scheduled').length, 2)
    assert.deepEqual(state.interviews.find(iv => iv.id === winner.iv.id).candidateBookings.map(b => b.start), [slots[0], slots[1]])
    assert.ok(state.audit.some(event => event.action === 'candidate-interview-rescheduled'))
    await h.command('interview-self-scheduling', { interview: winner.iv.id, enabled: false })
    assert.equal((await h.send(winner.path, form({ start: slots[0], previousStart: slots[1] }), winner.cookie)).status, 409)
    await h.command('cancel-interview', { interview: loser.iv.id, reason: 'Panel change' })
    assert.equal((await h.send(loser.path, form({ start: slots[1], previousStart: slots[0] }), loser.cookie)).status, 409)
    await h.command('interview-self-scheduling', { interview: winner.iv.id, enabled: true })
    await h.send((winner.path === path ? alice : bob).path + '/account/withdraw', form({ confirm: 'yes' }), winner.cookie)
    assert.equal((await h.send(winner.path, form({ start: slots[0], previousStart: slots[1] }), winner.cookie)).status, 409)
    assert.equal((await h.send('/availability/' + interview.candidateToken, form({ slot: '0', start: slots[0], previousStart: '' }))).status, 404, 'withdrawal also closes the possession-only availability link')
    await h.db.prepare('UPDATE oa_sessions SET expires_at=0 WHERE operator_id=(SELECT id FROM oa_operators WHERE email=?)').bind(alice.person.email).run()
    const expiredBefore = await rows()
    assert.equal((await h.send(path, undefined, cookie)).status, 401)
    assert.equal((await h.send(path, form({ start: slots[0], previousStart: slots[1] }), cookie)).status, 401)
    assert.deepEqual(await rows(), expiredBefore)
  } finally { await h.close() }
}
