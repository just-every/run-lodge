import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID, webcrypto } from 'node:crypto'
import { businessHarness } from './harness.mjs'
import initializeAgent from './initialize-agent.mjs'
import prepareFixtures from './agent-phase-fixtures.mjs'
import { createProtocol } from '../src/modules/agent-door/conformance/protocol.mjs'
import { autonomousPolicy, heldPolicy, seconds, signJws, accessToken } from '../src/modules/agent-door/conformance/crypto.mjs'

const method = (family, verb) => [family, verb].join('/')
const address = suffix => ['synthetic-lodge-' + suffix, 'example.invalid'].join(String.fromCharCode(64))
const snapshot = async h => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results

// Disposable verifier-signed Business admission, using the existing native
// fixture and the real Worker. No standalone local credential issuance.
export async function attributionFixture() {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = randomUUID(), issuer = 'https://synthetic-lodge-42.invalid', installationId = randomUUID()
  const h = await businessHarness({ bindings: {
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify({ [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }),
  } })
  try {
    const request = (url, init = {}) => h.mf.dispatchFetch(url, init)
    const ownerRequest = (url, init = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Origin', h.origin); headers.set('Cookie', h.owner)
      return request(url, { ...init, headers: Object.fromEntries(headers) })
    }
    const human = (await h.send('/auth/session', undefined, h.owner)).value.operator
    const email = human.email, iat = seconds(), sub = randomUUID()
    const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
      v: 1, iss: issuer, aud: h.origin, sub: installationId, business: 'synthetic-lodge-42',
      email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1,
      values: {}, logo: null, team: null,
    })
    assert.equal((await h.send('/api/rer/business-settings', { settings })).status, 200)
    const c = createProtocol({ fetch: request, origin: h.origin, surface, points: [],
      signer: { issuer, installationId, kid, privateKey: ring.privateKey },
      person: { email, sub, cookie: h.owner }, business: 'synthetic-lodge-42',
      agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0,
    })
    await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin: h.origin, email })
    const bound = (await h.state()).members.find(row => row.businessAgentId === c.agentId)
    const agentSession = await h.member(bound.email, [], bound.name, { agent: true, actsFor: email, businessAgentId: c.agentId })
    const fixtures = async phase => prepareFixtures({ request: ownerRequest, origin: h.origin, cookie: h.owner, email, phase })
    const persisted = async (kind, id) => {
      const row = await h.db.prepare('SELECT value FROM l_records WHERE kind=? AND id=?').bind(kind, id).first()
      return row && JSON.parse(row.value)
    }
    return { h, c, email, human, fixtures, persisted, agentSession }
  } catch (error) { await h.close(); throw error }
}

export async function attributionDrafts(f, phase = 'autonomous') {
  const { h, c, email } = f
  const fx = await f.fixtures(phase)
  const application = fx.values.debrief.application
  const view = await h.state(), app = view.applications.find(row => row.id === application)
  const criterion = fx.values.debrief.statements[0].criterion
  await h.command('assign-reviewers', { application, reviewers: [email] })
  const evidence = 'Explained a measured takeoff from the original drawings.'
  await h.command('scorecard', { application, ratings: { [criterion]: 3 }, evidence: { [criterion]: evidence }, takeaways: 'Clear factual example.', recommendation: 'yes', submit: true })
  const proposalArgs = {
    workflow: 'coordination', approver: email, summary: 'Synthetic attribution preparation ' + phase,
    sources: [{ kind: 'application', id: application }],
    changes: [{ op: 'interview', input: { application, planItem: view.vacancies.find(row => row.id === app.vacancy).plan[0].id, participants: [email], slots: ['2030-06-12T15:00:00Z'] } }],
    idempotency_key: randomUUID(),
  }
  const proposal = await c.tool('lodge.proposals.prepare', proposalArgs)
  assert.equal(proposal.result?.isError, false, JSON.stringify(proposal.body))
  const inventory = await c.tool('lodge.proposals.list', {})
  const revision = inventory.result.structuredContent.records.find(row => row.id === application).revision
  const card = (await h.state()).scorecards.find(row => row.application === application)
  const debriefArgs = { application, statements: [{ kind: 'evidence', criterion, text: 'The interviewer described a measured takeoff.',
    citations: [{ scorecard: card.id, criterion, field: 'evidence', quote: evidence }] }],
    expected_revision: revision, idempotency_key: randomUUID() }
  const debrief = await c.tool('lodge.debriefs.prepare', debriefArgs)
  assert.equal(debrief.result?.isError, false, JSON.stringify(debrief.body))
  return { application, app, proposal: proposal.result.structuredContent, debrief: debrief.result.structuredContent,
    proposalArgs, debriefArgs, decisions: [proposal.decision, debrief.decision] }
}

export async function checkAgentAttribution() {
  const f = await attributionFixture(), { h, c, email, human, persisted } = f
  try {
    const packets = []
    for (const [phase, policy, disposition] of [['autonomous', autonomousPolicy(), 'autonomous'], ['held', heldPolicy(), 'review']]) {
      await c.adopt(policy)
      const p = await attributionDrafts(f, phase)
      packets.push(p)
      assert.ok(p.decisions.every(row => row.disposition === disposition))
      const expected = { agent: c.agentId, sponsor: human.id, label: 'Agent door conformance for ' + human.displayName }
      for (const [kind, draft] of [['proposal', p.proposal], ['debrief', p.debrief]]) {
        assert.deepEqual(draft.preparation, expected, 'response retains trusted preparation')
        assert.deepEqual((await persisted(kind, draft.id)).preparation, expected, 'D1 stores trusted preparation')
        assert.equal(draft.decidedBy ?? draft.keptBy, undefined, 'preparing cannot attest to a human decision')
      }
      for (const [tool, args] of [['lodge.proposals.prepare', p.proposalArgs], ['lodge.debriefs.prepare', p.debriefArgs]]) {
        const forged = await c.tool(tool, { ...args, idempotency_key: randomUUID(), confirmation: true,
          role: 'owner', preparation: { label: 'Forged human', agent: human.id, sponsor: human.id }, decidedBy: email })
        assert.equal(forged.result?.isError, false, JSON.stringify(forged.body))
        assert.deepEqual(forged.decision.classes, p.decisions[0].classes, 'confirmation flags cannot alter classification')
        assert.equal(forged.decision.disposition, disposition)
        assert.deepEqual(forged.result.structuredContent.preparation, expected, 'caller names and roles confer no attribution')
        assert.equal(forged.result.structuredContent.decidedBy, undefined)
        assert.equal(forged.result.structuredContent.keptBy, undefined)
      }
      const before = await snapshot(h)
      const token = await accessToken(c)
      for (const [op, body] of [['decide-proposal', { id: p.proposal.id, decision: 'approved', reason: 'Agent claims human confirmation' }],
        ['decide-debrief', { id: p.debrief.id, decision: 'keep' }]]) {
        const response = await h.mf.dispatchFetch(h.origin + '/api/lodge/command/' + op, { method: 'POST',
          headers: { Origin: h.origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, confirmed: true }) })
        assert.equal(response.status, 401, 'an MCP bearer cannot authenticate a native browser decision')
        await response.body.cancel()
        assert.equal((await h.send('/api/lodge/command/' + op, { ...body, confirmed: true, role: 'owner' }, f.agentSession)).status, 403, 'a native agent session cannot act as a person')
      }
      assert.deepEqual(await snapshot(h), before, 'confirmation attempts cannot change a native draft or decision')
      // Exact-key retry must retain the original provenance and create no duplicate.
      const replay = await c.tool('lodge.proposals.prepare', p.proposalArgs)
      assert.equal(replay.result.structuredContent.id, p.proposal.id)
      await h.command('decide-proposal', { id: p.proposal.id, decision: 'approved', reason: 'Human reviewed exact preparation' })
      await h.command('decide-debrief', { id: p.debrief.id, decision: 'keep' })
      const after = await h.state()
      assert.equal(after.proposals.find(row => row.id === p.proposal.id).decidedBy, email)
      assert.equal(after.debriefs.find(row => row.id === p.debrief.id).keptBy, email)
      for (const draft of [p.proposal, p.debrief]) {
        const entry = after.activity.find(row => row.draft === draft.id && row.kind.endsWith('-prepared'))
        assert.deepEqual(entry.preparation, expected)
        const decision = after.activity.find(row => row.draft === draft.id && row.kind.endsWith('-decided'))
        assert.equal(decision.actor, email)
        assert.equal(decision.preparation, undefined, 'a human decision remains separate')
      }
      const audit = (await h.send('/api/lodge/audit', undefined, h.owner)).value.events
      assert.ok(audit.some(row => row.record === 'proposal:' + p.proposal.id && row.agent === c.agentId && row.sponsor === human.id && row.preparedBy === expected.label))
      assert.ok(audit.some(row => row.debrief === p.debrief.id && row.preparedBy === expected.label))
      assert.ok(audit.some(row => row.action === 'proposal-applied' && row.record === 'proposal:' + p.proposal.id && row.email === email && !row.agent))
      for (const [path, kind] of [['/download/vacancy/' + p.app.vacancy, 'vacancy'], ['/download/candidate/' + p.app.candidate, 'candidate'], ['/download/activity/' + p.app.candidate, 'activity']]) {
        const download = await h.send('/api/lodge' + path, undefined, h.owner)
        assert.equal(download.status, 200, download.text)
        const body = download.value
        assert.deepEqual(body.activity.find(row => row.draft === p.proposal.id && row.kind === 'proposal-prepared').preparation, expected)
        assert.deepEqual(body.activity.find(row => row.draft === p.debrief.id && row.kind === 'debrief-prepared').preparation, expected)
        if (kind !== 'activity') {
          assert.deepEqual((body.proposals ?? body.proposal).find(row => row.id === p.proposal.id).preparation, expected)
          assert.deepEqual((body.debriefs ?? body.debrief).find(row => row.id === p.debrief.id).preparation, expected)
        }
      }
      console.log('PROBE BASE-AGENT-008 ' + phase + ': signed MCP preparation -> persisted attribution, human-only decisions, scoped activity and downloaded exports')
    }
    await h.restart()
    const bound = (await h.state()).members.find(row => row.businessAgentId === c.agentId)
    await h.command('member', { ...bound, name: 'Changed inactive member label', active: false })
    for (const p of packets) {
      assert.equal((await persisted('proposal', p.proposal.id)).preparation.label, p.proposal.preparation.label)
      assert.equal((await h.state()).activity.find(row => row.draft === p.debrief.id && row.kind === 'debrief-prepared').preparation.label, p.debrief.preparation.label)
    }
    const refused = await c.tool('lodge.proposals.prepare', { ...packets[0].proposalArgs, idempotency_key: randomUUID() })
    assert.equal(refused.result?.isError, true)
    console.log('PROBE BASE-AGENT-008 deactivation: revoked native agent -> no new draft; historical label retained after restart')

    // A job manager can still see the application after losing only a source
    // field or feedback permission. The whole draft and activity must disappear.
    const p = packets[0], readerEmail = address('42-reader')
    const reader = await h.member(readerEmail, ['admin', 'manager'], 'Synthetic Lodge reviewer')
    const originalJob = (await h.state()).vacancies.find(row => row.id === p.app.vacancy)
    await h.command('hiring-team', { id: originalJob.id, recruiters: [readerEmail] })
    const sourceProposal = await h.command('propose', { ...p.proposalArgs, approver: readerEmail, sources: [{ kind: 'candidate', id: p.app.candidate }] })
    assert.ok((await h.state(reader)).activity.some(row => row.draft === sourceProposal.id))
    await h.command('member', { email: readerEmail, name: 'Synthetic Lodge reviewer', roles: ['manager'] })
    const level = await h.command('permission-level', { name: 'Native attribution review without feedback', permissions: ['export', 'contact'] })
    await h.command('job-levels', { id: p.app.vacancy, members: { [readerEmail]: level.id } })
    const scoped = await h.state(reader)
    assert.ok(scoped.applications.some(row => row.id === p.application))
    assert.ok(!scoped.activity.some(row => [sourceProposal.id, p.debrief.id].includes(row.draft)))
    assert.ok(!scoped.debriefs.some(row => row.id === p.debrief.id))
    const beforeDenied = await snapshot(h)
    const deniedBrief = await h.send('/api/lodge/command/decide-debrief', { id: p.debrief.id, decision: 'keep' }, reader)
    assert.equal(deniedBrief.status, 404)
    assert.ok(!deniedBrief.text.includes(p.debrief.statements[0].text))
    assert.deepEqual(await snapshot(h), beforeDenied)
    const exported = await h.send('/api/lodge/download/vacancy/' + p.app.vacancy, undefined, reader)
    assert.equal(exported.status, 200)
    assert.ok(!exported.text.includes(sourceProposal.id) && !exported.text.includes(p.debrief.id))
    await h.command('vacancy-privacy', { id: originalJob.id, confidential: true })
    await h.command('hiring-team', { id: originalJob.id, recruiters: [] })
    await h.command('job-levels', { id: originalJob.id, members: {} })
    assert.ok(!(await h.state(reader)).activity.some(row => row.application === p.application))
    assert.equal((await h.send('/api/lodge/download/vacancy/' + p.app.vacancy, undefined, reader)).status, 404)
    console.log('PROBE BASE-AGENT-008 revocation: source fields, feedback and confidential job access revoked -> drafts, activity and exports unavailable')

    await h.command('move', { application: p.application, to: 'withdrawn', closeReason: 'other-offer', reason: 'Synthetic erasure request' })
    assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: p.app.candidate, confirm: (await h.state()).candidates.find(row => row.id === p.app.candidate).name, reason: 'Synthetic erasure request' }, h.owner)).status, 200)
    for (const id of [p.proposal.id, p.debrief.id, sourceProposal.id]) {
      assert.equal(await persisted(id === p.debrief.id ? 'debrief' : 'proposal', id), null)
      assert.ok(!(await h.state()).activity.some(row => row.draft === id))
    }
    assert.equal((await h.send('/api/lodge/download/activity/' + p.app.candidate, undefined, h.owner)).status, 404)
    await h.command('member', { ...bound, active: true })
    const replay = await c.tool('lodge.proposals.prepare', p.proposalArgs)
    assert.equal(replay.result?.isError, true)
    assert.equal(await persisted('proposal', p.proposal.id), null)
    console.log('PROBE BASE-AGENT-008 erasure: candidate erased -> drafts and quotations removed; replay cannot restore them')
  } finally { await h.close() }
}
