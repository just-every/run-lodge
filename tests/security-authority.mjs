import assert from 'node:assert/strict'

const snapshot = async h => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results

export async function checkReviewerAuthority(h, panelAgent) {
 const pending = await h.command('interview', { application: h.app.id, planItem: h.vacancy.plan[0].id, participants: ['panel@example.test'], slots: ['2026-12-04T15:00:00Z'] }, h.manager)
 // The assignment survives in history; its authority does not survive role removal.
 await h.command('member', { email: 'panel@example.test', name: 'Former panellist', roles: ['approver'] })
 const operations = [
  ['/api/lodge/download/document/' + h.document.id, undefined, 404],
  ['/api/lodge/download/calendar/' + h.interview.id, undefined, 404],
  ['/api/lodge/command/availability', { interview: pending.id, slots: [0] }, 403],
  ['/api/lodge/command/note', { application: h.app.id, text: 'Old assignment' }, 404],
  ['/api/lodge/command/scorecard', { application: h.app.id, ratings: {}, evidence: {} }, 404],
 ]
 for (const cookie of [h.panel, panelAgent]) {
  const view = await h.state(cookie)
  for (const [key, id] of [['applications', h.app.id], ['notes', h.note.id], ['scorecards', h.card.id], ['documents', h.document.id], ['interviews', h.interview.id]]) assert.ok(!view[key].some(x => x.id === id), key + ' is no longer authorized')
  assert.ok(!(await h.send('/api/lodge/search?q=Integrity', undefined, cookie)).value.results.some(x => x.id === h.candidate.id))
  for (const [url, body, status] of operations) {
   const before = await snapshot(h), response = await h.send(url, body, cookie)
   assert.equal(response.status, cookie === panelAgent && body ? 403 : status, response.text)
   assert.deepEqual(await snapshot(h), before, 'refused stale assignment changed records or audits')
  }
 }
 // Every current reviewing role works when on this panel, including an admin;
 // current vacancy management also grants the calendar, independently of panel membership.
 for (const role of ['interviewer', 'manager', 'admin']) {
  await h.command('member', { email: 'panel@example.test', name: 'Current panellist', roles: [role] })
  for (const cookie of [h.panel, panelAgent]) {
   const view = await h.state(cookie)
   assert.ok(view.applications.some(x => x.id === h.app.id))
   assert.ok(view.notes.some(x => x.id === h.note.id))
   assert.ok(view.scorecards.some(x => x.id === h.card.id))
   assert.equal((await h.send('/api/lodge/download/calendar/' + h.interview.id, undefined, cookie)).status, 200)
  }
  assert.equal((await h.send('/api/lodge/command/availability', { interview: pending.id, slots: [0] }, h.panel)).status, 200)
 }
 await h.command('member', { email: 'panel@example.test', name: 'Current panellist', roles: ['interviewer'] })
 const ownerPanel = await h.command('interview', { application: h.app.id, planItem: h.vacancy.plan[0].id, participants: ['owner@example.test'], slots: ['2026-12-05T15:00:00Z'] }, h.manager)
 await h.command('availability', { interview: ownerPanel.id, slots: [0] })
 await h.command('schedule', { interview: ownerPanel.id, slot: 0 }, h.manager)
 assert.equal((await h.send('/api/lodge/download/calendar/' + ownerPanel.id, undefined, h.owner)).status, 200)
 assert.equal((await h.send('/api/lodge/download/calendar/' + ownerPanel.id, undefined, h.panel)).status, 404)
 // Cancel the only interview grant for an unassigned reviewer; even an active
 // interviewer cannot use an assignment from a cancelled interview.
 const lone = await h.command('interview', { application: h.app.id, planItem: h.vacancy.plan[0].id, participants: ['outside@example.test'], slots: ['2026-12-06T15:00:00Z'] }, h.manager)
 assert.ok((await h.state(h.outsider)).applications.some(x => x.id === h.app.id))
 await h.command('cancel-interview', { interview: lone.id, reason: 'Panel removed' }, h.manager)
 assert.ok(!(await h.state(h.outsider)).applications.some(x => x.id === h.app.id))
}
