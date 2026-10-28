import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { businessHarness } from './harness.mjs'
import { latestMail } from './candidate-driver.mjs'
import { spanishText } from './languages-driver.mjs'

const address = n => ['synthetic-lodge-' + n, 'example.test'].join('@')
const form = values => { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f }

/** Native job and reviewed Spanish intake, shared with the workspace journey. */
export async function messageTemplateJob(run, ownerEmail, manager = ownerEmail) {
  const office = await run('office', { name: 'Synthetic Lodge template office' })
  let job = await run('vacancy', { title: 'Synthetic Lodge template job', officeId: office.id, location: 'Denver, CO', manager, headcount: 1, compensation: { currency: 'USD', min: 6000000, max: 8000000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Describes safe work' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
  const asked = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: asked.id, version: asked.version, decision: 'approved', reason: 'Reviewed hiring need' })
  job = await run('publish', { id: job.id })
  const english = job.slug
  job = await run('job-post', { vacancy: job.id, title: 'Synthetic Lodge puesto', description: 'Trabajo seguro.', language: 'es', locations: [office.id], destinations: ['careers'], translation: { ...spanishText({ id: 'unused' }), questions: {} } })
  const es = job.posts.at(-1)
  await run('post-status', { vacancy: job.id, post: es.id, status: 'live' })
  return { job, english, spanish: es.slug }
}

/** One recruiting journey: review reusable text, inspect recipients, create frozen drafts and replay safely. */
export async function checkMessageTemplates() {
  let outbound = 0
  const h = await businessHarness({ outboundService: () => { outbound++; return new Response('unexpected outbound', { status: 502 }) } })
  try {
    const { command: run, send, state } = h
    const ownerEmail = (await state()).actor.email
    const managerEmail = address('manager'), manager = await h.member(managerEmail, ['manager'], 'Synthetic Lodge manager')
    const { job, english, spanish } = await messageTemplateJob(run, ownerEmail, managerEmail)
    const submit = async (slug, n, phone = '') => {
      const r = await send('/jobs/' + slug, form({ name: 'Synthetic Lodge ' + n, email: address(n), phone, noticeVersion: '1', consent: 'yes' }))
      assert.equal(r.status, 200, r.text)
      const receipt = r.text.match(/LDG-[A-F0-9]{8}/)[0]
      const w = await state(), app = w.applications.find(a => a.id === w.receipts.find(r => r.id === receipt).application)
      return { app, receipt }
    }
    // The original English route becomes unavailable after a post goes live; an English post keeps both language doors native.
    const enJob = await run('job-post', { vacancy: job.id, title: job.title, description: 'Safe work.', language: 'en', locations: [job.officeId], destinations: ['careers'] })
    const enPost = enJob.posts.at(-1)
    await run('post-status', { vacancy: job.id, post: enPost.id, status: 'live' })
    const en = await submit(enPost.slug, 1, '+1 555 0101'), es = await submit(spanish, 2, '+1 555 0102'), missing = await submit(enPost.slug, 3), excluded = await submit(enPost.slug, 4, '+1 555 0104')
    const noEmail = (await run('candidate', { name: 'Synthetic Lodge no contact', source: 'Direct', consentBasis: 'manual', vacancy: job.id })).application
    assert.equal((await send('/auth/invite', { email: address(4), displayName: 'Synthetic Lodge candidate', role: 'member', returnTo: '/candidate' }, h.owner)).status, 202)
    const token = new URL((await latestMail(h, address(4))).text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
    const candidateCookie = (await send('/auth/confirm', { token })).cookie
    assert.equal((await send('/candidate/receipts/' + excluded.receipt + '/account/preferences', form({ preference: 'none' }), candidateCookie)).status, 303)
    const templateInput = { vacancy: job.id, name: 'Synthetic Lodge follow-up', language: 'en', subject: 'Next step: {job_title}', body: 'Hello {candidate_name}, phone {candidate_phone}. — {business_name}', reviewed: true }
    const before = (await state()).messages.length
    assert.equal((await send('/api/lodge/command/message-template', { ...templateInput, reviewed: false }, manager)).status, 400)
    assert.equal((await send('/api/lodge/command/message-template', { ...templateInput, body: 'Private {score}' }, manager)).status, 400)
    assert.equal((await send('/api/lodge/command/message-template', { ...templateInput, body: 'Incomplete {candidate_name' }, manager)).status, 400)
    let template = await run('message-template', templateInput, manager)
    const reference = async () => { const t = (await state(manager)).messageTemplates.find(t => t.id === template.id); return { id: t.id, revision: t.revision } }
    const preview = async (ids, cookie = manager, referenceValue) => {
      const action = { kind: 'message', template: referenceValue ?? await reference(), approver: ownerEmail }
      return run('bulk-preview', { items: ids, action }, cookie)
    }
    let p = await preview([en.app.id, es.app.id, missing.app.id, excluded.app.id, noEmail.id])
    assert.deepEqual([p.ready, p.refused], [1, 4])
    assert.match(p.items[1].refusal, /application language es/)
    assert.match(p.items[2].refusal, /Missing merge value: candidate_phone/)
    assert.match(p.items[3].refusal, /withdrawn email contact/)
    assert.match(p.items[4].refusal, /no email/)
    assert.equal((await state()).messages.length, before, 'preview makes no message or approval')
    const applyBody = (p, batch) => ({ batch, review: p.review, action: p.action, items: p.items.filter(i => i.ok).map(i => i.application), previewed: Object.fromEntries(p.items.filter(i => i.ok).map(i => [i.application, i.seen])) })
    const old = applyBody(p, 'synthetic-lodge-stale-language')
    template = await run('message-template', { ...templateInput, id: template.id, version: 1, language: 'es', subject: 'Próximo paso: {job_title}', body: 'Hola {candidate_name}, teléfono {candidate_phone}. — {business_name}' }, manager)
    const stale = await run('bulk-apply', old, manager)
    assert.deepEqual([stale.applied, stale.refused], [0, 1], 'an edited language review invalidates the selection preview')
    p = await preview([en.app.id, es.app.id, missing.app.id, excluded.app.id])
    assert.deepEqual(p.items.filter(i => i.ok).map(i => [i.email.to, i.email.body, i.email.language, i.email.version, i.email.sent]), [
      [address(1), 'Hello Synthetic Lodge 1, phone +1 555 0101. — Example Builders', 'en', 1, false],
      [address(2), 'Hola Synthetic Lodge 2, teléfono +1 555 0102. — Example Builders', 'es', 2, false],
    ])
    const body = applyBody(p, 'synthetic-lodge-replay-0001')
    assert.equal((await send('/api/lodge/command/bulk-apply', { ...body, items: [en.app.id] }, manager)).status, 409)
    assert.equal((await send('/api/lodge/command/bulk-apply', { ...body, action: { ...body.action, approver: managerEmail } }, manager)).status, 409)
    const mailCount = async () => (await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n
    const mailBefore = await mailCount(), callsBefore = outbound
    const concurrent = await Promise.all([send('/api/lodge/command/bulk-apply', body, manager), send('/api/lodge/command/bulk-apply', body, manager)])
    assert.ok(concurrent.some(r => r.status === 200)); assert.ok(concurrent.every(r => [200, 409].includes(r.status)))
    assert.equal((await state()).messages.length, before + 2, 'a concurrent batch creates one draft per eligible recipient')
    await h.restart()
    assert.equal((await run('bulk-apply', body, manager)).replayed, true)
    assert.equal((await state()).messages.length, before + 2, 'durable replay after restart creates no second draft')
    let drafts = (await state()).messages.filter(m => [en.app.id, es.app.id].includes(m.application))
    for (const m of drafts) {
      assert.equal(m.templateDraft.selectionReview, p.review)
      assert.equal(m.templateDraft.reviewedBy, managerEmail)
      await run('decide-approval', { id: m.approval.id, version: m.version, decision: 'approved', reason: 'Reviewed exact recipient and text' })
      assert.match((await send('/api/lodge/download/message/' + m.id, undefined, manager)).text, /X-Unsent: 1/)
    }
    const frozen = drafts.map(m => ({ id: m.id, body: m.body, templateDraft: m.templateDraft }))
    template = await run('message-template', { ...templateInput, id: template.id, version: 2, body: 'Revised {candidate_name} — {business_name}' }, manager)
    drafts = (await state()).messages.filter(m => frozen.some(f => f.id === m.id))
    assert.deepEqual(drafts.map(m => ({ id: m.id, body: m.body, templateDraft: m.templateDraft })), frozen, 'template edits preserve earlier drafts and their language review provenance')
    const draft = drafts.find(m => m.application === en.app.id)
    assert.equal((await send('/api/lodge/download/message/' + draft.id, undefined, manager)).status, 200, 'a later template version does not replace approved frozen text')
    await run('message', { id: draft.id, application: draft.application, purpose: draft.purpose, to: draft.to, subject: draft.subject, body: 'Human edited exact text' }, manager)
    assert.equal((await send('/api/lodge/download/message/' + draft.id, undefined, manager)).status, 409, 'editing text requires LDG-010 approval again')
    const request = await run('request-message-approval', { id: draft.id, approver: ownerEmail }, manager)
    await run('decide-approval', { id: request.id, version: request.version, decision: 'approved', reason: 'Reviewed edited text' })
    assert.equal((await send('/api/lodge/download/message/' + draft.id, undefined, manager)).status, 200)
    const currentPerson = (await state()).candidates.find(c => c.id === en.app.candidate)
    const staleRecipient = await preview([en.app.id])
    await run('correct-candidate', { ...currentPerson, email: address('changed'), reason: 'Candidate corrected contact' })
    assert.equal((await run('bulk-apply', applyBody(staleRecipient, 'synthetic-lodge-stale-recipient'), manager)).applied, 0)
    assert.equal((await send('/api/lodge/command/request-message-approval', { id: draft.id, approver: ownerEmail }, manager)).status, 409)
    assert.equal((await send('/api/lodge/download/message/' + draft.id, undefined, manager)).status, 409)
    // A job-level contact revocation hides all frozen recipient data as well as refusing creation and download.
    p = await preview([es.app.id])
    const limited = await run('permission-level', { name: 'Synthetic Lodge settings without contact', permissions: ['settings'] })
    await run('job-levels', { id: job.id, members: { [managerEmail]: limited.id } })
    const outcome = await run('bulk-apply', applyBody(p, 'synthetic-lodge-revoked-contact'), manager)
    assert.equal(outcome.applied, 0)
    const hidden = await state(manager)
    assert.equal(hidden.messageTemplates.length, 0)
    assert.equal(hidden.messages.filter(m => drafts.some(d => d.id === m.id)).length, 0)
    assert.equal(hidden.approvals.filter(a => drafts.some(d => d.id === a.subjectId)).length, 0)
    assert.equal((await send('/api/lodge/download/message/' + drafts[1].id, undefined, manager)).status, 404)
    // The erased person's saved selection cannot be replayed to restore a draft.
    await run('move', { application: es.app.id, to: 'withdrawn', closeReason: 'pay', reason: 'Candidate withdrew' })
    const esPerson = (await state()).candidates.find(c => c.id === es.app.candidate)
    assert.equal((await send('/api/lodge/delete-candidate', { candidate: esPerson.id, confirm: esPerson.name, reason: 'Authorized request' }, h.owner)).status, 200)
    const afterErase = await run('bulk-apply', { ...applyBody(p, 'synthetic-lodge-after-erasure') }, h.owner, 404)
    assert.match(afterErase.error, /not found/i)
    assert.equal((await state()).messages.some(m => m.application === es.app.id), false)
    assert.equal(await mailCount(), mailBefore, 'template review, previews, drafts and unsent downloads enqueue no mail')
    assert.equal(outbound, callsBefore, 'no outbound provider calls')
    void english
  } finally { await h.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkMessageTemplates()
  console.log('COM-002 reusable template journey passed')
}
