import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { businessHarness } from './harness.mjs'
import { RANGE } from './hiring-fixture.mjs'

const address = n => ['synthetic-lodge-sourcing-' + n, 'example.test'].join('@')
export const resumePassage = 'Prepared concrete takeoffs using Bluebeam for a six-unit project.'
export const templateInput = vacancy => ({ vacancy, name: 'Synthetic pool invitation', language: 'en', subject: 'Explore {job_title}', body: 'Hello {candidate_name}, would you like to discuss this role with {business_name}?', reviewed: true })

/** All facts and permissions originate through native hiring commands. */
export async function sourcingCase(run, ownerEmail, suffix = '') {
  let job = await run('vacancy', { title: 'Synthetic sourcing role' + suffix, location: 'Denver, CO', manager: ownerEmail, headcount: 1, compensation: RANGE })
  await run('rubric', { id: job.id, criteria: [{ name: 'Takeoffs', description: 'Describes concrete takeoff work' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Work discussion', stageName: 'Interview' }] })
  const asked = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: asked.id, version: asked.version, decision: 'approved', reason: 'Reviewed role and budget' })
  job = await run('publish', { id: job.id })
  const person = await run('candidate', { name: 'Synthetic prior-pool person' + suffix, email: address('person' + suffix), skills: 'Concrete takeoffs and Bluebeam', headline: 'Estimator', source: 'Direct', consentBasis: 'talent-pool', consentNote: 'Explicit permission for other roles', talentPool: true, vacancy: job.id,
    resume: { name: 'synthetic-lodge-resume.txt', mediaType: 'text/plain', base64: Buffer.from(resumePassage).toString('base64') } })
  await run('move', { application: person.application.id, to: 'rejected', closeReason: 'skills', reason: 'Previous human decision retained' })
  const template = await run('message-template', templateInput(job.id))
  const brief = await run('sourcing-brief', { vacancy: job.id, template: template.id, templateVersion: template.versions.at(-1).version, language: 'en', criteria: [job.rubrics.at(-1).criteria[0].id], reviewed: true })
  return { job, ...person, template, brief }
}
export function sourcingPacket(report, approver) {
  const passage = report.passages.find(p => p.kind === 'document')
  const claims = [{ criterion: report.criteria[0].id, text: resumePassage, source: { kind: passage.kind, id: passage.id, revision: passage.revision, field: passage.field, quote: resumePassage } }]
  return { workflow: 'sourcing-research', brief: report.brief, candidate: report.candidate, sources: report.sources, claims,
    outreach: { subject: report.template.subject, body: report.template.body + '\n\n“' + resumePassage + '”' }, approver }
}

/** A single public-door research and review journey includes allowed and refused privacy paths. */
export async function checkSourcingProposals() {
  let outbound = 0
  const h = await businessHarness({ clock: '2030-10-07T12:00:00.000Z', outboundService: () => { outbound++; return new Response('unexpected outbound', { status: 502 }) } })
  try {
    const ownerEmail = (await h.state()).actor.email, principalEmail = address('principal'), reviewerEmail = address('reviewer'), agentEmail = address('agent')
    const principal = await h.member(principalEmail, ['admin'], 'Synthetic pool principal')
    let reviewer = await h.member(reviewerEmail, ['admin'], 'Synthetic pool reviewer')
    const agent = await h.member(agentEmail, [], 'Synthetic external sourcing agent', { agent: true, actsFor: principalEmail })
    const manager = await h.member(address('manager'), ['manager'], 'Synthetic manager')
    const f = await sourcingCase(h.command, ownerEmail)
    const path = '/api/lodge/sourcing-evidence?brief=' + f.brief.id + '&candidate=' + f.candidate.id
    const evidence = async (who = agent, status = 200) => { const r = await h.send(path, undefined, who); assert.equal(r.status, status, r.text); return r.value }
    const read = () => evidence()
    const draft = async () => sourcingPacket(await read(), reviewerEmail)
    const propose = body => h.command('propose', body, agent)
    const decide = (packet, decision = 'kept', who = reviewer, status = 200) => h.command('decide-proposal', { id: packet.id, decision, reason: 'Review only the native research draft' }, who, status)
    const visible = async packet => (await h.state()).proposals.some(p => p.id === packet.id)
    await evidence(manager, 403)
    assert.equal((await h.send('/api/lodge/command/sourcing-brief', { vacancy: f.job.id, criteria: [], reviewed: true }, agent)).status, 403)
    const restricted = await h.command('document', { candidate: f.candidate.id, kind: 'resume', name: 'synthetic-lodge-restricted.txt', mediaType: 'text/plain', base64: Buffer.from('Synthetic restricted source detail').toString('base64'), restricted: true })
    const report = await read()
    assert.equal(report.passages.some(p => p.id === restricted.id), false, 'restricted resume fields never enter the agent context')
    assert.equal(report.sources.some(p => p.id === restricted.id), false)
    assert.equal(JSON.stringify(report).includes('Synthetic restricted source detail'), false)
    assert.equal((await h.send('/api/lodge/command/sourcing-brief', { vacancy: f.job.id, template: f.template.id, language: 'es', criteria: [f.job.rubrics.at(-1).criteria[0].id], reviewed: true }, h.owner)).status, 409, 'another language is refused without a reviewed version')
    assert.deepEqual(report.permission, { basis: 'talent-pool', talentPool: true, recordedBy: ownerEmail, at: '2030-10-07T12:00:00.000Z', note: 'Explicit permission for other roles', retainUntil: '2031-10-07', contactPreference: 'email' })
    assert.deepEqual(report.criteria.map(c => c.name), ['Takeoffs'])
    assert.equal(report.passages.find(p => p.kind === 'document').text, resumePassage)
    assert.ok(report.sources.every(s => s.revision), 'every source has a native revision')
    const before = await h.state(), mailBefore = (await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n
    const bad = async (edit, status) => { const body = await draft(); edit(body); const r = await h.send('/api/lodge/command/propose', body, agent); assert.equal(r.status, status, r.text) }
    await bad(b => { b.claims[0].source.quote = 'Invented experience at a fictional employer' }, 409)
    await bad(b => { b.claims[0].source.revision = 'synthetic-lodge-stale' }, 409)
    await bad(b => { b.claims[0].text = 'Led a hundred construction projects' }, 400)
    await bad(b => { b.claims[0].source.field = 'customValues' }, 409)
    await bad(b => { b.claims[0].source.quote = 'Their nationality meets the criteria' }, 400)
    await bad(b => { b.claims[0].source.quote = 'Best candidate by suitability score' }, 400)
    await bad(b => { b.claims[0].source.id = restricted.id }, 409)
    await bad(b => { b.score = 99 }, 400)
    await bad(b => { b.outreach.body += ' Has twenty years of experience.' }, 400)
    await bad(b => { b.approver = address('manager') }, 403)
    const candidateBody = await draft(), skills = report.passages.find(p => p.kind === 'candidate' && p.field === 'skills')
    candidateBody.claims = [{ criterion: report.criteria[0].id, text: 'Concrete takeoffs and Bluebeam', source: { kind: 'candidate', id: skills.id, revision: skills.revision, field: 'skills', quote: 'Concrete takeoffs and Bluebeam' } }]
    candidateBody.outreach.body = report.template.body + '\n\n“Concrete takeoffs and Bluebeam”'
    const candidatePacket = await propose(candidateBody)
    assert.equal(candidatePacket.claims[0].source.field, 'skills', 'candidate facts carry the exact native field and revision')
    await decide(candidatePacket)
    const packet = await propose(await draft())
    assert.equal(packet.model, null)
    assert.deepEqual(packet.changes, [])
    assert.equal(packet.claims[0].source.quote, resumePassage)
    assert.equal(packet.research.template.version, 1)
    assert.equal(packet.outreach.body, 'Hello Synthetic prior-pool person, would you like to discuss this role with Example Builders?\n\n“' + resumePassage + '”')
    await decide(packet, 'kept', agent, 403)
    await decide(packet, 'kept', h.owner, 403)
    await decide(packet)
    const exported = await h.send('/api/lodge/download/candidate/' + f.candidate.id, undefined, h.owner)
    assert.equal(exported.status, 200, exported.text)
    assert.ok(exported.value.sourcingPackets.some(p => p.id === packet.id && p.claims[0].text === resumePassage), 'authorized export includes the retained research narrative')
    await decide(packet, 'kept', reviewer, 409)
    const rejected = await propose(await draft()); await decide(rejected, 'rejected')
    for (const key of ['applications', 'vacancies', 'interviews', 'scorecards', 'messages', 'offers', 'sandboxes']) assert.deepEqual((await h.state())[key], before[key], key + ' is unchanged by keep and reject')
    assert.deepEqual((await h.state(manager)).proposals, [])
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, mailBefore, 'keep and reject create no mail handoff')

    // A candidate edit invalidates keeping, while authorized history stays visibly stale.
    const stale = await propose(await draft())
    await h.command('correct-candidate', { ...f.candidate, skills: 'Concrete takeoffs, Bluebeam and site measurement', reason: 'Correct source facts' })
    assert.equal((await h.state()).proposals.find(p => p.id === stale.id).stale, true)
    await decide(stale, 'kept', reviewer, 409)
    const current = await propose(await draft())
    await h.command('candidate-privacy', { id: f.candidate.id, private: true })
    assert.equal(await visible(current), false, 'lost principal and reviewer source access hides the entire narrative even from the owner')
    await evidence(agent, 404)
    await h.command('candidate-privacy', { id: f.candidate.id, private: false })
    await h.command('vacancy-privacy', { id: f.job.id, confidential: true, namedPeople: [] })
    assert.equal(await visible(current), false, 'confidential source application revokes the complete packet')
    await evidence(agent, 404)
    await h.command('vacancy-privacy', { id: f.job.id, confidential: false })
    // Existing source grants are still insufficient for a field outside the native allowlist.
    const freshBrief = async () => h.command('sourcing-brief', { vacancy: f.job.id, template: f.template.id, templateVersion: f.template.versions.at(-1).version, language: 'en', criteria: [f.job.rubrics.at(-1).criteria[0].id], reviewed: true })
    // Privacy edits revise the role; select its current criteria again.
    f.brief = await freshBrief()
    const nextPath = () => '/api/lodge/sourcing-evidence?brief=' + f.brief.id + '&candidate=' + f.candidate.id
    const freshDraft = async () => sourcingPacket((await h.send(nextPath(), undefined, agent)).value, reviewerEmail)
    const consentPacket = await propose(await freshDraft())
    let person = (await h.state()).candidates.find(c => c.id === f.candidate.id)
    await h.command('correct-candidate', { ...person, talentPool: false, reason: 'Withdrawn pool consent' })
    assert.equal(await visible(consentPacket), false)
    assert.deepEqual((await h.send('/api/lodge/download/candidate/' + person.id, undefined, h.owner)).value.sourcingPackets, [], 'export also hides the complete narrative after consent withdrawal')
    await decide(consentPacket, 'kept', reviewer, 404)
    await h.command('correct-candidate', { ...person, talentPool: true, reason: 'Fresh recorded pool permission' })
    await h.command('extend-retention', { candidate: person.id, until: '2030-10-06', reason: 'Retention expired' })
    assert.equal(await visible(consentPacket), false)
    assert.equal((await h.send(nextPath(), undefined, agent)).status, 404)
    await h.command('extend-retention', { candidate: person.id, until: '2031-10-07', reason: 'Renewed retention' })
    const revokedPacket = await propose(await freshDraft())
    await h.command('member', { email: reviewerEmail, name: 'Synthetic pool reviewer', roles: ['manager'] })
    assert.equal(await visible(revokedPacket), false)
    await decide(revokedPacket, 'kept', reviewer, 404)
    await h.command('member', { email: reviewerEmail, name: 'Synthetic pool reviewer', roles: ['admin'] })
    reviewer = await h.signIn(reviewerEmail)
    await h.command('member', { email: principalEmail, name: 'Synthetic pool principal', roles: ['manager'] })
    assert.equal(await visible(revokedPacket), false)
    assert.equal((await h.send(nextPath(), undefined, agent)).status, 403)
    await h.command('member', { email: principalEmail, name: 'Synthetic pool principal', roles: ['admin'] })
    const credentialPacket = await propose(await freshDraft())
    await h.command('member', { email: agentEmail, name: 'Synthetic external sourcing agent', roles: [], agent: true, actsFor: principalEmail, active: false })
    assert.equal(await visible(credentialPacket), false, 'revoking the preparing agent hides its retained narrative')
    assert.equal((await h.send(nextPath(), undefined, agent)).status, 403)
    await h.command('member', { email: agentEmail, name: 'Synthetic external sourcing agent', roles: [], agent: true, actsFor: principalEmail, active: true })
    const templatePacket = await propose(await freshDraft())
    await h.command('message-template', { ...templateInput(f.job.id), id: f.template.id, version: 1, body: 'Hello {candidate_name}, may we discuss the recorded role?' })
    await decide(templatePacket, 'kept', reviewer, 409)
    assert.equal((await h.state()).proposals.find(p => p.id === templatePacket.id).research.template.version, 1, 'old packet retains exact reviewed language provenance')
    await h.restart(); await h.setTime('2030-10-07T12:00:00.000Z')
    assert.equal((await h.state()).proposals.find(p => p.id === packet.id).status, 'kept')
    const erased = await h.send('/api/lodge/delete-candidate', { candidate: person.id, confirm: person.name, reason: 'Erase retained research and quotations' }, h.owner)
    assert.equal(erased.status, 200, erased.text)
    assert.ok(erased.value.counts.proposal >= 6)
    assert.deepEqual((await h.state()).proposals, [])
    const rows = (await h.db.prepare('SELECT value FROM l_records').all()).results
    assert.equal(rows.some(row => row.value.includes(resumePassage)), false, 'retained quotations and source bytes are erased')
    assert.equal((await h.send('/api/lodge/command/propose', await sourcingPacket(report, reviewerEmail), agent)).status, 404, 'replayed capture cannot resurrect an erased person')

    assert.equal(outbound, 0, 'research and reviews make zero provider calls')
  } finally { await h.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkSourcingProposals()
