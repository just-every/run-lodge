import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

/** The actual email handler and MIME parser, with only Cloudflare's delivery edge replaced. */
export async function checkCapture(t, { browser, evidence } = {}) {
 const h = await businessHarness({ inbound: true, bindings: { CAPTURE_DOMAIN: 'capture.example.test' } })
 t.after(() => h.close())
 const { command: cmd, send, owner, db } = h
 const manager = await h.member('capture-member@example.test', ['manager'])
 const other = await h.member('capture-other@example.test', ['manager'])
 const interviewer = await h.member('capture-interviewer@example.test', ['interviewer'])
 const job = await cmd('vacancy', { title: 'Capture role', location: 'Denver, CO', headcount: 1, compensation: RANGE, manager: 'capture-member@example.test' })
 await cmd('vacancy', { title: 'Other role', location: 'Denver, CO', manager: 'capture-other@example.test' })
 const rubric = await cmd('rubric', { id: job.id, criteria: RUBRIC })
 await cmd('interview-plan', { id: job.id, plan: [{ name: 'Interview', stage: rubric.stages[2].id }] })
 const approval = await cmd('request-vacancy-approval', { id: job.id, approver: 'owner@example.test' })
 const version = (await h.state()).approvals.find(a => a.id === approval.id).currentVersion
 await cmd('decide-approval', { id: approval.id, decision: 'approved', version, reason: 'Reviewed' })
 await cmd('publish', { id: job.id })
 const added = await cmd('candidate', { name: 'Synthetic Lodge Capture', email: 'synthetic-lodge-806@example.test', source: 'Referral', consentBasis: 'referral', vacancy: job.id }, manager)
 const known = added.candidate
 const address = (await send('/api/lodge/capture/address', {}, manager)).value.address
 assert.ok(address)
 assert.equal((await send('/api/lodge/capture/address', {}, interviewer)).status, 404)
 const bytes = Buffer.from([0, 1, 2, 255, 13, 10, 128])
 const deliver = async (to, subject, { capture = address, body = 'Outside message', from = 'capture-member@example.test' } = {}) => {
  const headers = { From: from, To: to, Subject: subject, 'Message-ID': '<synthetic-lodge-' + Buffer.from(subject).toString('hex') + '@example.test>', 'MIME-Version': '1.0', 'Content-Type': 'multipart/mixed; boundary="synthetic-lodge-806"' }
  const raw = Object.entries(headers).map(([k,v]) => k + ': ' + v).join('\r\n') + '\r\n\r\n--synthetic-lodge-806\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n' + body + '\r\n--synthetic-lodge-806\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="original.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + bytes.toString('base64') + '\r\n--synthetic-lodge-806--\r\n'
  const r = await h.mf.dispatchFetch(h.origin + '/cdn-cgi/local/email?' + new URLSearchParams({ from, to: capture, format: 'json' }), { method: 'POST', body: raw })
  const result = await r.json()
  assert.deepEqual(result.forwards, [], 'capture never forwards')
  assert.deepEqual(result.replies, [], 'capture never replies')
  assert.ok(result.events.some(e => e.type === 'received'), 'the runtime dispatched a native email event')
  return { status: result.rejectReason ? 400 : r.status, text: JSON.stringify(result) }
 }
 const mailCount = async () => (await db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n
 const before = await mailCount()
 const hidden = (await cmd('candidate', { name: 'Synthetic Lodge Private', email: 'synthetic-lodge-private@example.test', source: 'Referral', consentBasis: 'referral' })).candidate
 assert.equal((await deliver(known.email + ', ' + hidden.email, 'Ambiguous inaccessible')).status, 400)
 assert.equal((await deliver('unknown@example.test', 'Forward inaccessible', { body: 'Forwarded about ' + hidden.email })).status, 400)
 assert.equal((await send('/api/lodge/capture', undefined, manager)).value.length, 0)
 { const delivery = await deliver(known.email, 'Known BCC'); assert.equal(delivery.status, 200, delivery.text) }
 const filed = (await send('/api/lodge/capture?candidate=' + known.id, undefined, manager)).value
 assert.equal(filed.length, 1)
 const m = filed[0], f = m.attachments[0]
 assert.equal(m.subject, 'Known BCC')
 assert.equal(m.body.trim(), 'Outside message')
 assert.equal(m.contactDigests, undefined)
 const exported = await send('/api/lodge/download/candidate/' + known.id, undefined, owner)
 assert.equal(exported.status, 200)
 assert.deepEqual(Buffer.from(exported.value.captures[0].attachments[0].base64, 'base64'), bytes)
 assert.equal(exported.value.captures[0].contactDigests, undefined)
 const filePath = '/api/lodge/capture/' + m.id + '/file/' + f.id
 const download = await h.mf.dispatchFetch(h.origin + filePath, { headers: { cookie: manager, origin: h.origin } })
 assert.equal(download.status, 200)
 assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
 { const delivery = await deliver(known.email, 'Known BCC'); assert.equal(delivery.status, 200, delivery.text) }
 assert.equal((await send('/api/lodge/capture?candidate=' + known.id, undefined, manager)).value.length, 1, 'exact transport replay files once')
 for (const cookie of [interviewer, other]) for (const path of ['/api/lodge/capture?candidate=' + known.id, '/api/lodge/capture/' + m.id, filePath]) assert.equal((await send(path, undefined, cookie)).status, 404)
 assert.equal((await deliver('unknown@example.test', 'Forward unknown', { body: 'Forwarded email about synthetic-lodge-unknown@example.test' })).status, 200)
 const queue = (await send('/api/lodge/capture', undefined, manager)).value
 assert.equal(queue.length, 1)
 const q = queue[0], qp = '/api/lodge/capture/' + q.id
 assert.equal((await send('/api/lodge/capture', undefined, other)).value.length, 0)
 for (const cookie of [owner, other, interviewer]) {
  assert.equal((await send(qp, undefined, cookie)).status, 404)
  assert.equal((await send(qp + '/file/' + q.attachments[0].id, undefined, cookie)).status, 404)
  assert.equal((await send(qp + '/resolve', { candidate: known.id }, cookie)).status, 404)
 }
 for (const cookie of [interviewer, other]) assert.equal((await send('/capture/candidate/' + known.id, undefined, cookie)).status, 404)
 for (const cookie of [interviewer]) for (const path of ['/capture', '/capture/settings']) assert.equal((await send(path, undefined, cookie)).status, 404)
 assert.equal((await send('/capture')).status, 401)
 for (const cookie of [owner, other]) assert.ok(!(await send('/capture', undefined, cookie)).text.includes('Forward unknown'))
 if (browser) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(evidence, { recursive: true })
  const { browserWidths } = await import('./browser-widths.mjs')
  for (const width of browserWidths) {
   const context = await browser.newContext({ viewport: { width, height: 1000 } })
   await context.addCookies(manager.split('; ').map(value => { const i = value.indexOf('='); return { name: value.slice(0, i), value: value.slice(i + 1), url: h.origin } }))
   const page = await context.newPage(), errors = []
   page.on('pageerror', e => errors.push(e.message))
   try {
    for (const [name, path, heading] of [['candidate', '/capture/candidate/' + known.id, 'Captured email for ' + known.name], ['queue', '/capture', 'Your capture queue'], ['settings', '/capture/settings', 'Capture settings']]) {
     await page.goto(h.origin + path)
     await page.getByRole('heading', { name: heading, exact: true }).waitFor()
     if (name === 'candidate') await page.getByText('Known BCC', { exact: true }).waitFor()
     if (name === 'queue') await page.getByText('Forward unknown', { exact: true }).waitFor()
     assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
     // Assert the actual address fits before masking its capability in saved screenshots.
     if (name === 'settings') await page.locator('code').evaluateAll(nodes => nodes.forEach(node => { node.textContent = 'Private capture address' }))
     await page.screenshot({ path: evidence + '/capture-' + name + '-' + width + '.png', fullPage: true })
    }
    if (width === browserWidths.at(-1)) {
     await page.goto(h.origin + '/capture')
     await page.getByLabel('File Forward unknown on candidate').selectOption(known.id)
     await page.getByRole('button', { name: 'File captured email', exact: true }).click()
     await page.waitForURL(h.origin + '/capture/candidate/' + known.id)
     await page.getByRole('heading', { name: 'Forward unknown', exact: true }).waitFor()
    }
    assert.deepEqual(errors, [])
   } finally { await context.close() }
  }
 }
 if (!browser) {
 const resolveForm = new FormData(); resolveForm.set('candidate', known.id)
 const resolved = await send('/capture/' + q.id + '/resolve', resolveForm, manager)
 assert.equal(resolved.status, 303)
 assert.equal(resolved.headers.get('location'), '/capture/candidate/' + known.id)
 }

 assert.equal((await send('/api/lodge/capture', undefined, manager)).value.length, 0)
 assert.equal((await send('/api/lodge/capture?candidate=' + known.id, undefined, manager)).value.length, 2)
 assert.equal(await mailCount(), before, 'capture never sends email')
 assert.equal((await deliver('synthetic-lodge-future@example.test', 'Future candidate')).status, 200)
 const futureQueue = (await send('/api/lodge/capture', undefined, manager)).value[0]
 const future = (await cmd('candidate', { name: 'Synthetic Lodge Future', email: 'synthetic-lodge-future@example.test', source: 'Referral', consentBasis: 'referral' })).candidate
 assert.equal((await send('/api/lodge/capture/' + futureQueue.id, undefined, manager)).status, 404, 'a formerly unknown address now has current candidate scope')
 assert.equal((await send('/api/lodge/capture/' + futureQueue.id + '/file/' + futureQueue.attachments[0].id, undefined, manager)).status, 404)
 assert.equal((await send('/api/lodge/delete-candidate', { candidate: future.id, confirm: future.name, reason: 'Requested erasure' }, owner)).status, 200)
 assert.equal((await deliver('unknown@example.test', 'Queued erasure', { body: 'Forwarded about ' + known.email })).status, 200)
 const staged = (await send('/api/lodge/capture', undefined, manager)).value[0]
 // The installer validates original capture bytes before an archive can be restored.
 const rows = (await db.prepare('SELECT * FROM l_records').all()).results
 const { validateStaged } = await import('../scripts/installer/portability-policy.mjs')
 assert.equal(await validateStaged({ read: async table => table === 'l_records' ? rows : [] }), true)

 // Changing the live team grant immediately closes every capture read and delivery door.
 await cmd('member', { email: 'capture-member@example.test', name: 'Capture member', roles: ['interviewer'] })
 for (const path of ['/capture', '/capture/settings', '/capture/candidate/' + known.id, '/api/lodge/capture', '/api/lodge/capture?candidate=' + known.id, '/api/lodge/capture/' + m.id, filePath]) assert.equal((await send(path, undefined, manager)).status, 404)
 assert.equal((await deliver(known.email, 'Revoked')).status, 400)
 assert.equal((await send('/api/lodge/capture/address', {}, manager)).status, 404)
 // Erasure removes filed original bytes, suppresses later addressed and forwarded mail, and retains no address in the tombstone.
 await cmd('move', { application: added.application.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Requested withdrawal' })
 await send('/api/lodge/delete-candidate', { candidate: known.id, confirm: known.name, reason: 'Requested erasure' }, owner).then(r => assert.equal(r.status, 200, JSON.stringify(r.value)))
 for (const id of [f.id, staged.attachments[0].id]) assert.equal((await db.prepare("SELECT count(*) AS n FROM l_records WHERE kind='blob' AND id=?").bind(id).first()).n, 0)
 const ownerAddress = (await send('/api/lodge/capture/address', {}, owner)).value.address
 assert.equal((await deliver(known.email, 'Erased', { capture: ownerAddress, from: 'owner@example.test' })).status, 200)
 assert.equal((await deliver('unknown@example.test', 'Erased forward', { capture: ownerAddress, from: 'owner@example.test', body: 'Forwarded about ' + known.email })).status, 200)
 assert.equal((await send('/api/lodge/capture', undefined, owner)).value.length, 0)
 assert.equal((await db.prepare("SELECT count(*) AS n FROM l_records WHERE kind='capture-mail'").first()).n, 0)
 const newAddress = (await send('/api/lodge/capture/address', {}, owner)).value.address
 assert.notEqual(newAddress, ownerAddress)
 assert.equal((await deliver('unknown@example.test', 'Old capability', { capture: ownerAddress, from: 'owner@example.test' })).status, 400)
 assert.equal((await deliver('unknown@example.test', 'Wrong sender', { capture: newAddress })).status, 400)
}
