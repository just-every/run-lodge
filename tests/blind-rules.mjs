import assert from 'node:assert/strict'

/** REVIEW-002: rule routes/rejections also reveal, including within the initial intake transaction. */
export async function blindRules(h, job) {
 const cmd = h.command, state = h.state
 const question = await cmd('question', { text: 'Can you work the published shift?', type: 'yes-no', required: false })
 const v = await job('Blind rule routing', question)
 await cmd('blind-review', { id: v.id, enabled: true, stages: [v.stages[0].id], revealStage: v.stages[2].id })
 const apply = async name => {
  const f = new FormData()
  for (const [k, value] of Object.entries({ name, email: name.replaceAll(' ', '.').toLowerCase() + '@example.test', consent: 'yes', noticeVersion: '1', ['q-' + question.id]: 'yes' })) f.append(k, value)
  assert.equal((await h.send('/jobs/' + v.slug, f)).status, 200)
  return (await state()).applications.find(a => a.candidateName === name)
 }
 const log = async app => (await state()).audit.filter(e => e.action === 'blind-review-revealed' && e.record === 'application:' + app.id)
 const historical = await apply('Robin Route')
 assert.equal((await log(historical)).length, 0)
 const route = await cmd('screening-rule', { vacancy: v.id, name: 'Shift discussion', question: question.id, when: { equals: 'yes' }, then: { kind: 'route', stage: v.stages[2].id } })
 await cmd('apply-rule', { id: route.id, applications: [historical.id] })
 assert.equal((await log(historical)).length, 1, 'reviewed rule apply logs reveal')
 const immediate = await apply('Avery Route')
 assert.equal(immediate.stage, v.stages[2].id)
 assert.equal((await log(immediate)).length, 1, 'initial intake routing logs reveal')
 await cmd('screening-rule', { id: route.id, active: false, question: question.id, when: { equals: 'yes' }, then: { kind: 'route', stage: v.stages[2].id } })
 const reject = await cmd('screening-rule', { vacancy: v.id, name: 'Shift rejection', question: question.id, when: { equals: 'yes' }, then: { kind: 'propose-reject', reason: 'Cannot work shift', closeReason: 'availability', send: 'none' } })
 const queued = await apply('Charlie Review')
 const match = (await state()).ruleMatches.find(r => r.application === queued.id)
 await cmd('decide-rule-matches', { id: match.id, decision: 'confirm' })
 assert.equal((await log(queued)).length, 1, 'confirmed rule rejection logs reveal')
 await cmd('approve-auto-reject', { id: reject.id })
 const automatic = await apply('Sam Automatic')
 assert.equal(automatic.status, 'rejected')
 assert.equal((await log(automatic)).length, 1, 'automatic rejection logs reveal')
}
