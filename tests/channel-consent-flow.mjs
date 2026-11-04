import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { careersJob } from './careers-driver.mjs'
import { address, candidateSession, form } from './take-home-flow.mjs'

export const notice = (application, channel = 'sms', version = 0) => ({ application, channel, version, language: 'en', purpose: 'Interview coordination', text: 'Optional interview updates on this channel. You can refuse or withdraw at any time.', reviewed: true })
export async function seedChannelConsent(h, suffix = 310) {
  const job = await careersJob(h.command, 'Synthetic channel role ' + suffix)
  const email = address(suffix)
  const result = await h.send('/jobs/' + job.slug, form({ name: 'Synthetic channel candidate ' + suffix, email, phone: '+15550102030', noticeVersion: '1', consent: 'yes', talentPool: 'yes' }))
  assert.equal(result.status, 200, result.text)
  const receipt = (await h.state()).receipts.find(r => r.id === result.text.match(/LDG-[A-F0-9]{8}/)[0])
  const app = (await h.state()).applications.find(a => a.id === receipt.application)
  const person = (await h.state()).candidates.find(c => c.id === app.candidate)
  const cookie = await candidateSession(h, email), base = '/candidate/receipts/' + receipt.id + '/channels'
  return { job, email, person, app, receipt, cookie, base }
}
export const choice = (extra = {}) => ({ channel: 'sms', decision: 'consent', revision: 0, request: 'synthetic-lodge-choice-1', noticeVersion: 1, numberVersion: 1, zone: 'America/New_York', start: '09:00', end: '17:00', ...extra })
export async function prepareChannels(h, f) {
  for (const channel of ['sms', 'whatsapp']) await h.command('channel-notice', notice(f.app.id, channel))
  assert.equal((await h.send(f.base + '/number', { version: 0, number: '+15550102030' }, f.cookie)).status, 303)
}

/** Native account, Worker and D1 sanity journey across channel choices, authority and erasure. */
export async function checkChannelConsent() {
  let outbound = 0
  const h = await businessHarness({ clock: '2027-03-14T12:00:00.000Z', outboundService: () => { outbound++; return new Response('Unexpected outbound', { status: 503 }) } })
  try {
    const f = await seedChannelConsent(h), { app, person, cookie, base } = f
    const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
    const noWrite = async (path, body, who, status) => { const before = await snapshot(), r = await h.send(path, body, who); assert.equal(r.status, status, r.text); assert.deepEqual(await snapshot(), before); return r }
    const view = async () => (await h.state()).channelConsent
    const status = async channel => (await view()).choices.find(c => c.application === app.id && c.channel === channel)
    const submit = (body, who = cookie) => h.send(base + '/choice', body, who)
    const beforeApp = (await h.state()).applications.find(a => a.id === app.id)
    assert.match((await h.send(base, undefined, cookie)).text, /No employer-reviewed notice/)
    assert.equal((await view()).choices.length, 0, 'staff phone and pool consent never create channel permission')
    await noWrite(base + '/choice', choice(), cookie, 409)
    await noWrite('/api/lodge/command/channel-notice', notice(app.id, 'sms', 0), cookie, 403)
    await noWrite('/api/lodge/command/channel-notice', { ...notice(app.id), reviewed: false }, h.owner, 400)
    await noWrite('/api/lodge/command/channel-notice', { ...notice(app.id), language: 'fr' }, h.owner, 409)
    await prepareChannels(h, f)
    const page = (await h.send(base, undefined, cookie)).text
    assert.doesNotMatch(page, /type="radio"[^>]*checked/, 'choices start unselected')
    assert.match(page, /Ownership unverified/)
    await noWrite(base + '/choice', choice({ decision: '' }), cookie, 400)
    await noWrite(base + '/choice', choice({ zone: 'not-a-zone' }), cookie, 400)
    await noWrite(base + '/choice', choice({ start: '17:00', end: '09:00' }), cookie, 400)
    const pair = await Promise.all([submit(choice()), submit(choice())])
    assert.ok(pair.every(r => [303, 409].includes(r.status)), pair.map(r => r.text).join('\n'))
    assert.ok(pair.some(r => r.status === 303))
    assert.equal((await status('sms')).history.length, 1)
    assert.equal((await status('sms')).currentPermission, true)
    assert.equal((await status('sms')).messagingAuthorized, false)
    await noWrite(base + '/choice', choice(), cookie, 303)
    await h.restart()
    await noWrite(base + '/choice', choice(), cookie, 303)
    await noWrite(base + '/choice', choice({ decision: 'refuse' }), cookie, 409)
    assert.equal((await submit(choice({ channel: 'whatsapp', request: 'synthetic-lodge-wa-1', decision: 'refuse' }))).status, 303)
    assert.equal((await status('whatsapp')).currentPermission, false)
    assert.equal((await status('sms')).currentPermission, true)
    assert.equal((await submit(choice({ channel: 'whatsapp', revision: 1, request: 'synthetic-lodge-wa-2' }))).status, 303)
    assert.equal((await status('whatsapp')).currentPermission, true)
    assert.equal((await submit(choice({ decision: 'withdraw', revision: 1, request: 'synthetic-lodge-withdraw-1' }))).status, 303)
    assert.equal((await status('sms')).currentPermission, false)
    assert.equal((await status('whatsapp')).currentPermission, true, 'channel withdrawal is independent')
    const originalHistory = structuredClone((await status('sms')).history)
    // Wording changes invalidate only its channel and refuse stale pages.
    await h.command('channel-notice', { ...notice(app.id, 'whatsapp', 1), text: 'Revised optional coordination notice.' })
    assert.equal((await status('whatsapp')).currentPermission, false)
    await noWrite(base + '/choice', choice({ channel: 'whatsapp', revision: 2, request: 'synthetic-lodge-stale-wording' }), cookie, 409)
    assert.equal((await submit(choice({ channel: 'whatsapp', revision: 2, noticeVersion: 2, request: 'synthetic-lodge-wa-3' }))).status, 303)
    // A changed candidate-entered number requires fresh explicit choices, even when changed back.
    assert.equal((await h.send(base + '/number', { version: 1, number: '+15550102031' }, cookie)).status, 303)
    assert.equal((await status('whatsapp')).currentPermission, false)
    await noWrite(base + '/choice', choice({ revision: 2, request: 'synthetic-lodge-stale-number' }), cookie, 409)
    assert.equal((await h.send(base + '/number', { version: 2, number: '+15550102030' }, cookie)).status, 303)
    assert.equal((await status('whatsapp')).currentPermission, false)
    assert.equal((await submit(choice({ revision: 2, numberVersion: 3, request: 'synthetic-lodge-sms-2' }))).status, 303)
    assert.deepEqual((await status('sms')).history.slice(0, 2), originalHistory)
    // Global no-contact wins over channel permission; it cannot be changed by this form.
    const prefs = '/candidate/receipts/' + f.receipt.id + '/account/preferences'
    assert.equal((await h.send(prefs, form({ preference: 'none' }), cookie)).status, 303)
    assert.equal((await status('sms')).currentPermission, false)
    await noWrite(base + '/choice', choice({ revision: 3, numberVersion: 3, request: 'synthetic-lodge-no-contact' }), cookie, 409)
    assert.equal((await h.send(prefs, form({ preference: 'phone', talentPool: 'yes' }), cookie)).status, 303)
    const other = await seedChannelConsent(h, 311)
    await noWrite(base, undefined, other.cookie, 404)
    await noWrite(base + '/choice', choice({ decision: 'withdraw', revision: 3, request: 'synthetic-lodge-wrong-person' }), other.cookie, 404)
    const reviewerAddress = address(312), reviewer = await h.member(reviewerAddress, ['manager'], 'Synthetic channel reviewer')
    await h.command('hiring-team', { id: app.vacancy, recruiters: [reviewerAddress] })
    // The native team door grants existing contact and settings rights; no extra role is introduced.
    assert.ok((await h.state(reviewer)).channelConsent.choices.some(c => c.application === app.id))
    const staffPath = '/candidate/employer/' + app.id + '/channels'
    assert.equal((await h.send(staffPath, undefined, reviewer)).status, 200)
    const limited = await h.command('permission-level', { name: 'Synthetic no-contact level', permissions: ['export'] })
    await h.command('job-levels', { id: app.vacancy, members: { [reviewerAddress]: limited.id } })
    assert.equal((await h.state(reviewer)).channelConsent.choices.length, 0)
    await noWrite(staffPath, undefined, reviewer, 404)
    const vacancyExport = await h.send('/api/lodge/download/vacancy/' + app.vacancy, undefined, reviewer)
    assert.equal(vacancyExport.value.channelConsent.choices.length, 0)
    await h.command('job-levels', { id: app.vacancy, members: {} })
    await h.command('member', { email: reviewerAddress, name: 'Synthetic channel reviewer', roles: ['manager'], active: false })
    await noWrite(staffPath, undefined, reviewer, 403)
    const signedOut = await h.send('/candidate/signout', {}, cookie)
    assert.equal(signedOut.status, 303)
    await noWrite(base + '/choice', choice({ revision: 3, decision: 'withdraw', request: 'synthetic-lodge-revoked' }), cookie, 401)
    const renewed = await h.signIn(person.email)
    const exported = await h.send('/api/lodge/download/candidate/' + person.id, undefined, h.owner)
    assert.equal(exported.value['channel-consent'].find(c => c.channel === 'sms').history.length, 3)
    assert.equal(exported.value['channel-number'][0].versions.length, 3)
    assert.equal(exported.text.includes(cookie), false)
    assert.deepEqual((await h.state()).applications.find(a => a.id === app.id).history, beforeApp.history)
    // Merge preserves earlier identity history but never adopts its active permission.
    const survivor = (await h.command('candidate', { name: person.name, email: person.email, source: 'Direct', consentBasis: 'manual' })).candidate
    await h.command('review-duplicate', { keep: survivor.id, other: person.id, decision: 'merge', reason: 'Synthetic same person' })
    assert.equal((await status('sms')).currentPermission, false)
    const mergedExport = await h.send('/api/lodge/download/candidate/' + survivor.id, undefined, h.owner)
    assert.equal(mergedExport.value['channel-number'][0].candidate, person.id)
    assert.equal(mergedExport.value['channel-consent'].length, 2)
    const activeHold = await h.command('hold', { candidate: survivor.id, reason: 'Synthetic lineage hold' })
    assert.equal((await h.send('/candidate/receipts/' + f.receipt.id + '/account/withdraw', form({ confirm: 'yes' }), renewed)).status, 303)
    assert.equal((await status('sms')).currentPermission, false)
    await noWrite('/api/lodge/delete-candidate', { candidate: survivor.id, confirm: survivor.name, reason: 'Synthetic erasure' }, h.owner, 409)
    await h.command('release-hold', { id: activeHold.id, reason: 'Synthetic hold released' })
    assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: survivor.id, confirm: survivor.name, reason: 'Synthetic erasure' }, h.owner)).status, 200)
    const remaining = await snapshot()
    assert.equal(remaining.some(r => ['channel-consent', 'channel-notice'].includes(r.kind) && JSON.parse(r.value).application === app.id), false)
    assert.equal(remaining.some(r => r.kind === 'channel-number' && r.id === person.id), false)
    await noWrite(base, undefined, renewed, 404)
    assert.equal(outbound, 0, 'local permission supplies no SMS or WhatsApp provider calls')
  } finally { await h.close() }
}
