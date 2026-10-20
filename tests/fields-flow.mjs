import assert from 'node:assert/strict'
import { BUSINESS, harness } from './harness.mjs'
import { zip } from './zip.mjs'

/** DATA-001, through real HTTP and D1; the only synthetic data is the import ZIP. */
export async function checkFields(t) {
 const h = await harness(); t.after(() => h.close())
 const { command: cmd, send, state } = h
 await cmd('business', BUSINESS)
 const manager = await h.member('fields.manager@example.test', ['manager'])
 const reviewer = await h.member('fields.reviewer@example.test', ['interviewer'])
 const other = await h.member('fields.other@example.test', ['manager'])
 const v = await cmd('vacancy', { title: 'Field operations', manager: 'fields.manager@example.test', location: 'New York, NY', headcount: 1, compensation: { currency: 'USD', min: 5000000, max: 7000000, period: 'year' } })
 await cmd('rubric', { id: v.id, criteria: [{ name: 'Operations', description: 'Evidence of practical operations work' }] })
 await cmd('interview-plan', { id: v.id, plan: [{ name: 'Interview', stageName: 'Interview' }] })
 const raw = [
  { id: 'employment', name: 'Employment preference', record: 'candidate', type: 'choice', choices: ['Permanent', 'Contract'], requiredStages: [v.stages[0].id], importColumn: 'Preferred arrangement' },
  { id: 'years', name: 'Handling years', record: 'candidate', type: 'number', importColumn: 'Years handling' },
  { id: 'shift', name: 'Shift available', record: 'application', type: 'boolean', importColumn: 'Shift ready' },
  { id: 'start', name: 'Available date', record: 'application', type: 'date', requiredStages: [v.stages[1].id], importColumn: 'Available on' },
  { id: 'private', name: 'Private screening detail', record: 'application', type: 'text', restricted: true, importColumn: 'Private detail' },
  { id: 'school', name: 'School', record: 'candidate', type: 'text', identity: 'school', importColumn: 'School attended' },
  { id: 'year', name: 'Graduation year', record: 'candidate', type: 'number', identity: 'year', importColumn: 'Graduation year' },
  { id: 'budget', name: 'Requisition cost center', record: 'vacancy', type: 'text', importColumn: 'Cost center' },
 ].map(f => ({ choices: [], requiredStages: [], restricted: false, identity: null, ...f }))
 let configured = await cmd('field-schema', { id: v.id, fields: raw })
 const schema = configured.customSchema, key = name => schema.find(f => f.name === name).id
 const employment = key('Employment preference'), years = key('Handling years'), shift = key('Shift available'), start = key('Available date'), privateField = key('Private screening detail'), school = key('School'), year = key('Graduation year'), budget = key('Requisition cost center')
 await cmd('field-schema', { id: v.id, fields: schema.filter(f => !f.restricted) }, manager)
 assert.ok((await state()).vacancies.find(x => x.id === v.id).customSchema.some(f => f.id === privateField), 'a manager preserves unseen restricted definitions')
 await cmd('field-schema', { id: v.id, fields: schema }, manager, 403)
 await cmd('field-schema', { id: v.id, fields: [] }, other, 403)
 await cmd('field-values', { vacancy: v.id, values: { [budget]: 'OPS-410' } }, manager)
 const view = { id: 'permanent', name: 'Permanent operators', query: 'forklift', filters: [{ field: employment, equals: 'Permanent' }], tags: ['shift-reviewed'] }
 await cmd('hiring-view', { id: v.id, views: [view] }, manager)
 const privateView = { id: 'private', name: 'Private queue', query: '', filters: [{ field: privateField, equals: 'permit-review-7' }], tags: [] }
 await cmd('hiring-view', { id: v.id, views: [view, privateView] })
 await cmd('hiring-view', { id: v.id, views: [view] }, manager)
 assert.equal((await state(manager)).vacancies.find(x => x.id === v.id).hiringViews.length, 1)
 const question = await cmd('question', { text: 'Ready for a screening conversation?', type: 'yes-no' })
 await cmd('job-questions', { id: v.id, questions: [{ question: question.id, required: false }] })
 await cmd('screening-rule', { name: 'Screening entry', vacancy: v.id, question: question.id, when: { equals: 'yes' }, then: { kind: 'route', stage: v.stages[1].id } })
 await cmd('screening-rule', { name: 'Reviewed shift', vacancy: v.id, question: question.id, when: { equals: 'no' }, then: { kind: 'tag', tag: 'shift-reviewed' } })
 const approval = await cmd('request-vacancy-approval', { id: v.id, approver: 'owner@example.test' })
 await cmd('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Review complete' })
 const published = await cmd('publish', { id: v.id })
 await cmd('field-schema', { id: v.id, fields: schema }, manager, 409)
 const draftCandidate = { name: 'Staff prospect', source: 'Direct', consentBasis: 'application', vacancy: v.id }
 await cmd('candidate', draftCandidate, h.owner, 409)
 const staff = await cmd('candidate', { ...draftCandidate, customValues: { [employment]: 'Contract', [years]: 0, [shift]: false } })
 assert.equal(staff.candidate.customValues[years], 0)
 assert.equal(staff.application.customValues[shift], false)
 for (const [field, value] of [[years, 'not a number'], [start, '2026-02-30'], [shift, 'yes'], [employment, 'Intern']]) await cmd('field-values', { application: staff.application.id, values: { [field]: value } }, h.owner, 400)
 await cmd('field-values', { application: staff.application.id, values: { [privateField]: 'permit-review-7' } })
 await cmd('field-values', { application: staff.application.id, values: { [privateField]: 99 } }, manager, 403)
 await cmd('field-values', { application: staff.application.id, values: { [years]: null } })
 assert.equal((await state()).candidates.find(c => c.id === staff.candidate.id).customValues[years], null)
 await cmd('move', { application: staff.application.id, to: v.stages[1].id, reason: 'Ready' }, h.owner, 409)
 await cmd('field-values', { application: staff.application.id, values: { [start]: '2026-12-05' } })
 await cmd('move', { application: staff.application.id, to: v.stages[1].id, reason: 'Required fact recorded' })
 const url = '/jobs/' + published.slug, html = await send(url)
 for (const id of [employment, years, shift, start, privateField]) assert.ok(html.text.includes('name="cf-' + id + '"'))
 const submit = async (values = {}, answer = 'no') => {
  const data = new FormData()
  for (const [name, value] of Object.entries({ name: 'Avery Operator', email: 'avery.fields@example.test', noticeVersion: '1', consent: 'yes', ['q-' + question.id]: answer, ...values })) data.set(name, value)
  data.set('resume', new Blob(['Avery Operator\nWestfield University 2007\nForklift operations and warehouse dispatch.'], { type: 'text/plain' }), 'operator.txt')
  return send(url, data)
 }
 assert.equal((await submit()).status, 409, 'initial-stage requirements govern plain HTML intake')
 assert.equal((await submit({ ['cf-' + employment]: 'Permanent', ['cf-' + years]: 'oops' })).status, 400)
 assert.equal((await submit({ ['cf-' + employment]: 'Permanent' }, 'yes')).status, 409, 'an intake rule cannot skip required stage facts')
 const received = await submit({ ['cf-' + employment]: 'Permanent', ['cf-' + years]: '4.5', ['cf-' + shift]: 'true', ['cf-' + privateField]: 'permit-review-7', ['cf-' + school]: 'Westfield University', ['cf-' + year]: '2007' })
 assert.equal(received.status, 200, received.text)
 let w = await state(), person = w.candidates.find(c => c.email === 'avery.fields@example.test'), app = w.applications.find(a => a.candidate === person.id)
 assert.equal(person.customValues[years], 4.5); assert.equal(app.customValues[shift], true)
 assert.ok(app.tags.includes('shift-reviewed'), 'existing objective rule tags survive field capture')
 assert.ok((await send('/api/lodge/search?q=forklift', undefined, h.owner)).value.results.some(r => r.id === person.id), 'search indexes permitted resume text')
 let filtered = await send(`/api/lodge/views/${v.id}/${view.id}`, undefined, manager)
 assert.equal(filtered.status, 200, JSON.stringify(filtered.value)); assert.deepEqual(filtered.value.applications.map(a => a.id), [app.id])
 await cmd('assign-reviewers', { application: app.id, reviewers: ['fields.reviewer@example.test'] })
 for (const cookie of [reviewer, manager]) {
  assert.ok(!JSON.stringify(await state(cookie)).includes('permit-review-7'))
  assert.equal((await send('/api/lodge/search?q=permit-review-7', undefined, cookie)).value.results.length, 0)
  assert.equal((await send(`/api/lodge/views/${v.id}/${privateView.id}`, undefined, cookie)).status, 404)
 }
 const activity = await send('/api/lodge/download/activity/' + person.id, undefined, reviewer)
 assert.equal(activity.status, 200); assert.ok(!activity.text.includes('permit-review-7'))
 const vacancyExport = await send('/api/lodge/download/vacancy/' + v.id, undefined, manager)
 assert.equal(vacancyExport.status, 200); assert.ok(!vacancyExport.text.includes('permit-review-7'))
 const bulk = await cmd('bulk-preview', { items: [app.id], action: { kind: 'export' } }, manager)
 assert.equal(bulk.items[0].ok, true); assert.ok(!JSON.stringify(bulk).includes('permit-review-7'))
 const bulkFile = await cmd('bulk-apply', { batch: 'fields-bulk-0001', items: [app.id], action: { kind: 'export' }, previewed: { [app.id]: bulk.items[0].seen } }, manager)
 assert.equal(bulkFile.applied, 1); assert.ok(!JSON.stringify(bulkFile.file).includes('permit-review-7'), 'bulk selection exports inherit typed-field restrictions')

 await cmd('blind-review', { id: v.id, enabled: true, stages: [v.stages[0].id], revealStage: v.stages[2].id }, manager)
 const blind = await state(reviewer), blindApp = blind.applications.find(a => a.id === app.id)
 for (const secret of ['Westfield University', '2007', 'permit-review-7']) {
  assert.ok(!JSON.stringify(blind).includes(secret), 'typed identity and restricted fields stay out of blind reads')
  assert.equal((await send('/api/lodge/search?q=' + encodeURIComponent(secret), undefined, reviewer)).value.results.length, 0)
 }
 assert.ok(blindApp.resumeText.includes('Forklift'))
 const original = w.documents.find(d => d.application === app.id)
 assert.equal((await send('/api/lodge/download/document/' + original.id, undefined, reviewer)).status, 404)
 // Generic employer-defined CSV headers, with candidate/application/requisition types.
 await cmd('unpublish', { id: v.id, reason: 'Review import mapping and field changes' })
 const pkg = { filename: 'typed-workable.zip', fieldTemplate: v.id, base64: zip([
  { name: 'jobs.csv', bytes: Buffer.from('id,title,Cost center\n901,Imported operations,OPS-901\n') },
  { name: 'candidates.csv', bytes: Buffer.from('id,job_id,name,email,stage,Preferred arrangement,Years handling,Shift ready,Available on,Private detail,School attended,Graduation year\n801,901,Imported Operator,imported.fields@example.test,Applied,Permanent,6,false,2026-12-10,import-private-8,Lake College,2009\n') },
 ]).toString('base64') }
 const beforeImport = await hiringRows(h)
 const preview = await send('/api/lodge/import/preview', pkg, h.owner)
 assert.equal(preview.status, 200, JSON.stringify(preview.value)); assert.deepEqual(await hiringRows(h), beforeImport)
 await cmd('field-schema', { id: v.id, fields: schema.map(f => f.id === years ? { ...f, name: 'Handling duration' } : f) })
 assert.equal((await send('/api/lodge/import/commit', { ...pkg, fingerprint: preview.value.plan.fingerprint }, h.owner)).status, 409, 'schema mapping changes invalidate the preview')
 await cmd('field-schema', { id: v.id, fields: schema })
 const refreshed = await send('/api/lodge/import/preview', pkg, h.owner)
 assert.equal(refreshed.status, 200)
 const committed = await send('/api/lodge/import/commit', { ...pkg, fingerprint: refreshed.value.plan.fingerprint }, h.owner)
 assert.equal(committed.status, 200, JSON.stringify(committed.value)); assert.equal(committed.value.job.state, 'completed')
 w = await state()
 const imported = w.vacancies.find(j => j.id === 'workable:job:901'), importedApp = w.applications.find(a => a.vacancy === imported.id), importedPerson = w.candidates.find(c => c.id === importedApp.candidate)
 const ikey = name => imported.customSchema.find(f => f.name === name).id
 assert.equal(imported.status, 'imported'); assert.equal(importedApp.status, 'imported'); assert.equal(importedPerson.consent.talentPool, false)
 assert.equal(imported.customValues[ikey('Requisition cost center')], 'OPS-901')
 assert.equal(importedPerson.customValues[ikey('Handling years')], 6)
 assert.equal(importedApp.customValues[ikey('Shift available')], false)
 assert.equal(importedApp.customValues[ikey('Private screening detail')], 'import-private-8')
 assert.ok(imported.customSchema.every(f => f.id.startsWith(imported.id + ':')))
 const managerBox = await cmd('sandbox-create', { name: 'Scoped manager field view', vacancy: v.id, mode: 'historical', samples: [{ application: staff.application.id }] }, manager)
 await cmd('sandbox-edit', { id: managerBox.id, edits: [{ op: 'hiring-view', input: { views: [{ ...view, name: 'Manager reviewed operators' }] } }] }, manager)
 const scopedPreview = await cmd('sandbox-preview', { id: managerBox.id }, manager)
 assert.ok(!JSON.stringify(scopedPreview).includes('permit-review-7'), 'preview strings cannot disclose a restricted view predicate')
 assert.ok(!JSON.stringify((await state(manager)).sandboxes).includes('permit-review-7'))
 // OPS-003 trials retain live facts and deploy only the reviewed configuration.
 const box = await cmd('sandbox-create', { name: 'Field scope trial', vacancy: v.id, mode: 'historical', samples: [{ application: staff.application.id, move: { to: v.stages[2].id, reason: 'Trial required-field entry' } }] })
 const nextSchema = [...schema, { id: 'travel', name: 'Travel mode', record: 'application', type: 'choice', choices: ['Local', 'Travel'], restricted: false, identity: null, requiredStages: [v.stages[2].id] }]
 const nextView = { ...view, name: 'Reviewed permanent operators' }
 await cmd('sandbox-edit', { id: box.id, edits: [{ op: 'field-schema', input: { fields: nextSchema } }, { op: 'hiring-view', input: { views: [nextView, privateView] } }] })
 const beforeTrial = await hiringRows(h)
 let trial = await cmd('sandbox-preview', { id: box.id })
 assert.deepEqual(await hiringRows(h), beforeTrial, 'preview changes no live hiring facts')
 assert.match(trial.impact.outcomes[0].error, /Travel mode/)
 assert.ok(JSON.stringify(trial.impact).includes('Travel mode'), 'preview explains required-field configuration impacts')
 await cmd('sandbox-deploy', { id: box.id, token: 'unreviewed', confirmProduction: true }, h.owner, 409)
 await cmd('field-values', { application: staff.application.id, values: { [years]: 2 } })
 await cmd('sandbox-deploy', { id: box.id, token: trial.token, confirmProduction: true }, h.owner, 409)
 trial = await cmd('sandbox-preview', { id: box.id })
 await cmd('sandbox-deploy', { id: box.id, token: trial.token, confirmProduction: true })
 let live = (await state()).vacancies.find(j => j.id === v.id)
 assert.equal(live.customSchema.find(f => f.name === 'Travel mode').requiredStages[0], v.stages[2].id)
 assert.equal(live.hiringViews.find(view => view.id === 'permanent').name, nextView.name)
 await cmd('sandbox-rollback', { id: box.id })
 live = (await state()).vacancies.find(j => j.id === v.id)
 assert.deepEqual(live.customSchema, schema); assert.deepEqual(live.hiringViews, [view, privateView])
 assert.ok((await send('/api/lodge/search?q=OPS-410', undefined, h.owner)).value.results.some(r => r.kind === 'vacancy' && r.id === v.id), 'requisition custom values are searchable')
 await cmd('correct-candidate', { ...person, id: person.id, talentPool: true, reason: 'Candidate agreed to future roles' })
 assert.ok((await send('/api/lodge/talent?q=forklift', undefined, h.owner)).value.matches.some(r => r.candidate === person.id), 'talent rediscovery indexes the permitted resume')
 const second = await cmd('vacancy', { title: 'Separate warehouse team', manager: 'fields.other@example.test', location: 'Queens, NY', headcount: 1, compensation: { currency: 'USD', min: 5000000, max: 7000000, period: 'year' } })
 await cmd('rubric', { id: second.id, criteria: [{ name: 'Planning', description: 'Plans a warehouse shift' }] })
 await cmd('interview-plan', { id: second.id, plan: [{ name: 'Warehouse discussion', stageName: 'Interview' }] })
 const secondApproval = await cmd('request-vacancy-approval', { id: second.id, approver: 'owner@example.test' })
 await cmd('decide-approval', { id: secondApproval.id, version: secondApproval.version, decision: 'approved', reason: 'Separate team approved' })
 await cmd('publish', { id: second.id })
 const secondApp = await cmd('apply', { candidate: person.id, vacancy: second.id, source: 'Candidate requested another role' })
 await cmd('move', { application: secondApp.id, to: second.stages[1].id, reason: 'Second team screened independently' })
 const all = await state(), firstJob = all.vacancies.find(j => j.id === v.id), secondJob = all.vacancies.find(j => j.id === second.id)
 const firstIv = await cmd('interview', { application: app.id, planItem: firstJob.plan[0].id, participants: ['fields.reviewer@example.test'], slots: ['2026-12-15T15:00:00Z'] })
 const secondIv = await cmd('interview', { application: secondApp.id, planItem: secondJob.plan[0].id, participants: ['fields.other@example.test'], slots: ['2026-12-16T15:00:00Z'] })
 const firstTeam = await state(manager), secondTeam = await state(other)
 assert.ok(firstTeam.applications.some(a => a.id === app.id)); assert.ok(!firstTeam.applications.some(a => a.id === secondApp.id))
 assert.ok(secondTeam.applications.some(a => a.id === secondApp.id)); assert.ok(!secondTeam.applications.some(a => a.id === app.id))
 assert.ok(firstTeam.interviews.some(iv => iv.id === firstIv.id)); assert.ok(!firstTeam.interviews.some(iv => iv.id === secondIv.id))
 assert.ok(secondTeam.interviews.some(iv => iv.id === secondIv.id)); assert.ok(!secondTeam.interviews.some(iv => iv.id === firstIv.id))
 assert.ok(!secondTeam.applications.find(a => a.id === secondApp.id).history.some(e => e.reason === 'Required fact recorded'))
 assert.ok(!JSON.stringify(secondTeam.candidates.find(c => c.id === person.id).customValues).includes(employment), 'job-scoped profile fields do not join into a second team')

}

const hiringRows = async h => (await h.db.prepare("SELECT kind,id,value FROM l_records WHERE kind NOT IN ('audit','workflow-sandbox') ORDER BY kind,id").all()).results
