// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import { browserWidths } from "./browser-widths.mjs"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { BUSINESS, harness } from "./harness.mjs"
import { join } from "node:path"
import { api, current, session } from "./browser-journey.mjs"

// OFFER-005 through the public doors: staff routes, the candidate's signing page and signed-copy page, the saved
// records and the mail network edge. Nothing in Lodge is faked; only the mail provider's network edge is.




const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const PHONE = { 'CF-Connecting-IP': '203.0.113.7', 'user-agent': 'Lodge-Test-Phone/1.0' }
const form = fields => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f }

/** Every mail the edge recorded for one address, oldest first. */
async function mails(h, to) {
 const rows = await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence').all()
 return rows.results.map(r => JSON.parse(r.message)).filter(m => m.to.includes(to))
}
const lastMail = async (h, to, pattern) => { const m = (await mails(h, to)).filter(x => pattern.test(x.subject + x.text)).at(-1); assert.ok(m, 'mail reached the edge: ' + pattern); return m }
const linkOf = async (h, to, kind) => (await lastMail(h, to, /sent you an offer|signed offer copy/)).text.match(new RegExp(`/${kind}/([0-9a-f]{64})`))[1]
const codeOf = async (h, to) => (await lastMail(h, to, /one-time code/)).text.match(/code is (\d{6})/)[1]

/** Change a stored envelope the way time would (its saved dates), without touching its revision. */
async function patch(h, id, change) {
 const row = await h.db.prepare("SELECT value FROM l_records WHERE kind='esign-envelope' AND id=?").bind(id).first()
 const value = JSON.parse(row.value); change(value)
 await h.db.prepare("UPDATE l_records SET value=? WHERE kind='esign-envelope' AND id=?").bind(JSON.stringify(value), id).run()
}
const aged = (h, id) => patch(h, id, e => { if (e.gate.current) e.gate.current.issuedAt = '2026-01-01T00:00:00.000Z' })

async function scenario(h, { native = true } = {}) {
 await h.command('business', BUSINESS)
 const manager = await h.member('preparer@example.test', ['manager'], 'Morgan Preparer')
 const normal = await h.member('normal@example.test', ['approver'], 'Parker Normal')
 const exception = await h.member('exception@example.test', ['approver'], 'Rowan Compensation')
 const signer = await h.member('dana.signer@example.test', ['admin'], 'Dana Signer')
 const other = await h.member('avery.admin@example.test', ['admin'], 'Avery Admin')
 const interviewer = await h.member('ivy.interviewer@example.test', ['interviewer'], 'Ivy Interviewer')
 const agent = await h.member('morgan.agent@example.test', [], 'Morgan’s agent', { agent: true, actsFor: 'preparer@example.test' })
 const cmd = h.command
 if (native) await cmd('esign-signer', { email: 'dana.signer@example.test' })
 const body = 'Dear {{candidateName}},\n{{title}} in {{location}}, {{employmentType}}.\nPay {{pay}}, starting {{startDate}}.\nBonus {{bonus}}; equity {{equity}}.\n{{contingencies}}\n{{terms}}'
 const input = { name: 'Native offer', body, normalApprover: 'normal@example.test', exceptionApprover: 'exception@example.test', contingencies: 'Subject to employer-reviewed work authorization requirements.', reviewed: true }
 const template = await cmd('offer-template', native ? { ...input, native: true, countersign: true, signer: 'dana.signer@example.test' } : input)
 const job = await cmd('vacancy', { title: 'Site superintendent', location: 'Brooklyn, NY', headcount: 3, manager: 'preparer@example.test', compensation: { currency: 'USD', min: 9000000, max: 11000000, period: 'year' } }, manager)
 await cmd('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] }, manager)
 await cmd('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] }, manager)
 const asked = await cmd('request-vacancy-approval', { id: job.id, approver: 'normal@example.test' }, manager)
 await cmd('decide-approval', { id: asked.id, decision: 'approved', reason: 'Budget reviewed', version: asked.version }, normal)
 await cmd('publish', { id: job.id }, manager)
 const live = (await h.state(manager)).vacancies.find(v => v.id === job.id)
 const person = async name => (await cmd('candidate', { name, email: name.toLowerCase().replaceAll(' ', '.') + '@example.test', source: 'Referral', consentBasis: 'referral', consentNote: 'Agreed to this application', vacancy: job.id }, manager))
 const offerFor = async (applied, i) => cmd('offer', { application: applied.application.id, title: job.title, salary: { currency: 'USD', amount: 10000000, period: 'year' }, startDate: '2026-12-07', terms: 'Forty hours each week.', opening: live.openings[i].id, offerTemplate: { id: template.id, version: 1 }, equity: 'No equity granted', location: 'Brooklyn, NY', employmentType: 'full-time' }, manager)
 const approve = async offer => { const r = await cmd('request-offer-approval', { id: offer.id }, manager); await cmd('decide-approval', { id: r.id, version: r.version, decision: 'approved', reason: 'Exact document and compensation reviewed' }, normal); return r }
 return { manager, normal, signer, other, interviewer, agent, template, job, live, person, offerFor, approve, cmd }
}

export async function checkEsign() {
 const h = await harness()
 try {
  const t = await scenario(h)
  const { manager, signer, other, interviewer, agent, cmd } = t
  const staff = (cookie, path, body, extra) => h.send('/api/lodge/esign/' + path, body, cookie, extra)
  const view = async (cookie, offer) => (await h.state(cookie)).offers.find(o => o.id === offer)?.esign
  const taylor = await t.person('Taylor Rivers'); const taylorId = taylor.application.candidate
  const offer = await t.offerFor(taylor, 0)
  assert.equal(offer.document.signing.native, true, 'the reviewed template version chooses the native path and sits in the approved document')

  // Who may send, and on what: refused before any approval, before the disclosure is reviewed, and for the wrong people.
  assert.equal((await staff(manager, 'send', { offer: offer.id })).status, 409, 'an unapproved offer is not sent')
  await t.approve(offer)
  const early = await staff(manager, 'send', { offer: offer.id })
  assert.equal(early.status, 409); assert.match(early.value.error, /Review the electronic signature disclosure first/)
  await cmd('esign-disclosure', { reviewed: true }, manager, 403)
  await cmd('esign-disclosure', { reviewed: false }, h.owner, 400)
  const disclosure = await cmd('esign-disclosure', { reviewed: true, contactName: 'Hiring desk', contactEmail: 'hiring@example.test' })
  assert.equal(disclosure.versions[0].version, 1); assert.match(disclosure.versions[0].fingerprint, /^[0-9a-f]{64}$/)
  await cmd('esign-signer', { email: 'ivy.interviewer@example.test' }, interviewer, 403)
  await cmd('esign-signer', { email: 'morgan.agent@example.test' }, h.owner, 409)
  for (const [who, cookie] of [['interviewer', interviewer], ['agent', agent]]) { const r = await staff(cookie, 'send', { offer: offer.id }); assert.ok([403, 404].includes(r.status), who + ' cannot send: ' + r.status) }
  assert.equal((await staff(manager, 'send', { offer: offer.id, days: 31 })).status, 400, 'expiry is 1 to 30 days')
  assert.equal((await staff(manager, 'send', { offer: offer.id, signer: 'avery.admin@example.test', countersign: true })).status, 409, 'the countersigner must be designated')
  assert.equal((await view(manager, offer.id)), null, 'refusals left no envelope')

  // Mail not set up: refused, and nothing reads as sent (a second Worker without installation mail).
  const bare = await harness({ bindings: { MAIL_PROVIDER: '' } })
  try {
   const u = await scenario(bare, { native: true })
   await u.cmd('esign-disclosure', { reviewed: true })
   const x = await u.person('Pat Mail'), o = await u.offerFor(x, 0); await u.approve(o)
   const refused = await bare.send('/api/lodge/esign/send', { offer: o.id }, u.manager)
   assert.equal(refused.status, 409); assert.match(refused.value.error, /mail is not set up/i)
   assert.equal((await bare.state(u.manager)).offers.find(f => f.id === o.id).esign, null, 'nothing reads as sent')
  } finally { await bare.close() }

  // E1: codes. Five wrong codes, a resend that invalidates, an expired code, ten codes then a locked link.
  let sent = await staff(manager, 'send', { offer: offer.id })
  assert.equal(sent.status, 200, JSON.stringify(sent.value))
  const e1 = sent.value.id
  assert.equal((await staff(manager, 'send', { offer: offer.id })).status, 409, 'a second active envelope is refused')
  assert.equal(sent.value.invitation.status, 'handed')
  let token = await linkOf(h, 'taylor.rivers@example.test', 'sign')
  const base = '/sign/' + token
  assert.ok(!JSON.stringify(sent.value).includes(token) && !JSON.stringify(await h.state(manager)).includes(token), 'staff never read link material')
  const first = await h.send(base)
  assert.equal(first.status, 200); assert.match(first.text, /Offer for signature/); assert.match(first.text, /t\*\*\*@example\.test/)
  assert.equal(first.headers.get('cache-control'), 'no-store'); assert.equal(first.headers.get('referrer-policy'), 'same-origin')
  assert.match(first.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal((await h.send(base + '/code', form({}), '', { origin: 'https://evil.example' })).status, 403, 'exact Origin')
  assert.equal((await h.send('/sign/' + '0'.repeat(64))).status, 404)
  assert.equal((await h.send(base + '/sign', form({ name: 'Taylor Rivers', hash: offer.document.sha256 }))).status, 403, 'no signing without a verified session')
  assert.equal((await h.send(base + '/code', form({}))).status, 200)
  const mailsBefore = (await mails(h, 'taylor.rivers@example.test')).length
  assert.equal((await h.send(base + '/code', form({}))).status, 429, 'one code a minute')
  assert.equal((await mails(h, 'taylor.rivers@example.test')).length, mailsBefore, 'a refused request sends no mail')
  let code = await codeOf(h, 'taylor.rivers@example.test')
  const wrong = c => c === '111111' ? '222222' : '111111'
  for (let i = 0; i < 5; i++) assert.equal((await h.send(base + '/verify', form({ code: wrong(code) }))).status, 403)
  assert.equal((await h.send(base + '/verify', form({ code }))).status, 409, 'five wrong codes lock that code')
  await aged(h, e1)
  // A resent code invalidates its predecessor.
  await h.send(base + '/code', form({})); const older = await codeOf(h, 'taylor.rivers@example.test')
  await aged(h, e1); await h.send(base + '/code', form({})); code = await codeOf(h, 'taylor.rivers@example.test')
  if (older !== code) assert.equal((await h.send(base + '/verify', form({ code: older }))).status, 403, 'the earlier code no longer works')
  // An expired code refuses.
  await patch(h, e1, e => { e.gate.current.expiresAt = '2026-01-01T00:00:00.000Z' })
  assert.equal((await h.send(base + '/verify', form({ code }))).status, 410)
  // Ten codes in all, then the eleventh request is refused and locks the link.
  let issued = (await h.db.prepare("SELECT value FROM l_records WHERE kind='esign-envelope' AND id=?").bind(e1).first()).value
  issued = JSON.parse(issued).gate.issued
  for (; issued < 10; issued++) { await aged(h, e1); assert.equal((await h.send(base + '/code', form({}))).status, 200) }
  await aged(h, e1)
  assert.equal((await h.send(base + '/code', form({}))).status, 429, 'the eleventh code request is refused')
  assert.equal((await h.send(base + '/code', form({}))).status, 403, 'and the link is locked')
  const locked = await view(manager, offer.id)
  assert.equal(locked.locked, true)
  assert.ok((await h.state(manager)).notifications.some(n => n.kind === 'esign' && /locked/.test(n.title)), 'offer managers get an in-app item')
  await cmd('esign-void', { id: e1, reason: 'Link locked after too many codes' }, interviewer, 404)
  await cmd('esign-void', { id: e1, reason: 'Link locked after too many codes' }, manager)
  assert.equal((await h.send(base)).status, 404, 'a voided link resolves to nothing')
  const voidMail = await lastMail(h, 'taylor.rivers@example.test', /no longer active/)
  assert.ok(!/USD|salary|pay/i.test(voidMail.text) && /Hiring desk at hiring@example\.test/.test(voidMail.text), 'the void notice carries no terms and names the employer contact')

  // E2: an expired link refuses viewing, a code and signing, and does not block a fresh envelope.
  sent = await staff(manager, 'send', { offer: offer.id, days: 1 }); const e2 = sent.value.id
  token = await linkOf(h, 'taylor.rivers@example.test', 'sign')
  await patch(h, e2, e => { e.expiresAt = '2026-01-01T00:00:00.000Z' })
  assert.equal((await h.send('/sign/' + token)).status, 410, 'viewing an expired link')
  assert.equal((await h.send('/sign/' + token + '/code', form({}))).status, 410, 'a code for an expired link')
  assert.ok([404, 410].includes((await h.send('/sign/' + token + '/sign', form({ name: 'Taylor Rivers', hash: offer.document.sha256 }))).status), 'signing on an expired link')
  assert.equal((await view(manager, offer.id)).status, 'expired')

  // E3: the whole candidate path on a phone, then a mid-flight pay change voids a candidate-signed envelope.
  async function verify(email) {
   const link = await linkOf(h, email, 'sign'), path = '/sign/' + link
   await h.send(path + '/code', form({}), '', PHONE)
   const done = await h.send(path + '/verify', form({ code: await codeOf(h, email) }), '', PHONE)
   assert.equal(done.status, 303, JSON.stringify(done.text))
   const setCookie = done.headers.get('set-cookie')
   for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', `Path=${path}`]) assert.ok(setCookie.includes(attribute), attribute)
   return { link, path, cookie: done.cookie }
  }
  sent = await staff(manager, 'send', { offer: offer.id }); const e3 = sent.value.id
  let c = await verify('taylor.rivers@example.test')
  let page = await h.send(c.path, undefined, c.cookie, PHONE)
  assert.match(page.text, /Consent to electronic signing/); assert.match(page.text, /Hiring desk at hiring@example\.test/); assert.match(page.text, /on paper/); assert.match(page.text, /browser that can open PDF/)
  assert.equal((await h.send(c.path + '/sign', form({ name: 'Taylor Rivers', hash: offer.document.sha256 }), c.cookie, PHONE)).status, 409, 'signing without consent is refused')
  assert.equal((await h.send(c.path + '/agree', form({ version: '1' }), c.cookie, PHONE)).status, 400, 'consent needs the ticked box')
  assert.equal((await h.send(c.path + '/agree', form({ version: '1', box: 'yes' }), c.cookie, PHONE)).status, 303)
  page = await h.send(c.path, undefined, c.cookie, PHONE)
  assert.ok(page.text.includes(offer.document.sha256) && page.text.includes('Taylor Rivers') && /By selecting Sign I sign this offer letter electronically/.test(page.text))
  const exact = await h.send(c.path + '/document', undefined, c.cookie, PHONE)
  assert.equal(sha(exact.text), offer.document.sha256, 'the candidate downloads the exact approved bytes')
  assert.equal((await h.send(c.path + '/document')).status, 403, 'the document needs the session')
  assert.equal((await h.send(c.path + '/sign', form({ name: 'Taylor Rivers', hash: '0'.repeat(64) }), c.cookie, PHONE)).status, 409, 'a stale hash is refused')
  assert.equal((await h.send(c.path + '/sign', form({ name: '   ', hash: offer.document.sha256 }), c.cookie, PHONE)).status, 400)
  assert.equal((await h.send(c.path + '/sign', form({ name: 'Taylor Rivers', hash: offer.document.sha256 }), c.cookie, PHONE)).status, 303)
  assert.equal((await h.send(c.path + '/sign', form({ name: 'Taylor Rivers', hash: offer.document.sha256 }), c.cookie, PHONE)).status, 303, 'a repeated submit is idempotent')
  assert.equal((await h.send(c.path + '/sign', form({ name: 'Someone Else', hash: offer.document.sha256 }), c.cookie, PHONE)).status, 409)
  let seen = await view(manager, offer.id)
  assert.equal(seen.status, 'candidate-signed'); assert.equal(seen.signature.name, 'Taylor Rivers'); assert.equal(seen.signature.ip, '203.0.113.7')
  assert.equal((await h.state(manager)).offers.find(o => o.id === offer.id).status, 'draft', 'the offer stays without an outcome until completion')
  assert.ok((await h.state(signer)).notifications.some(n => n.kind === 'esign' && /Countersign/.test(n.title)), 'the signer gets an in-app item')
  // No stored value equals the code, the link or the session.
  for (const secret of [c.link, c.cookie.split('=')[1], await codeOf(h, 'taylor.rivers@example.test')]) {
   const hit = await h.db.prepare("SELECT kind FROM l_records WHERE kind<>'blob' AND instr(value, ?) > 0").bind(secret).first()
   assert.equal(hit, null, 'no stored record holds the link, session or code')
  }
  // A mid-flight pay change voids even a candidate-signed envelope, in the same transaction.
  const raised = await cmd('offer', { id: offer.id, application: taylor.application.id, title: offer.title, salary: { currency: 'USD', amount: 10500000, period: 'year' }, startDate: '2026-12-07', terms: 'Forty hours each week.', opening: offer.opening, offerTemplate: { id: t.template.id, version: 1 }, equity: 'No equity granted', location: 'Brooklyn, NY', employmentType: 'full-time' }, manager)
  seen = await view(manager, offer.id)
  assert.equal(seen.status, 'voided'); assert.equal(seen.voidReason, 'offer-edited')
  assert.equal((await h.send(c.path)).status, 404)
  assert.equal((await h.send(c.path + '/sign', form({ name: 'Taylor Rivers', hash: offer.document.sha256 }), c.cookie, PHONE)).status, 404, 'a candidate holding the old hash cannot sign after the concurrent edit')
  assert.equal((await h.send('/api/lodge/esign/countersign', { id: e3, name: 'Dana Signer', hash: offer.document.sha256 }, signer).then(r => r.status)) >= 400, true, 'a voided envelope cannot be countersigned')

  // E4: an email change voids; a corrected address gets a fresh envelope under the same approval.
  const approvedRaised = await t.approve(raised)
  sent = await staff(manager, 'send', { offer: offer.id }); const e4 = sent.value.id
  const person = (await h.state(h.owner)).candidates.find(x => x.id === taylorId)
  await cmd('correct-candidate', { ...person, id: person.id, email: 'taylor.corrected@example.test', reason: 'Candidate gave a new address' })
  assert.equal((await view(manager, offer.id)).voidReason, 'candidate-email-changed')
  sent = await staff(manager, 'send', { offer: offer.id }); const e5 = sent.value.id
  assert.ok((await mails(h, 'taylor.corrected@example.test')).length > 0, 'the fresh envelope goes to the corrected address')

  // E5: withdrawing consent stops the envelope and leaves the offer open.
  c = await verify('taylor.corrected@example.test')
  await h.send(c.path + '/agree', form({ version: '1', box: 'yes' }), c.cookie, PHONE)
  assert.equal((await h.send(c.path + '/withdraw', form({}), c.cookie, PHONE)).status, 200)
  assert.equal((await view(manager, offer.id)).status, 'withdrawn')
  assert.equal((await h.state(manager)).offers.find(o => o.id === offer.id).status, 'draft')
  assert.ok((await h.state(manager)).notifications.some(n => /withdrew consent/.test(n.title ?? '')))

  // E6: countersign, completion, certificate, hash, hire and handoff.
  sent = await staff(manager, 'send', { offer: offer.id }); const e6 = sent.value.id
  c = await verify('taylor.corrected@example.test')
  await h.send(c.path + '/agree', form({ version: '1', box: 'yes' }), c.cookie, PHONE)
  await h.send(c.path + '/sign', form({ name: 'Taylor Rivers', hash: raised.document.sha256 }), c.cookie, PHONE)
  const body6 = { id: e6, name: 'Dana Signer', hash: raised.document.sha256 }
  assert.equal((await staff(other, 'countersign', body6)).status, 403, 'a member who is not the designated signer cannot countersign')
  assert.equal((await staff(manager, 'countersign', body6)).status, 403)
  await cmd('esign-move-signer', { id: e6, signer: 'avery.admin@example.test' }, manager, 409)
  await cmd('esign-signer', { email: 'avery.admin@example.test' })
  await cmd('esign-move-signer', { id: e6, signer: 'avery.admin@example.test' }, manager)
  await cmd('esign-move-signer', { id: e6, signer: 'dana.signer@example.test' }, manager)
  await h.db.prepare("UPDATE oa_sessions SET created_at=created_at-1200000 WHERE operator_id=(SELECT id FROM oa_operators WHERE email='dana.signer@example.test')").run()
  const stale = await staff(signer, 'countersign', body6)
  assert.equal(stale.status, 403); assert.match(stale.value.error, /Sign in again/); assert.ok(stale.value.reauth)
  const fresh = await h.signIn('dana.signer@example.test')
  assert.equal((await staff(fresh, 'countersign', { ...body6, hash: '0'.repeat(64) })).status, 409, 'a changed hash is refused')
  const done = await staff(fresh, 'countersign', body6, { ...PHONE })
  assert.equal(done.status, 200, JSON.stringify(done.value))
  const complete = await view(manager, offer.id)
  assert.equal(complete.status, 'completed'); assert.match(complete.sealed.sha256, /^[0-9a-f]{64}$/)
  const state = await h.state(manager)
  const hired = state.offers.find(o => o.id === offer.id)
  assert.equal(hired.status, 'accepted'); assert.equal(hired.signature.kind, 'native'); assert.match(hired.signature.label, /signed in Lodge \(native e-signature\)/)
  assert.equal(state.applications.find(a => a.id === taylor.application.id).status, 'hired', 'completion records the hire')
  const download = id => h.send('/api/lodge/download/document/' + id, undefined, manager)
  const inSession = await h.mf.dispatchFetch(h.origin + c.path + '/certificate.pdf', { headers: { cookie: c.cookie } })
  assert.equal(inSession.status, 200, 'the verified candidate downloads the certificate in the session')
  assert.equal(sha(Buffer.from(await inSession.arrayBuffer())), complete.sealed.certificateSha256)
  assert.equal((await h.send(c.path + '/sign', form({ name: 'Taylor Rivers', hash: raised.document.sha256 }), c.cookie, PHONE)).status, 303, 'a repeated sign after completion stays idempotent')
  const pdf = await download(complete.sealed.document), cert = await download(complete.sealed.certificate)
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf')
  const sealedBytes = Buffer.from((await h.mf.dispatchFetch(h.origin + '/api/lodge/download/document/' + complete.sealed.document, { headers: { cookie: manager, origin: h.origin } }).then(r => r.arrayBuffer())))
  const certBytes = Buffer.from((await h.mf.dispatchFetch(h.origin + '/api/lodge/download/document/' + complete.sealed.certificate, { headers: { cookie: manager, origin: h.origin } }).then(r => r.arrayBuffer())))
  assert.equal(sha(sealedBytes), complete.sealed.sha256, 'the sealed PDF hashes to the recorded value')
  assert.equal(sha(certBytes), complete.sealed.certificateSha256)
  const certificate = certBytes.toString('latin1')
  assert.ok(certificate.includes('Sealed PDF SHA-256: ' + sha(sealedBytes)), 'the certificate prints the sealed PDF hash')
  assert.ok(certificate.includes('Approved document SHA-256: ' + raised.document.sha256))
  for (const field of ['Employer legal name: Example Builders', 'Verified email: taylor.corrected@example.test', 'Authentication method: emailed one-time code', 'incorrect codes on record: 0', 'Consent IP address: 203.0.113.7', 'Consent user agent: Lodge-Test-Phone/1.0', 'Consent version: 1', 'Signing IP address: 203.0.113.7', 'Adopted name: Taylor Rivers', 'Verified email: dana.signer@example.test', 'Authentication method: Lodge native session', 'Countersigning user agent: Lodge-Test-Phone/1.0', 'Countersigning IP address: 203.0.113.7', 'does not verify signing authority', 'not a PKI digital signature', ' UTC / '])
   assert.ok(certificate.includes(field), 'certificate lists ' + field)
  assert.ok(sealedBytes.toString('latin1').includes(raised.document.text.split('\n')[2]), 'the sealed PDF carries the approved text')
  assert.equal((await h.send('/api/lodge/download/document/' + complete.sealed.document, undefined, agent)).status, 404, 'agents never download the sealed PDF')
  assert.equal((await h.send('/api/lodge/download/document/' + complete.sealed.document, undefined, interviewer)).status, 404)
  const handoff = await h.send('/api/lodge/download/handoff/' + offer.id, undefined, manager)
  assert.equal(handoff.value.signature.kind, 'native'); assert.equal(handoff.value.signature.sha256, complete.sealed.sha256); assert.equal(handoff.value.signature.certificateSha256, complete.sealed.certificateSha256)

  // The completion copy: a link in mail, opened only after a fresh code, in its own browser session.
  const copy = await linkOf(h, 'taylor.corrected@example.test', 'copy'), copyPath = '/copy/' + copy
  assert.ok(!(await lastMail(h, 'taylor.corrected@example.test', /signed offer copy/)).text.match(/USD|salary/i), 'the completion mail carries no terms')
  assert.equal((await h.send(copyPath + '/sealed.pdf')).status, 403)
  await h.send(copyPath + '/code', form({}))
  assert.equal((await h.send(copyPath + '/verify', form({ code: wrong(await codeOf(h, 'taylor.corrected@example.test')) }))).status, 403)
  const opened = await h.send(copyPath + '/verify', form({ code: await codeOf(h, 'taylor.corrected@example.test') }))
  assert.equal(opened.status, 303)
  const copyPdf = await h.mf.dispatchFetch(h.origin + copyPath + '/sealed.pdf', { headers: { cookie: opened.cookie } })
  assert.equal(sha(Buffer.from(await copyPdf.arrayBuffer())), complete.sealed.sha256)

  // OPS-001: every step is an event, without a code, link or session.
  const audit = await h.send('/api/lodge/audit', undefined, h.owner)
  const actions = new Set(audit.value.events.map(e => e.action))
  for (const action of ['esign-sent', 'esign-invitation-handed-to-mail-provider', 'esign-opened', 'esign-code-sent', 'esign-code-failed', 'esign-locked', 'esign-expired', 'esign-verified', 'esign-consent', 'esign-consent-withdrawn', 'esign-signed', 'esign-voided', 'esign-signer-moved', 'esign-countersigned', 'esign-completed', 'esign-void-notice-handed-to-mail-provider', 'esign-completion-copy-handed-to-mail-provider', 'esign-copy-verified']) assert.ok(actions.has(action), 'audit has ' + action)
  const trail = JSON.stringify(audit.value)
  for (const secret of [token, c.link, copy, c.cookie.split('=')[1]]) assert.ok(!trail.includes(secret), 'the audit holds no link or session')

  // LDG-012: the access export carries the original bytes and digests; holds block erasure; erasure removes everything.
  const exported = await h.send('/api/lodge/download/candidate/' + taylorId, undefined, h.owner)
  const exportedPdf = exported.value.document.find(d => d.id === complete.sealed.document)
  assert.equal(sha(Buffer.from(exportedPdf.base64, 'base64')), complete.sealed.sha256); assert.equal(exportedPdf.sha256, complete.sealed.sha256)
  assert.ok(exported.value.offer.some(o => o.esign?.consent?.ip === '203.0.113.7' && o.esign.consent.fingerprint), 'the export carries the consent record')
  const placed = await cmd('hold', { candidate: taylorId, reason: 'Pending claim' })
  const erase = { candidate: taylorId, confirm: 'Taylor Rivers', reason: 'Candidate asked for deletion' }
  assert.equal((await h.send('/api/lodge/delete-candidate', erase, h.owner)).status, 409, 'a hold refuses erasure')
  assert.equal((await download(complete.sealed.document)).status, 200, 'the signed records survive the refused erasure')
  await cmd('release-hold', { id: placed.id, reason: 'Claim closed' })
  assert.equal((await h.send('/api/lodge/delete-candidate', erase, h.owner)).status, 200)
  assert.equal((await download(complete.sealed.document)).status, 404); assert.equal((await download(complete.sealed.certificate)).status, 404)
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='esign-envelope' OR kind='esign-notice' OR (kind='document' AND json_extract(value,'$.esign') IS NOT NULL)").first()).n, 0)
  assert.equal((await h.send(copyPath, undefined, opened.cookie)).status, 404, 'the copy link refuses after erasure')
 } finally { await h.close() }
}

/**
 * The candidate's pages in a real browser at 1440 and 390, served by the same Worker the API test uses (local `rer dev`
 * captures no mail, so the code and link are read from the test mail edge): code, consent, review, sign, completion.
 */
export async function candidateScreens(browser, evidence) {
 const { join } = await import('node:path')
 const h = await harness()
 try {
  const t = await scenario(h)
  await t.cmd('esign-disclosure', { reviewed: true, contactName: 'Hiring desk', contactEmail: 'hiring@example.test' })
  for (const [width, name] of [[1440, 'Rowan Eastman'], [390, 'Mina Okafor']].filter(([width]) => browserWidths.includes(width))) {
   const email = name.toLowerCase().replace(' ', '.') + '@example.test'
   const applied = await t.person(name), offer = await t.offerFor(applied, width === 1440 ? 0 : 1)
   await t.approve(offer)
   const sent = await h.send('/api/lodge/esign/send', { offer: offer.id }, t.manager)
   assert.equal(sent.status, 200, JSON.stringify(sent.value))
   const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage(), errors = []
   page.on('pageerror', e => errors.push(e.message))
   const fits = async label => { const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); const wide = m.scroll > m.width + 1 ? await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map(e => e.tagName + '.' + e.className + ':' + Math.round(e.getBoundingClientRect().right))) : []; assert.ok(m.scroll <= m.width + 1, `${label} at ${width}: no sideways scrolling (${m.scroll} > ${m.width}) ${wide}`) }
   const shot = async step => { await fits(step); await page.screenshot({ path: join(evidence, `OFFER-005-${step}-${width}.png`), fullPage: true }) }
   try {
    const token = await linkOf(h, email, 'sign')
    await page.goto(h.origin + '/sign/' + token)
    await page.getByRole('heading', { name: 'Offer for signature' }).waitFor()
    await page.getByRole('button', { name: 'Email me a code' }).click()
    await page.getByText(/We emailed a code/).waitFor()
    await shot('verify')
    await page.getByLabel('Six-digit code').fill(await codeOf(h, email))
    await page.getByRole('button', { name: 'Verify' }).click()
    await page.getByRole('heading', { name: 'Consent to electronic signing' }).waitFor()
    await shot('consent')
    await page.getByLabel(/I have read this and I agree/).check()
    await page.getByRole('button', { name: 'Agree', exact: true }).click()
    await page.getByRole('heading', { name: 'Review the offer' }).waitFor()
    assert.ok((await page.locator('pre.sign-doc').textContent()).includes('USD 100000.00 per year'))
    await shot('sign')
    await page.getByLabel('Type your full name').fill(name)
    await page.getByRole('button', { name: 'Sign', exact: true }).click()
    await page.getByText(/waits for Example Builders to countersign/).waitFor()
    await shot('signed')
    const envelope = (await h.state(t.manager)).offers.find(o => o.id === offer.id).esign
    const countersigned = await h.send('/api/lodge/esign/countersign', { id: envelope.id, name: 'Dana Signer', hash: offer.document.sha256 }, await h.signIn('dana.signer@example.test'))
    assert.equal(countersigned.status, 200, JSON.stringify(countersigned.value))
    await page.reload()
    await page.getByRole('link', { name: 'Download the signed offer (PDF)' }).waitFor()
    await shot('completed')
    assert.deepEqual(errors, [])
   } finally { await context.close() }
  }
 } finally { await h.close() }
}

// OFFER-005 through the real screens at 1440 and 390: the candidate's pages in a browser (tests/esign-driver.mjs, with the test
// mail edge, because local `rer dev` captures no mail) and, on the running app, the hiring manager's send and the
// designated signer's countersign and completed panels.





async function fits(page, label) {
 const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
 assert.ok(scroll <= width + 1, `${label}: no sideways scrolling (${scroll} > ${width})`)
}

export async function esignPage(browser, { root, origin, run, evidence, ownerEmail }) {
 await candidateScreens(browser, evidence)
 await run('esign-disclosure', { reviewed: true, contactName: 'Example hiring desk', contactEmail: 'hiring@example.test' })
 const body = 'Dear {{candidateName}},\nWe offer {{title}} at {{location}}, {{employmentType}}, from {{startDate}}.\nPay {{pay}}. Bonus {{bonus}}. Equity {{equity}}.\n{{contingencies}}\n{{terms}}'
 const template = await run('offer-template', { name: 'Native signed offer', body, contingencies: 'Subject to the employer-reviewed work authorization requirements.', normalApprover: 'approver@dev.localhost', exceptionApprover: ownerEmail, native: true, countersign: true, signer: ownerEmail, reviewed: true })
 for (const width of browserWidths) {
  const name = width === 1440 ? 'Rowan Eastman' : 'Mina Okafor', email = `native.${width}@example.test`
  const job = await run('vacancy', { title: `Estimator — native signing ${width}`, location: 'Brooklyn, NY', manager: 'manager@dev.localhost', headcount: 1, compensation: { currency: 'USD', min: 6500000, max: 8500000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
  const asked = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: asked.id, decision: 'approved', version: asked.version, reason: 'Budget approved' })
  await run('publish', { id: job.id })
  const added = await run('candidate', { name, email, source: 'Referral', consentBasis: 'referral', consentNote: 'Agreed to apply', vacancy: job.id })
  const manager = await session(browser, root, origin, 'manager', width), approver = await session(browser, root, origin, 'approver', width), owner = await session(browser, root, origin, 'owner', width)
  try {
   const errors = []
   const offer = await api(manager.context, origin, 'offer', { application: added.application.id, title: job.title, salary: { currency: 'USD', amount: 7500000, period: 'year' }, startDate: '2026-12-07', terms: 'Forty hours a week.', opening: (await current(manager.context, origin)).vacancies.find(v => v.id === job.id).openings[0].id, offerTemplate: { id: template.id, version: 1 }, location: 'Brooklyn, NY', employmentType: 'full-time', equity: 'No equity granted' })
   const asking = await api(manager.context, origin, 'request-offer-approval', { id: offer.id })
   await api(approver.context, origin, 'decide-approval', { id: asking.id, version: asking.version, decision: 'approved', reason: 'Reviewed exact document' })

   // The hiring manager sends it for native signature from the decisions tab.
   const page = manager.page; page.on('pageerror', e => errors.push(e.message))
   await page.goto(origin + '/app?application=' + added.application.id)
   await page.getByRole('tab', { name: 'Decisions', exact: true }).click()
   const panel = page.getByRole('region', { name: 'Native signature' })
   await panel.getByRole('button', { name: 'Send for native signature' }).click()
   await panel.getByText('out for native signature').waitFor()
   await fits(page, 'sent')
   await page.screenshot({ path: join(evidence, `OFFER-005-sent-${width}.png`), fullPage: true })

   // The designated signer's own panel. Local `rer dev` captures no mail, so a candidate signature cannot be produced
   // here; the countersign and completed layouts are checked on the real screen with the saved state answered as the
   // API test proves it (the behaviour itself is asserted through the API in tests/esign-driver.mjs).
   const signer = owner.page; signer.on('pageerror', e => errors.push(e.message))
   const answer = async patch => {
    await signer.unroute('**/api/lodge/state')
    await signer.route('**/api/lodge/state', async route => {
     const response = await route.fetch(), state = await response.json()
     state.offers = state.offers.map(o => o.id === offer.id ? patch(o) : o)
     await route.fulfill({ response, json: state })
    })
   }
   await answer(o => ({ ...o, esign: { ...o.esign, status: 'candidate-signed', label: 'signed by candidate, awaiting countersignature', countersign: { required: true, signer: ownerEmail }, signature: { name } } }))
   await signer.goto(origin + '/app?application=' + added.application.id)
   await signer.getByRole('tab', { name: 'Decisions', exact: true }).click()
   const mine = signer.getByRole('region', { name: 'Native signature' })
   await mine.getByText('signed by candidate, awaiting countersignature').waitFor()
   await mine.getByRole('button', { name: 'Countersign for the employer' }).waitFor()
   await fits(signer, 'countersign')
   await signer.screenshot({ path: join(evidence, `OFFER-005-countersign-${width}.png`), fullPage: true })
   await answer(o => ({ ...o, status: 'accepted', esign: { ...o.esign, status: 'completed', label: 'accepted, signed in Lodge (native e-signature)' }, signature: { kind: 'native', label: 'accepted, signed in Lodge (native e-signature)', document: 'x', certificate: 'y', sha256: 'a'.repeat(64) } }))
   await signer.goto(origin + '/app?application=' + added.application.id)
   await signer.getByRole('tab', { name: 'Decisions', exact: true }).click()
   await mine.getByRole('link', { name: 'Signed offer (PDF)' }).waitFor()
   await fits(signer, 'completed')
   await signer.screenshot({ path: join(evidence, `OFFER-005-completed-${width}.png`), fullPage: true })
   assert.deepEqual(errors, [])
  } finally { await owner.context.close(); await approver.context.close(); await manager.context.close() }
 }
}
