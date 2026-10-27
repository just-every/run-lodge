import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { languageJob, spanishText } from './languages-driver.mjs'

export const form = fields => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f }
export async function applicationEmailFixture(options = {}) {
  const edge = { verified: true, checks: 0 }
  const h = await businessHarness({ ...options, bindings: { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'synthetic-lodge-2', ...options.bindings }, outboundService: options.outboundService ?? (options.liveMail ? undefined : async request => {
    const url = new URL(request.url)
    assert.equal(request.method, 'GET'); assert.equal(url.origin, 'https://api.sendgrid.com')
    assert.ok(url.pathname.startsWith('/v3/whitelabel/domains'))
    edge.checks++
    if (edge.beforeCheck) await edge.beforeCheck(request)
    const domain = { id: 7, domain: 'example.test', valid: edge.verified }
    return Response.json(url.pathname.endsWith('/7') ? domain : [domain])
  }) })
  try {
  const cmd = h.command
  const approve = async request => { const version = (await h.state()).approvals.find(x => x.id === request.id).currentVersion; await cmd('decide-approval', { id: request.id, version, decision: 'approved', reason: 'Budgeted' }) }
  const { job, q, en, es } = await languageJob(cmd, approve, 'owner@example.test')
  await cmd('post-translation', { vacancy: job.id, post: es.id, translation: spanishText(q) })
  await cmd('post-status', { vacancy: job.id, post: es.id, status: 'live' })
  const activate = async (extra = {}, cookie = h.owner, status = 303) => {
    const result = await h.send('/application-emails/settings', form({ action: 'transport', replyTo: 'recruiting@example.test', footer: 'Example Builders, 10 Main Street, New York. Reply to recruiting@example.test to opt out.', monitored: 'yes', legalReviewed: 'yes', ...extra }), cookie)
    assert.equal(result.status, status, /role="alert">(.*?)<\/p>/.exec(result.text)?.[1] ?? "Sender approval HTTP status")
    return result
  }
  if (options.activate !== false) await activate(options.sender ?? {})
  const policy = (enabled, stages = []) => cmd('application-email-policy', { vacancy: job.id, acknowledgment: enabled, stages })
  const review = async (language = 'en', extra = {}) => cmd('application-email-template', { vacancy: job.id, kind: 'acknowledgment', language, subject: language === 'es' ? 'Solicitud recibida: {{jobTitle}}' : 'Application received: {{jobTitle}}', body: language === 'es' ? 'Gracias {{candidateName}}. Su código es {{receiptCode}}.' : 'Thank you {{candidateName}}. Your receipt is {{receiptCode}}.', footer: language === 'es' ? 'Example Builders, 10 Main Street, Nueva York. Responda a recruiting@example.test para no recibir más correos.' : undefined, reviewed: true, timing: (await h.state()).vacancies.find(v => v.id === job.id).applicationEmailTiming, ...extra })
  const prepareSubmission = async (post = en, extra = {}) => {
    const path = '/jobs/' + post.slug, shown = await h.send(path)
    const submissionKey = /name="submissionKey" value="([^"]+)"/.exec(shown.text)[1]
    const values = { name: 'Jordan Rivera', email: 'jordan@example.test', noticeVersion: '1', consent: 'yes', ['q-' + q.id]: 'Weekdays', submissionKey, ...extra }
    return { path, values }
  }
  const submit = async (post = en, extra = {}) => {
    const { path, values } = await prepareSubmission(post, extra)
    const result = await h.send(path, form(values))
    assert.equal(result.status, 200, result.text)
    const code = /LDG-[0-9A-F]{8}/.exec(result.text)[0]
    return { ...result, code, values, path, application: (await h.state()).receipts.find(r => r.id === code).application }
  }
  const mails = async () => (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence').all()).results.map(r => JSON.parse(r.message))
  return Object.assign(h, { job, en, es, q, policy, review, submit, prepareSubmission, mails, activate, edge })
  } catch (error) { await h.close(); throw error }
}

export async function checkApplicationEmailReceipt(t) {
  const h = await applicationEmailFixture(); t.after(() => h.close())
  await h.review(); await h.policy(true)
  const received = await h.submit()
  assert.equal((await h.mails()).length, 1)
  assert.ok((await h.mails())[0].text.includes(received.code))
  let outcome = (await h.state()).applicationEmails.find(m => m.application === received.application)
  assert.equal(outcome.status, 'handed'); assert.ok(outcome.providerMessageId)
  await h.restart()
  const replay = await h.send(received.path, form(received.values))
  assert.equal(replay.status, 200); assert.ok(replay.text.includes(received.code)); assert.equal((await h.mails()).length, 1)
  assert.equal((await h.state()).applications.length, 1)
  assert.equal((await h.send(received.path, form({ ...received.values, name: 'Changed replay' }))).status, 409)
  await h.policy(false)
  const disabled = await h.submit(h.en, { name: 'Taylor Reed', email: 'taylor@example.test' })
  assert.ok(disabled.code); assert.equal((await h.mails()).length, 1)
  assert.equal((await h.state()).applicationEmails.filter(m => m.application === disabled.application).length, 0)
  await h.command('move', { application: received.application, to: 'withdrawn', closeReason: 'other-offer', reason: 'Requested' })
  const snapshot = await h.state(), person = snapshot.candidates.find(c => c.id === snapshot.applications.find(a => a.id === received.application).candidate)
  assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: person.id, confirm: person.name, reason: 'Requested' }, h.owner)).status, 200)
  assert.equal((await h.state()).applicationEmails.length, 0)
}

export async function checkApplicationEmailLanguage(t) {
  const h = await applicationEmailFixture(); t.after(() => h.close())
  const manager = await h.member('mail-manager@example.test', ['manager'])
  const admin = await h.member('mail-reviewer@example.test', ['admin'])
  const agent = await h.member('mail-agent@example.test', ['admin'], 'Mail agent', { agent: true, actsFor: 'owner@example.test' })
  await h.command('application-email-policy', { vacancy: h.job.id, acknowledgment: true, stages: [] }, agent, 403)
  await h.command('application-email-policy', { vacancy: h.job.id, acknowledgment: true, stages: [] }, manager, 403)
  await h.command('application-email-template', { vacancy: h.job.id, kind: 'acknowledgment', language: 'es', subject: 'Gracias', body: '{{receiptCode}}', reviewed: false }, h.owner, 400)
  await h.review('en'); await h.policy(true)
  const missing = await h.submit(h.es)
  assert.equal((await h.state()).applicationEmails.find(m => m.application === missing.application).status, 'withheld')
  const before = (await h.mails()).length
  await h.command('application-email-template', { vacancy: h.job.id, kind: 'acknowledgment', language: 'es', subject: 'Solicitud recibida: {{jobTitle}}', body: 'Gracias {{candidateName}}. Su código es {{receiptCode}}.', footer: 'Example Builders, 10 Main Street, Nueva York. Responda a recruiting@example.test para no recibir más correos.', reviewed: true }, admin)
  const spanish = await h.submit(h.es, { name: 'Lucía Torres', email: 'lucia@example.test' })
  const email = (await h.mails()).at(-1)
  assert.match(email.subject, /Solicitud recibida/); assert.match(email.text, /Gracias Lucía/); assert.ok(email.text.includes(spanish.code))
  assert.equal((await h.mails()).length, before + 1)
  assert.equal((await h.send('/application-emails/application/' + spanish.application, undefined, manager)).status, 403)
  const exportResult = await h.send('/api/lodge/download/candidate/' + (await h.state()).applications.find(a => a.id === spanish.application).candidate, undefined, h.owner)
  assert.equal(exportResult.status, 200)
  assert.ok(exportResult.text.includes('providerMessageId'))
  await h.command('member', { email: 'mail-reviewer@example.test', name: 'mail-reviewer', roles: ['admin'], active: false })
  const revoked = await h.submit(h.es, { name: 'María Vega', email: 'maria@example.test' })
  assert.equal((await h.state()).applicationEmails.find(mail => mail.application === revoked.application).status, 'withheld')
  assert.equal((await h.mails()).length, before + 1)
}

export async function checkApplicationEmailStages(t) {
  const { generateKeyPairSync, sign } = await import('node:crypto')
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const clock = '2026-10-26T12:00:00.000Z', stamp = String(Date.parse(clock) / 1000)
  const h = await applicationEmailFixture({ clock, bindings: { APPLICATION_EMAIL_SENDGRID_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }); t.after(() => h.close())
  const received = await h.submit(), stage = h.job.stages[1].id
  await h.review('en', { kind: 'status', stage, subject: 'Your application update', body: 'Thank you {{candidateName}}. We are reviewing your application.' })
  await h.policy(false, [stage])
  await h.command('move', { application: received.application, to: stage, reason: 'Interview evidence reviewed' })
  assert.equal((await h.mails()).length, 1)
  assert.ok(!(await h.mails())[0].text.includes('Interview evidence'))
  const outcome = (await h.state()).applicationEmails[0]
  assert.equal(outcome.kind, 'status'); assert.equal(outcome.templateVersion, 1); assert.equal(outcome.status, 'handed')
  const events = [{ event: 'delivered', sg_event_id: 'synthetic-lodge-delivered', sg_message_id: outcome.providerMessageId + '.filter.example', timestamp: Number(stamp), email: 'synthetic-lodge-private@example.test', reason: 'synthetic-lodge-provider-private-copy' }]
  const headers = { 'x-twilio-email-event-webhook-timestamp': stamp, 'x-twilio-email-event-webhook-signature': sign('sha256', Buffer.from(stamp + JSON.stringify(events)), privateKey).toString('base64') }
  const callback = () => h.send('/api/lodge/application-emails/events', events, '', headers)
  assert.equal((await h.send('/api/lodge/application-emails/events', events, '', { ...headers, 'x-twilio-email-event-webhook-signature': 'invalid' })).status, 403)
  assert.equal((await callback()).status, 200)
  assert.equal((await h.state()).applicationEmails.find(m => m.id === outcome.id).status, 'delivered')
  const auditCount = (await h.state()).audit.length
  assert.equal((await callback()).status, 200); assert.equal((await h.state()).audit.length, auditCount)
  assert.ok(!JSON.stringify(await h.state()).includes('synthetic-lodge-provider-private-copy'))
  await h.command('move', { application: received.application, to: stage, reason: 'Replay' }, h.owner, 409)
  assert.equal((await h.mails()).length, 1)
  await h.command('move', { application: received.application, to: h.job.stages[2].id, reason: 'Next review' })
  assert.equal((await h.mails()).length, 1)
  // Provider rejection is a recorded terminal outcome, with no blind resend.
  await h.db.exec("CREATE TRIGGER fail_application_mail BEFORE INSERT ON rer_mail_development_outbox BEGIN SELECT RAISE(ABORT, 'synthetic-lodge-provider-refusal'); END;")
  await h.command('move', { application: received.application, to: stage, reason: 'Another review' })
  const failed = (await h.state()).applicationEmails.find(m => m.status === 'uncertain')
  assert.ok(failed); assert.equal(failed.reason, 'transport_uncertain')
  await h.db.exec('DROP TRIGGER fail_application_mail')
  await h.restart()
  await h.mf.getWorker().then(worker => worker.scheduled({ scheduledTime: Date.parse(clock), cron: '0 * * * *' }))
  await h.command('application-email-policy', { vacancy: h.job.id, acknowledgment: false, stages: [stage] })
  assert.equal((await h.mails()).length, 1)
  await h.command('move', { application: received.application, to: h.job.stages[2].id, reason: 'New round' })
  await h.command('move', { application: received.application, to: stage, reason: 'Reviewed update' })
  const second = (await h.state()).applicationEmails.find(m => m.status === 'handed')
  const bounce = [{ event: 'bounce', sg_event_id: 'synthetic-lodge-bounced', sg_message_id: second.providerMessageId, timestamp: Number(stamp), reason: 'synthetic-lodge-provider-private-copy' }]
  const bounceHeaders = { 'x-twilio-email-event-webhook-timestamp': stamp, 'x-twilio-email-event-webhook-signature': sign('sha256', Buffer.from(stamp + JSON.stringify(bounce)), privateKey).toString('base64') }
  assert.equal((await h.send('/api/lodge/application-emails/events', bounce, '', bounceHeaders)).status, 200)
  assert.equal((await h.state()).applicationEmails.find(m => m.id === second.id).status, 'bounced')
  assert.ok(!JSON.stringify(await h.state()).includes('synthetic-lodge-provider-private-copy'))
  await h.command('move', { application: received.application, to: h.job.stages[2].id, reason: 'New round' })
  await h.command('move', { application: received.application, to: stage, reason: 'Reviewed again' })
  assert.equal((await h.mails()).length, 2, 'a bounced recipient cannot receive another stage email')
  assert.ok((await h.state()).applicationEmails.some(mail => mail.status === 'suppressed'))

  const next = await h.submit(h.en, { name: 'Alex Chen', email: 'alex@example.test' })
  let release, entered, blocked = false
  const paused = new Promise(resolve => { entered = resolve }), resume = new Promise(resolve => { release = resolve })
  h.edge.beforeCheck = async request => { if (!blocked && new URL(request.url).pathname.endsWith('/7')) { blocked = true; entered(); await resume } }
  const changing = h.command('move', { application: next.application, to: stage, reason: 'Initial review' })
  await paused
  try { await h.command('move', { application: next.application, to: h.job.stages[2].id, reason: 'Review already finished' }) }
  finally { release() }
  await changing
  assert.equal((await h.state()).applicationEmails.find(mail => mail.application === next.application).status, 'canceled')
  assert.equal((await h.mails()).length, 2)
  const person = (await h.command('candidate', { name: 'Telephone applicant', source: 'Referred', consentBasis: 'manual' })).candidate
  const manual = await h.command('apply', { candidate: person.id, vacancy: h.job.id, source: 'Referred' })
  await h.command('move', { application: manual.id, to: stage, reason: 'Review by telephone' })
  const missing = (await h.state()).applicationEmails.find(mail => mail.application === manual.id)
  assert.equal(missing.status, 'withheld'); assert.match(missing.reason, /Missing message values: recipient/)
  assert.equal((await h.mails()).length, 2)
  await checkDelayedApplicationEmails(t)
}

async function checkDelayedApplicationEmails(t) {
  const { reviewStatusTiming } = await import('./operations-driver.mjs')
  // Independently specified UTC expectations cross both clock changes and a weekend.
  const cases = [
    ['2027-03-12T15:15:00.000Z', [1, 2, 3, 4, 5], '2027-03-15T14:15:00.000Z'],
    ['2027-03-13T07:30:00.000Z', [0, 1, 2, 3, 4, 5, 6], '2027-03-14T07:00:00.000Z'],
    ['2026-10-31T05:30:00.000Z', [0, 1, 2, 3, 4, 5, 6], '2026-11-01T05:30:00.000Z'],
  ]
  for (const [clock, weekdays, due] of cases) {
    const h = await applicationEmailFixture({ clock })
    const command = h.command, state = h.state
    h.command = (op, body, cookie = h.owner, status = 200) => command(op, body, cookie, status)
    h.state = (cookie = h.owner) => state(cookie)
    try {
      const mailCount = async () => (await h.mails()).filter(m => ['Reviewed delayed update', 'Revised status text'].includes(m.subject)).length
      const received = await h.submit(), stage = h.job.stages[1].id
      h.timingApplication = received.application
      const timing = { delayDays: 1, weekdays, timeZone: 'America/New_York' }
      await reviewStatusTiming(h, timing, clock, due)
      await h.command('application-email-template', { vacancy: h.job.id, kind: 'status', stage, language: 'en', subject: 'Stale timing', body: 'Status', reviewed: true }, h.owner, 409)
      await h.review('en', { kind: 'status', stage, subject: 'Reviewed delayed update', body: 'Thank you {{candidateName}}.' })
      await h.policy(false, [stage])
      await h.command('move', { application: received.application, to: stage, reason: 'Reviewed stage event' })
      const queued = (await h.state()).applicationEmails.find(m => m.application === received.application)
      assert.equal(queued.status, 'pending'); assert.equal(queued.eventAt, clock)
      assert.equal(queued.dueAt, due); assert.deepEqual(queued.timing, timing)
      assert.equal(await mailCount(), 0)
      const tick = async () => (await h.mf.getWorker()).scheduled({ scheduledTime: Date.parse(due), cron: '0 * * * *' })
      await h.setTime(new Date(Date.parse(due) - 1).toISOString()); await tick()
      assert.equal(await mailCount(), 0, 'an early scheduler cannot send')
      await h.restart(); await h.setTime(new Date(Date.parse(due) + 60000).toISOString())
      await Promise.all([tick(), tick()])
      assert.equal(await mailCount(), 1, 'concurrent late schedulers claim one message')
      let sent = (await h.state()).applicationEmails.find(m => m.id === queued.id)
      assert.equal(sent.status, 'handed'); assert.equal(sent.dueAt, due); assert.equal(sent.attempts, 1)
      await h.restart(); await h.setTime(new Date(Date.parse(due) + 120000).toISOString()); await tick()
      assert.equal(await mailCount(), 1, 'restart cannot duplicate a claimed event')
      if (weekdays.length !== 5) continue
      const nextStage = h.job.stages[2].id
      await h.command('move', { application: received.application, to: nextStage, reason: 'Next review' })
      await h.command('move', { application: received.application, to: stage, reason: 'New committed event' })
      const pending = (await h.state()).applicationEmails.find(m => m.status === 'pending')
      await h.command('move', { application: received.application, to: nextStage, reason: 'Cancel pending update' })
      assert.equal((await h.state()).applicationEmails.find(m => m.id === pending.id).status, 'canceled')
      await h.command('move', { application: received.application, to: stage, reason: 'Return is a distinct event' })
      const changed = (await h.state()).applicationEmails.find(m => m.status === 'pending')
      assert.notEqual(changed.id, pending.id)
      await h.review('en', { kind: 'status', stage, subject: 'Revised status text', body: 'Updated {{candidateName}}.' })
      const frozen = (await h.state()).applicationEmails.find(m => m.id === changed.id)
      assert.equal(frozen.content.subject, 'Reviewed delayed update'); assert.equal(frozen.dueAt, changed.dueAt)
      await h.setTime(changed.dueAt); await tick()
      assert.equal((await h.state()).applicationEmails.find(m => m.id === changed.id).status, 'withheld')
      assert.equal(await mailCount(), 1)
      await h.command('move', { application: received.application, to: nextStage, reason: 'Next configuration event' })
      await h.command('move', { application: received.application, to: stage, reason: 'Freeze the reviewed configuration' })
      const configurationMail = (await h.state()).applicationEmails.find(m => m.status === 'pending')
      await h.command('unpublish', { id: h.job.id, reason: 'Review a later timing version' })
      const box = await h.command('sandbox-create', { name: 'Changed timing trial', vacancy: h.job.id, mode: 'historical', samples: [{ application: received.application, eventAt: clock }] })
      await h.command('sandbox-edit', { id: box.id, edits: [{ op: 'application-email-timing', input: { timing: { ...timing, delayDays: 2 } } }] })
      const preview = await h.command('sandbox-preview', { id: box.id })
      await h.command('sandbox-deploy', { id: box.id, token: preview.token, confirmProduction: true })
      assert.equal((await h.state()).applicationEmails.find(m => m.id === configurationMail.id).dueAt, configurationMail.dueAt)
      await h.setTime(configurationMail.dueAt); await tick()
      assert.equal((await h.state()).applicationEmails.find(m => m.id === configurationMail.id).status, 'withheld')
      assert.equal(await mailCount(), 1)
      await h.command('sandbox-rollback', { id: box.id }); await h.command('publish', { id: h.job.id })
      await h.send('/auth/invite', { email: 'jordan@example.test', displayName: 'Candidate', role: 'member', returnTo: '/candidate' }, h.owner)
      let candidateCookie = await h.signIn('jordan@example.test')
      const admin = await h.member('delayed-reviewer@example.test', ['admin'])
      await h.command('application-email-template', { vacancy: h.job.id, kind: 'status', stage, language: 'en', subject: 'Revised status text', body: 'Updated {{candidateName}}.', reviewed: true, timing }, admin)
      for (const refusal of ['contact', 'authority', 'timing-authority', 'closure']) {
        await h.command('move', { application: received.application, to: nextStage, reason: 'Next event' })
        await h.command('move', { application: received.application, to: stage, reason: 'Review again' })
        const mail = (await h.state()).applicationEmails.find(m => m.status === 'pending')
        assert.ok(mail)
        const snapshot = await h.state(), app = snapshot.applications.find(a => a.id === received.application)
        if (refusal === 'contact') { candidateCookie = await h.signIn('jordan@example.test'); assert.equal((await h.send('/candidate/receipts/' + received.code + '/account/preferences', form({ preference: 'none' }), candidateCookie)).status, 303) }
        if (refusal === 'authority') await h.command('member', { email: 'delayed-reviewer@example.test', name: 'Reviewer', roles: ['admin'], active: false })
        if (refusal === 'timing-authority') await h.command('member', { email: 'status-timing-admin@example.test', name: 'Timing reviewer', roles: ['admin'], active: false })
        if (refusal === 'closure') await h.command('move', { application: received.application, to: 'withdrawn', closeReason: 'other-offer', reason: 'Closed application' })
        await h.setTime(mail.dueAt); await tick()
        h.owner = await h.signIn('owner@example.test')
        const outcome = (await h.state()).applicationEmails.find(m => m.id === mail.id)
        assert.equal(outcome.status, refusal === 'contact' ? 'suppressed' : refusal === 'closure' ? 'canceled' : 'withheld', refusal)
        assert.equal(await mailCount(), 1)
        if (refusal === 'contact') { candidateCookie = await h.signIn('jordan@example.test'); assert.equal((await h.send('/candidate/receipts/' + received.code + '/account/preferences', form({ preference: 'email' }), candidateCookie)).status, 303) }
        if (refusal === 'authority') await h.command('member', { email: 'delayed-reviewer@example.test', name: 'Reviewer', roles: ['admin'], active: true })
        if (refusal === 'timing-authority') await h.command('member', { email: 'status-timing-admin@example.test', name: 'Timing reviewer', roles: ['admin'], active: true })
      }
    } finally { await h.close() }
  }
}
