import assert from 'node:assert/strict'
import { BUSINESS, harness } from './harness.mjs'
import { careersJob } from './careers-driver.mjs'

// CRM-010: only the mail provider's network edge is faked (the harness outbox); everything else is the real Worker and D1.
const mails = async (h, to) => (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence').all()).results.map(r => JSON.parse(r.message)).filter(m => m.to.includes(to))
const emails = async h => (await h.db.prepare("SELECT id, value FROM l_records WHERE kind='referral-email'").all()).results.map(r => ({ id: r.id, ...JSON.parse(r.value) }))
const resume = { name: 'referral-original.txt', mediaType: 'text/plain', base64: Buffer.from('Referral resume for the email flow').toString('base64') }

export async function checkReferralEmail() {
  const h = await harness()
  try {
    await h.command('business', BUSINESS)
    const people = {}
    for (const name of ['one', 'two', 'three', 'four']) people[name] = await h.member(`email-${name}@example.test`, ['employee'], 'Employee ' + name)
    const { origin } = h
    // What the provider's edge sees: at the moment each referral email reaches it, a claim ('sending') is already saved.
    await h.db.prepare('CREATE TABLE claim_seen(claims INTEGER)').run()
    await h.db.prepare("CREATE TRIGGER claim_at_send AFTER INSERT ON rer_mail_development_outbox WHEN NEW.message LIKE '%turn off job alerts%' BEGIN INSERT INTO claim_seen SELECT COUNT(*) FROM l_records WHERE kind='referral-email' AND json_extract(value,'$.emailState')='sending'; END").run()
    assert.equal((await h.state(people.one)).referrals.emailAvailable, true, 'with installation mail the portal offers email updates')
    const first = await careersJob(h.command, 'Email crew supervisor')
    for (const name of ['one', 'three', 'four']) await h.command('referral-alerts', { enabled: true }, people[name])
    for (const name of ['one', 'three', 'four']) assert.equal((await mails(h, `email-${name}@example.test`)).filter(m => /Email crew supervisor/.test(m.subject)).length, 0, 'jobs already open when alerts are turned on are listed in the portal, not mailed')
    assert.ok((await h.state(people.one)).referrals.alerts.some(a => a.vacancy === first.id))

    // A newly eligible job: one email to each opted-in employee, with the title, the portal link and how to stop, and nothing else.
    const second = await careersJob(h.command, 'Email yard lead')
    const jobMail = async name => (await mails(h, `email-${name}@example.test`)).filter(m => /Email yard lead/.test(m.subject))
    for (const name of ['one', 'three', 'four']) assert.equal((await jobMail(name)).length, 1, name + ' gets one email for the newly eligible job')
    assert.equal((await mails(h, 'email-two@example.test')).filter(m => /referral/i.test(m.subject + m.text)).length, 0, 'no email without opting in')
    const [alert] = await jobMail('one')
    assert.ok(alert.text.includes('Email yard lead') && alert.text.includes(origin + '/app') && /turn off job alerts/.test(alert.text), 'title, portal link and how to stop')
    assert.ok(!/salary|description|Coordinate safe/.test(alert.text), 'the email says only what the portal shows')

    // A retried delivery sends nothing more, including one already claimed ('sending').
    const rows = await emails(h)
    await h.command('referral-alerts', { enabled: true }, people.one)
    assert.equal((await jobMail('one')).length, 1, 'a repeated write sends nothing more')
    const claimed = rows.find(r => r.to === 'email-one@example.test' && r.vacancy === second.id)
    const set = (id, state) => h.db.prepare("UPDATE l_records SET value=json_set(value,'$.emailState',?) WHERE kind='referral-email' AND id=?").bind(state, id).run()
    await set(claimed.id, 'sending')
    await h.command('referral-alerts', { enabled: true }, people.two)
    assert.equal((await jobMail('one')).length, 1, 'an email already claimed is never sent again')
    await set(claimed.id, 'handed')
    await h.command('referral-alerts', { enabled: false }, people.two)

    // Shared progress: staff share Closed on a declined referral and the employee gets the coarse status only.
    const input = { vacancy: first.id, name: 'Dana Lee', email: 'dana-lee@example.test', consentNote: 'Dana agreed to this role and sharing this resume by phone.', confirmed: true, resume }
    const declined = await h.command('referral-submit', input, people.one)
    await h.command('referral-review', { id: declined.id, outcome: 'declined', reason: 'Not a fit for this role' })
    const before = (await mails(h, 'email-one@example.test')).length
    await h.command('referral-progress', { id: declined.id, progress: 'closed' })
    const after = await mails(h, 'email-one@example.test')
    assert.equal(after.length, before + 1, 'one email when staff share progress')
    const update = after.at(-1)
    assert.match(update.subject, /Closed/); assert.ok(update.text.includes('Closed') && update.text.includes(origin + '/app'))
    assert.ok(!/Not a fit|declined|Dana|decision|feedback|scorecard/i.test(update.text), 'never a decision, reason, feedback or another person')
    await h.command('referral-alerts', { enabled: true }, people.two)
    assert.equal((await mails(h, 'email-one@example.test')).length, before + 1, 'a later write sends nothing more')

    const seen = (await h.db.prepare('SELECT claims FROM claim_seen').all()).results
    assert.ok(seen.length === 4 && seen.every(x => x.claims === 1), 'every email was claimed before it reached the provider')

    // Live checks at send time: each email put back in the queue is withheld once its condition has changed.
    const requeue = async (name, match) => { const r = (await emails(h)).filter(x => x.to === `email-${name}@example.test` && match(x)); assert.ok(r.length, name); for (const x of r) await set(x.id, 'queued') }
    const trigger = () => h.command('referral-alerts', { enabled: false }, people.two)
    const counts = async () => Object.fromEntries(await Promise.all(['one', 'three', 'four'].map(async n => [n, (await mails(h, `email-${n}@example.test`)).length])))
    const settled = await counts()
    await h.command('referral-alerts', { enabled: false }, people.one)
    await requeue('one', () => true)
    await h.command('member', { email: 'email-three@example.test', name: 'Employee three', roles: ['employee'], active: false })
    await requeue('three', () => true)
    await h.command('vacancy-privacy', { id: second.id, confidential: true, namedPeople: [] })
    await requeue('four', x => x.vacancy === second.id)
    await trigger()
    assert.deepEqual(await counts(), settled, 'an opted-out employee, a revoked employee and a job made confidential produce no email')
    const states = await emails(h)
    for (const [name, match] of [['one', () => true], ['three', () => true], ['four', x => x.vacancy === second.id]]) assert.ok(states.filter(x => x.to === `email-${name}@example.test` && match(x)).every(x => x.emailState === 'withheld'), name + ' withheld')
    // A referral that is no longer theirs is not mailed either.
    await h.command('referral-alerts', { enabled: true }, people.one)
    const shared = states.find(x => x.kind === 'progress')
    await h.db.prepare("DELETE FROM l_records WHERE kind='referral' AND id=?").bind(shared.referral).run()
    await set(shared.id, 'queued'); await trigger()
    assert.equal((await mails(h, 'email-one@example.test')).length, settled.one, 'no email about a referral that is gone')
  } finally { await h.close() }

  // With no installation mail the portal says so and nothing claims delivery.
  const bare = await harness({ bindings: { MAIL_PROVIDER: '', MAIL_FROM: '' } })
  try {
    await bare.command('business', BUSINESS)
    await bare.command('referral-alerts', { enabled: true })
    assert.equal((await bare.state()).referrals.emailAvailable, false, 'the portal shows email updates as unavailable')
    await careersJob(bare.command, 'Email unmailed role')
    assert.deepEqual((await emails(bare)).map(x => x.emailState), ['not-sent'], 'no delivery is claimed without mail')
    assert.equal((await bare.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, 0)
  } finally { await bare.close() }
}
