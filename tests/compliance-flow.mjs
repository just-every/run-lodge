import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'

/** OPS-002: independent human compliance grants, exercised through real HTTP doors. */
export async function checkCompliance() {
  const h = await businessHarness()
  try {
    const { command: cmd, state, send } = h
    const address = n => `synthetic-lodge-${n}@example.test`
    const compliance = await h.member(address(1), ['interviewer'])
    const manager = await h.member(address(2), ['manager'])
    const admin = await h.member(address(3), ['admin'])
    const agent = await h.member(address(4), [], 'synthetic-lodge-4', { agent: true, actsFor: address(1) })
    const adminAgent = await h.member(address(15), [], 'synthetic-lodge-15', { agent: true, actsFor: address(3) })
    async function open(n) {
      const job = await cmd('vacancy', { title: `synthetic-lodge-${n}`, location: 'New York', headcount: 1, manager: address(2), compensation: { currency: 'USD', min: 100, max: 200, period: 'year' } }, manager)
      await cmd('rubric', { id: job.id, criteria: [{ name: 'Experience', description: 'Prior relevant work' }] }, manager)
      await cmd('interview-plan', { id: job.id, plan: [{ name: 'Review', stageName: 'Interview' }] }, manager)
      const approval = await cmd('request-vacancy-approval', { id: job.id, approver: 'owner@example.test' }, manager)
      await cmd('decide-approval', { id: approval.id, decision: 'approved', version: approval.version, reason: 'Synthetic proof' })
      return cmd('publish', { id: job.id }, manager)
    }
    const job = await open(5), other = await open(6)
    async function intake(vacancy, n) {
      const f = new FormData()
      for (const [key, value] of Object.entries({ name: `synthetic-lodge-${n}`, email: address(n), phone: '+15550101111', noticeVersion: '1', consent: 'yes', accommodation: `synthetic-lodge-${n}-accommodation`, monitoring: 'Woman' })) f.set(key, value)
      const received = await send('/jobs/' + vacancy.slug, f)
      assert.equal(received.status, 200, received.text)
      return (await state()).applications.find(a => a.candidateName === `synthetic-lodge-${n}`)
    }
    const app = await intake(job, 7), hidden = await intake(other, 8)
    await cmd('assign-reviewers', { application: app.id, reviewers: [address(1)] }, manager)
    await cmd('note', { application: app.id, text: 'synthetic-lodge-9-feedback' }, compliance)
    const ordinary = await cmd('document', { application: app.id, name: 'synthetic-lodge-10.txt', kind: 'resume', base64: Buffer.from('synthetic-lodge-10-resume').toString('base64') }, manager)
    async function paper(application, n) {
      return cmd('document', { application, name: `synthetic-lodge-${n}.txt`, kind: 'right-to-work', base64: Buffer.from(`synthetic-lodge-${n}-identity`).toString('base64') }, manager)
    }
    const doc = await paper(app.id, 11), hiddenDoc = await paper(hidden.id, 12)
    const globalDoc = await cmd('document', { candidate: app.candidate, name: 'synthetic-lodge-13.txt', kind: 'right-to-work', base64: Buffer.from('synthetic-lodge-13-identity').toString('base64') })
    await cmd('member', { email: address(1), name: 'synthetic-lodge-1', roles: ['compliance'] })
    let view = await state(compliance)
    assert.deepEqual([view.vacancies, view.documents, view.restricted, view.candidates, view.applications], [[], [], [], [], []], 'the role and old panel assignment grant no compliance jobs or hiring data')
    assert.equal((await send('/api/lodge/command/vacancy-compliance', { id: job.id, people: [address(1)] }, manager)).status, 403)
    assert.equal((await send('/api/lodge/command/vacancy-compliance', { id: job.id, people: [address(1)] }, compliance)).status, 403)
    const forged = await h.mf.dispatchFetch(h.origin + '/enterprise/compliance', { method: 'POST', headers: { cookie: h.owner, origin: 'https://synthetic-lodge-16.example.test', 'sec-fetch-site': 'cross-site', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: job.id, people: address(1) }).toString() })
    assert.equal(forged.status, 403, 'a foreign form cannot grant compliance access with the owner session')
    assert.deepEqual((await state(compliance)).vacancies, [], 'a refused form changes no grants')
    await cmd('vacancy-compliance', { id: job.id, people: [address(1)] }, admin)
    view = await state(compliance)
    const compliancePage = await send('/enterprise/compliance', undefined, compliance)
    assert.equal(compliancePage.status, 200)
    assert.ok(compliancePage.text.includes(doc.name) && !compliancePage.text.includes(hiddenDoc.name) && !compliancePage.text.includes(address(7)))
    assert.deepEqual(view.vacancies.map(v => v.id), [job.id])
    assert.deepEqual(view.documents.map(d => d.id), [doc.id])
    assert.deepEqual(view.restricted.map(r => r.application), [app.id, app.id])
    for (const key of ['applications', 'candidates', 'scorecards', 'notes', 'teamNotes', 'interviews', 'messages', 'offers', 'activity', 'members', 'proposals']) assert.deepEqual(view[key], [], key)
    assert.ok(!JSON.stringify(view).includes(address(7)) && !JSON.stringify(view).includes('synthetic-lodge-9-feedback') && !JSON.stringify(view).includes(hiddenDoc.id))
    for (const route of ['download/document/', 'view/document/']) {
      const received = await send('/api/lodge/' + route + doc.id, undefined, compliance)
      assert.equal(received.status, 200)
      assert.equal(received.text, 'synthetic-lodge-11-identity')
      for (const denied of [ordinary, hiddenDoc, globalDoc]) assert.equal((await send('/api/lodge/' + route + denied.id, undefined, compliance)).status, 404)
    }
    assert.equal((await send('/api/lodge/download/candidate/' + app.candidate, undefined, compliance)).status, 403)
    for (const route of ['download/activity/' + app.candidate, 'download/vacancy/' + job.id]) assert.equal((await send('/api/lodge/' + route, undefined, compliance)).status, 404)
    const search = await send('/api/lodge/search?q=' + address(7), undefined, compliance)
    assert.deepEqual(search.value.results, [])
    assert.equal((await send('/api/lodge/home', undefined, compliance)).status, 200)
    const board = await send('/api/lodge/board/' + job.id, undefined, compliance)
    assert.equal(board.status, 200)
    assert.ok(!board.text.includes(app.id) && !board.text.includes(address(7)))
    assert.equal((await send('/api/lodge/command/move', { application: app.id, to: 'rejected', closeReason: 'skills', reason: 'Probe' }, compliance)).status, 404)
    assert.equal((await send('/api/lodge/command/member', { email: address(14), name: 'synthetic-lodge-14', roles: ['admin'] }, compliance)).status, 403)
    for (const who of [manager, agent, adminAgent]) {
      const restricted = await state(who)
      assert.deepEqual(restricted.restricted, [])
      assert.ok(!restricted.documents.some(d => d.id === doc.id))
      assert.equal((await send('/api/lodge/download/document/' + doc.id, undefined, who)).status, 404)
    }
    assert.ok((await state(admin)).restricted.some(r => r.application === app.id))
    // Independent scope revocation takes effect on the existing session and agent.
    await cmd('vacancy-compliance', { id: job.id, people: [] })
    assert.deepEqual((await state(compliance)).restricted, [])
    assert.ok(!(await send('/enterprise/compliance', undefined, compliance)).text.includes(doc.name))
    assert.equal((await send('/api/lodge/download/document/' + doc.id, undefined, compliance)).status, 404)
    await cmd('vacancy-compliance', { id: job.id, people: [address(1)] })
    await cmd('member', { email: address(1), name: 'synthetic-lodge-1', roles: ['interviewer'] })
    assert.deepEqual((await state(agent)).restricted, [])
    assert.equal((await send('/api/lodge/download/document/' + doc.id, undefined, compliance)).status, 404)
    await cmd('member', { email: address(1), name: 'synthetic-lodge-1', roles: [], active: false })
    assert.equal((await send('/api/lodge/state', undefined, compliance)).status, 403)
    assert.equal((await send('/api/lodge/state', undefined, agent)).status, 403)
    assert.ok((await state(manager)).applications.some(a => a.id === app.id), 'the hiring team retains history')
  } finally { await h.close() }
}
