import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'

const previewPath = '/api/lodge/bulk-invitations/preview', sendPath = '/api/lodge/bulk-invitations/send'
const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"'
const csv = rows => rows.map(row => row.map(quote).join(',')).join('\r\n')

export async function bulkInvitationFixture() {
  const h = await businessHarness()
  try {
    const cmd = h.command, admin = await h.member('invites-admin@example.test', ['admin'], 'Invitation admin')
    const department = await cmd('department', { name: 'Operations' })
    const office = await cmd('office', { name: 'Denver, CO' })
    const one = await cmd('vacancy', { title: 'Warehouse lead', departmentId: department.id, officeId: office.id })
    const two = await cmd('vacancy', { title: 'Transport lead', departmentId: department.id, officeId: office.id })
    const level = await cmd('permission-level', { name: 'Scoped recruiters', permissions: ['move', 'export'] })
    const source = csv([
      ['email', 'name', 'roles', 'permission level', 'job', 'job role', 'department', 'office', 'departments', 'offices'],
      ['not-an-address', 'Invalid person', 'manager'],
      ['owner@example.test', 'Already here', 'manager'],
      ['unknown-job@example.test', 'Unknown job', 'manager', '', 'Missing job', 'recruiter'],
      ...Array.from({ length: 22 }, (_, i) => [`bulk-${i + 1}@example.test`, `Person ${i + 1}, Team`, 'manager', level.name, i < 11 ? one.title : two.title, 'recruiter', department.name, office.name, department.name, office.name]),
    ])
    // Pad refused rows to a valid CSV shape; malformed CSV must not stand in for the required refusals.
    const shaped = source.split('\r\n').map((line, index) => index > 0 && index < 4 ? line + ',""'.repeat(10 - [3, 3, 6][index - 1]) : line).join('\r\n')
    return Object.assign(h, { admin, department, office, one, two, level, source: shaped })
  } catch (error) { await h.close(); throw error }
}

/** OPS-002 bulk-invitation acceptance, through the real Worker and native mail provider serialization. */
export async function checkBulkInvitations() {
  const h = await bulkInvitationFixture()
  try {
    const { admin, department, office, one, two, level, source: shaped } = h
    const before = await h.state(), beforeMail = await bulkInvitationMails(h)
    const p = await h.send(previewPath, { source: '\uFEFF' + shaped }, h.owner)
    assert.equal(p.status, 200, p.text)
    const plan = p.value
    assert.equal(plan.rows.length, 25)
    assert.equal(plan.rows.filter(r => r.status === 'new').length, 22)
    assert.equal(plan.rows.filter(r => r.status !== 'new').length, 3)
    assert.equal(plan.rows[0].status, 'refused'); assert.match(plan.rows[0].reason, /email/i)
    assert.equal(plan.rows[1].status, 'existing')
    assert.equal(plan.rows[2].status, 'refused'); assert.match(plan.rows[2].reason, /unknown job/i)
    assert.deepEqual((await h.state()).members, before.members, 'preview creates no member or scope')
    assert.deepEqual((await h.state()).vacancies, before.vacancies, 'preview does not change hiring teams')
    assert.equal((await bulkInvitationMails(h)).length, beforeMail.length)
    assert.equal((await h.send(sendPath, { id: plan.id, token: 'synthetic-lodge-1' }, h.owner)).status, 409)
    assert.equal((await h.send(sendPath, { id: plan.id, token: plan.token }, admin)).status, 403)
    const sent = await h.send(sendPath, { id: plan.id, token: plan.token }, h.owner)
    assert.equal(sent.status, 200, sent.text)
    assert.equal(sent.value.sent, 22)
    assert.equal(sent.value.rows.filter(r => r.status === 'accepted').length, 22)
    const afterMail = await bulkInvitationMails(h), batchMail = afterMail.slice(beforeMail.length)
    assert.equal(batchMail.length, 22)
    assert.equal(new Set(batchMail.flatMap(m => m.to)).size, 22)
    const saved = await h.state(), added = saved.members.filter(m => m.email.startsWith('bulk-'))
    assert.equal(added.length, 22)
    assert.ok(added.every(m => m.roles.includes('manager') && m.grantDepartments.includes(department.id) && m.grantOffices.includes(office.id) && m.grantLevels[department.id] === level.id))
    for (const job of [one, two]) {
      const live = saved.vacancies.find(v => v.id === job.id)
      assert.equal(live.team.recruiters.length, 11)
      assert.ok(live.team.recruiters.every(email => live.levels.members[email] === level.id))
    }
    // A received real invitation logs in with the reviewed role and named permission level.
    const token = new URL(batchMail[0].text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
    const confirmed = await h.send('/auth/confirm', { token })
    assert.equal(confirmed.status, 303, confirmed.text)
    const person = await h.state(confirmed.cookie)
    assert.deepEqual(person.actor.roles, ['manager'])
    assert.equal((await h.send('/api/lodge/command/vacancy-stages', { id: one.id, stages: one.stages }, confirmed.cookie)).status, 403, 'named level limits job settings')
    const replay = await h.send(sendPath, { id: plan.id, token: plan.token }, h.owner)
    assert.equal(replay.status, 200, replay.text); assert.equal(replay.value.sent, 0)
    assert.equal(replay.value.previouslySent, 22)
    const repeatPreview = await h.send(previewPath, { source: shaped }, h.owner)
    assert.equal(repeatPreview.status, 200, repeatPreview.text)
    assert.equal(repeatPreview.value.rows.filter(r => r.status === 'new').length, 0)
    const repeat = await h.send(sendPath, { id: repeatPreview.value.id, token: repeatPreview.value.token }, h.owner)
    assert.equal(repeat.status, 200, repeat.text); assert.equal(repeat.value.sent, 0)
    assert.equal((await bulkInvitationMails(h)).length, afterMail.length, 'replaying the preview or same file never resends')
    const audit = await h.send('/api/lodge/audit', undefined, h.owner)
    assert.equal(audit.status, 200)
    const events = Array.isArray(audit.value) ? audit.value : audit.value.events
    assert.equal(events.filter(e => e.action === 'invitation-handed-to-mail-provider' && e.batch === plan.id).length, 22)
    await checkRefusals(h, admin, one)
    await checkHtmlForms(h)
  } finally { await h.close() }
}

export async function bulkInvitationMails(h) {
  return (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence').all()).results.map(r => JSON.parse(r.message))
}

async function checkRefusals(h, admin, job) {
  const grants = await h.send(previewPath, { source: csv([['email', 'name', 'roles', 'job', 'job role'], ['forbidden-admin@example.test', 'Forbidden admin', 'admin', '', ''], ['wrong-job-role@example.test', 'Wrong role', 'employee', job.title, 'recruiter']]) }, admin)
  assert.equal(grants.status, 200, grants.text)
  assert.ok(grants.value.rows.every(r => r.status === 'refused'))
  assert.match(grants.value.rows[0].reason, /owner/i)
  assert.match(grants.value.rows[1].reason, /manager|admin/i)
  const list = await h.send(previewPath, { source: 'plain-one@example.test; plain-two@example.test\nPLAIN-ONE@example.test' }, h.owner)
  assert.equal(list.status, 200, list.text)
  assert.equal(list.value.rows.filter(r => r.status === 'new').length, 2)
  assert.equal(list.value.rows[2].status, 'refused')
  assert.match(list.value.rows[2].reason, /duplicate/i)
  const fresh = await h.send(previewPath, { source: 'stale-preview@example.test' }, h.owner)
  assert.equal(fresh.status, 200, fresh.text)
  await h.command('office', { name: 'Remote' })
  const unchanged = (await h.state()).members, before = (await bulkInvitationMails(h)).length
  const stale = await h.send(sendPath, { id: fresh.value.id, token: fresh.value.token }, h.owner)
  assert.equal(stale.status, 409, stale.text)
  assert.deepEqual((await h.state()).members, unchanged)
  assert.equal((await bulkInvitationMails(h)).length, before)
  const malformed = await h.send(previewPath, { source: 'email,name\n"never closed' }, h.owner)
  assert.equal(malformed.status, 400)
}

async function checkHtmlForms(h) {
  const start = await h.send('/enterprise/invitations', undefined, h.owner)
  assert.equal(start.status, 200, start.text)
  assert.equal(start.headers.get('referrer-policy'), 'same-origin', 'same-origin form posts retain their Origin')
  const form = new FormData(); form.set('source', 'html-preview@example.test')
  const preview = await h.send('/enterprise/invitations/preview', form, h.owner)
  assert.equal(preview.status, 303, preview.text)
  const reviewed = await h.send(preview.headers.get('location'), undefined, h.owner)
  assert.equal(reviewed.status, 200, reviewed.text)
  assert.ok(reviewed.text.includes('html-preview@example.test'))
  assert.ok(reviewed.text.includes('Invitation preview'))
}
