import { checkReminderCadence, checkReminderStops } from './reminders-flow.mjs'
// LDG-013: agent-native workflows through the same API a person uses. The
// "agent" here is a test client signed in as an agent member: Lodge runs no
// model, so there is nothing to fake; these requests are what any coding agent sends.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BUSINESS, harness } from './harness.mjs'

test('LDG-013 agents propose typed changes from versioned sources; a person approves; stale or unsupported proposals fail', async () => {
  const h = await harness()
  try {
    const { command: cmd, send, state, owner } = h
    await cmd('business', BUSINESS)
    const morgan = await h.member('morgan@example.test', ['manager'], 'Morgan Lee')
    const ivy = await h.member('ivy@example.test', ['interviewer'], 'Ivy Chen')
    const agent = await h.member('agent@example.test', [], 'Morgan’s coding agent', { agent: true, actsFor: 'morgan@example.test' })
    const ivyAgent = await h.member('ivy-agent@example.test', [], 'Ivy’s coding agent', { agent: true, actsFor: 'ivy@example.test' })

    // An agent member cannot change anything directly.
    assert.equal((await send('/api/lodge/command/vacancy', { title: 'Direct', manager: 'agent@example.test' }, agent)).status, 403)

    // Prepare the vacancy from the owner's intake: pay was not stated, so it is flagged, not invented.
    const intake = 'We need a second estimator in Brooklyn, start in January. Morgan runs it.'
    const proposal = await cmd('propose', {
      workflow: 'prepare-vacancy', approver: 'morgan@example.test', intake, summary: 'Estimator vacancy from the owner’s intake',
      changes: [
        { op: 'vacancy', input: { title: 'Estimator', location: 'Brooklyn, NY', headcount: 1, manager: 'morgan@example.test', description: 'Prepare bids for residential work.' } },
        { op: 'rubric', input: { id: { $result: 0 }, criteria: [{ name: 'Takeoffs', description: 'Walks through a takeoff they produced' }] } },
        { op: 'interview-plan', input: { id: { $result: 0 }, plan: [{ name: 'Bid review', stageName: 'Interview', durationMinutes: 60 }] } },
      ],
    }, agent)
    assert.deepEqual(proposal.missing, ['compensation range'])
    assert.equal(proposal.model, null, 'no model result is claimed')
    assert.equal((await state()).vacancies.length, 0, 'nothing changes before approval')
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: proposal.id, decision: 'approved', reason: 'ok' }, ivy)).status, 404, 'a hidden proposal does not reveal its approver or status')
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: proposal.id, decision: 'approved', reason: 'mine' }, agent)).status, 403)
    await cmd('decide-proposal', { id: proposal.id, decision: 'approved', reason: 'Matches what we discussed' }, morgan)
    const vacancy = (await state(morgan)).vacancies[0]
    assert.equal(vacancy.compensation, null)
    assert.equal(vacancy.plan[0].stage, vacancy.stages.find(st => st.name === 'Interview').id)
    assert.equal(vacancy.createdBy, 'morgan@example.test', 'changes run as the approver')

    // A proposal prepared from a record that later changes cannot be applied.
    const stale = await cmd('propose', { workflow: 'prepare-vacancy', approver: 'morgan@example.test', summary: 'Tighten the description', sources: [{ kind: 'vacancy', id: vacancy.id }], changes: [{ op: 'vacancy', input: { ...vacancy, description: 'Agent wording' } }] }, agent)
    await cmd('vacancy', { ...vacancy, compensation: { currency: 'USD', min: 7000000, max: 8500000, period: 'year' } }, morgan)
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: stale.id, decision: 'approved', reason: 'ok' }, morgan)).status, 409)
    assert.equal((await state(morgan)).vacancies[0].description, 'Prepare bids for residential work.')

    // Feedback packet: an interviewer's own agent drafts a scorecard citing her notes word for word.
    await cmd('request-vacancy-approval', { id: vacancy.id, approver: (await state()).members.find(m => m.owner).email }, morgan)
    const approval = (await state()).approvals.find(x => x.status === 'pending')
    await cmd('decide-approval', { id: approval.id, decision: 'approved', reason: 'Budgeted', version: approval.currentVersion })
    await cmd('publish', { id: vacancy.id }, morgan)
    const { application } = await cmd('candidate', { name: 'Riley Park', email: 'riley@example.test', source: 'Referral', consentBasis: 'referral', talentPool: true, skills: 'Residential takeoffs, Bluebeam, concrete estimating', vacancy: vacancy.id }, morgan)
    await cmd('assign-reviewers', { application: application.id, reviewers: ['ivy@example.test'] }, morgan)
    const note = await cmd('note', { application: application.id, text: 'Showed a full takeoff for a 6-unit walk-up and explained each quantity.' }, ivy)
    const takeoffs = vacancy.rubrics[0].criteria[0].id
    const draft = (ratings, citations) => send('/api/lodge/command/propose', { workflow: 'feedback-packet', summary: 'Draft from notes', sources: [{ kind: 'interview-note', id: note.id }, { kind: 'application', id: application.id }], changes: [{ op: 'scorecard', input: { application: application.id, ratings, evidence: { [takeoffs]: 'Full takeoff for a 6-unit walk-up' } } }], citations }, ivyAgent)
    assert.equal((await draft({ [takeoffs]: 4 }, [])).status, 400, 'a rating without a cited passage is refused')
    assert.equal((await draft({ [takeoffs]: 4 }, [{ criterion: takeoffs, note: note.id, quote: 'an excellent estimator' }])).status, 400, 'a quote must be exact')
    const packet = await draft({ [takeoffs]: 4 }, [{ criterion: takeoffs, note: note.id, quote: 'full takeoff for a 6-unit walk-up' }])
    assert.equal(packet.status, 200, JSON.stringify(packet.value))
    assert.equal((await send('/api/lodge/command/propose', { workflow: 'feedback-packet', summary: 'x', sources: [{ kind: 'interview-note', id: note.id }], changes: [{ op: 'scorecard', input: { application: application.id, ratings: {}, evidence: {} } }] }, morgan)).status, 404, 'notes are private to their author')
    await cmd('decide-proposal', { id: packet.value.id, decision: 'approved', reason: 'Accurate' }, ivy)
    const card = (await state(ivy)).scorecards[0]
    assert.deepEqual([card.status, card.ratings[takeoffs], card.author], ['draft', 4, 'ivy@example.test'], 'a draft she still edits and submits')

    // Talent-pool rediscovery: factual matches with permission shown, no score; the person chooses.
    const matches = (await send('/api/lodge/talent?q=bluebeam', undefined, owner)).value.matches
    assert.deepEqual(matches.map(m => [m.name, m.matchedFields]), [['Riley Park', ['skills']]])
    const riley = (await state()).candidates.find(c => c.id === application.candidate)
    assert.deepEqual(matches[0].evidence, { skills: riley.skills })
    assert.deepEqual(matches[0].applications, [{ vacancy: vacancy.id, status: 'active' }])
    assert.deepEqual(matches[0].permission, { basis: 'referral', talentPool: true, retainUntil: riley.retainUntil })
    assert.equal(matches[0].score, undefined)
    assert.equal((await send('/api/lodge/talent?q=bluebeam', undefined, morgan)).status, 403)
    assert.equal((await send('/api/lodge/talent?q=bluebeam', undefined, ivy)).status, 403, 'an interviewer cannot search the talent pool')
    const quiet = await cmd('candidate', { name: 'Jo Quiet', source: 'Job fair', consentBasis: 'application', skills: 'Bluebeam' })
    const pool = async () => {
      const response = await send('/api/lodge/talent?q=bluebeam', undefined, owner)
      assert.equal(response.status, 200, JSON.stringify(response.value))
      return response.value.matches
    }
    assert.deepEqual((await pool()).map(m => m.candidate), [riley.id], 'a matching candidate without talent-pool consent is absent')
    assert.equal((await send('/api/lodge/command/propose', { workflow: 'rediscovery', approver: 'morgan@example.test', summary: 'x', sources: [{ kind: 'candidate', id: quiet.candidate.id }], changes: [{ op: 'apply', input: { candidate: quiet.candidate.id, vacancy: vacancy.id, source: 'Talent pool' } }] }, owner)).status, 409, 'no permission to contact, no proposal')

    // A formerly discoverable person disappears as retention, current consent and erasure change.
    const { candidate: former } = await cmd('candidate', { name: 'Ari Former', source: 'Job fair', consentBasis: 'talent-pool', talentPool: true, skills: 'Bluebeam' })
    assert.deepEqual((await pool()).map(m => m.candidate).sort(), [riley.id, former.id].sort())
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    await cmd('extend-retention', { candidate: former.id, until: yesterday, reason: 'Correct the recorded retention deadline' })
    assert.deepEqual((await pool()).map(m => m.candidate), [riley.id], 'a consenting candidate whose retainUntil expired is absent')
    await cmd('extend-retention', { candidate: former.id, until: former.retainUntil, reason: 'Renewed permission to retain' })
    await cmd('correct-candidate', { ...former, talentPool: false, reason: 'Withdrew talent-pool permission' })
    assert.deepEqual((await pool()).map(m => m.candidate), [riley.id], 'rediscovery uses current consent after withdrawal')
    await cmd('correct-candidate', { ...former, talentPool: true, reason: 'Renewed talent-pool permission' })
    assert.deepEqual((await pool()).map(m => m.candidate).sort(), [riley.id, former.id].sort())
    const erased = await send('/api/lodge/delete-candidate', { candidate: former.id, confirm: former.name, reason: 'Asked to be forgotten' }, owner)
    assert.equal(erased.status, 200, JSON.stringify(erased.value))
    assert.deepEqual((await pool()).map(m => m.candidate), [riley.id], 'an erased candidate is absent from rediscovery')

    // Coordination rebooks a panel: cancel the booked interview, book the new time. Two options read the same
    // interview; once one applies, the other is stale.
    const booked = await cmd('interview', { application: application.id, planItem: vacancy.plan[0].id, participants: ['ivy@example.test'], slots: ['2026-10-22T14:00:00.000Z'], timezone: 'America/New_York' }, morgan)
    await cmd('schedule', { interview: booked.id, slot: 0 }, morgan)
    const rebook = (summary, slot) => cmd('propose', {
      workflow: 'coordination', approver: 'morgan@example.test', summary, sources: [{ kind: 'application', id: application.id }, { kind: 'interview', id: booked.id }],
      changes: [
        { op: 'cancel-interview', input: { interview: booked.id, reason: 'Panellist out sick' } },
        { op: 'interview', input: { application: application.id, planItem: vacancy.plan[0].id, participants: ['ivy@example.test'], slots: [slot], timezone: 'America/New_York' } },
        { op: 'schedule', input: { interview: { $result: 1 }, slot: 0 } },
      ],
    }, agent)
    const thursday = await rebook('Rebook Thursday afternoon', '2026-10-22T18:30:00.000Z'), friday = await rebook('Move to Friday', '2026-10-23T14:00:00.000Z')
    await cmd('decide-proposal', { id: thursday.id, decision: 'approved', reason: 'Afternoon works' }, morgan)
    const panels = (await state(morgan)).interviews.filter(i => i.application === application.id)
    assert.deepEqual(panels.map(i => [i.status, i.start ?? null]).sort(), [['cancelled', '2026-10-22T14:00:00.000Z'], ['scheduled', '2026-10-22T18:30:00.000Z']])
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: friday.id, decision: 'approved', reason: 'ok' }, morgan)).status, 409, 'the other option read the interview before it changed')
  } finally { await h.close() }
})

test('COORD-006 a debrief brief quotes released scorecards only, names disagreements and gaps, and never scores or moves the candidate', async () => {
  const h = await harness()
  try {
    const { command: cmd, send, state } = h
    await cmd('business', BUSINESS)
    const morgan = await h.member('morgan@example.test', ['manager'], 'Morgan Lee')
    const panel = {}
    for (const name of ['ivy', 'ian', 'ada']) panel[name] = await h.member(`${name}@example.test`, ['interviewer'], name)
    const agent = await h.member('agent@example.test', [], 'Morgan’s coding agent', { agent: true, actsFor: 'morgan@example.test' })
    const draft = await cmd('vacancy', { title: 'Estimator', location: 'Brooklyn, NY', headcount: 1, manager: 'morgan@example.test', description: 'Prepare bids.', compensation: { currency: 'USD', min: 7000000, max: 8500000, period: 'year' } }, morgan)
    await cmd('rubric', { id: draft.id, criteria: [{ name: 'Takeoffs', description: 'A takeoff they produced' }, { name: 'Site safety', description: 'How they ran safety' }, { name: 'Scheduling', description: 'A schedule they recovered' }] }, morgan)
    await cmd('interview-plan', { id: draft.id, plan: [{ name: 'Bid review', stageName: 'Interview', durationMinutes: 60 }] }, morgan)
    const ownerEmail = (await state()).members.find(m => m.owner).email
    await cmd('request-vacancy-approval', { id: draft.id, approver: ownerEmail }, morgan)
    const approval = (await state()).approvals.find(x => x.status === 'pending')
    await cmd('decide-approval', { id: approval.id, decision: 'approved', reason: 'Budgeted', version: approval.currentVersion })
    await cmd('publish', { id: draft.id }, morgan)
    const vacancy = (await state(morgan)).vacancies[0]
    const [takeoffs, safety, scheduling] = vacancy.rubrics[0].criteria.map(c => c.id)
    const { application } = await cmd('candidate', { name: 'Riley Park', email: 'riley@example.test', source: 'Referral', consentBasis: 'referral', vacancy: vacancy.id }, morgan)
    await cmd('assign-reviewers', { application: application.id, reviewers: ['ivy@example.test', 'ian@example.test', 'ada@example.test'] }, morgan)
    const submit = (who, ratings, evidence, takeaways) => cmd('scorecard', { application: application.id, ratings, evidence, recommendation: 'yes', takeaways, submit: true }, panel[who])
    const ivyCard = await submit('ivy', { [takeoffs]: 4, [safety]: 4 }, { [takeoffs]: 'Walked through a full takeoff for a 6-unit walk-up.', [safety]: 'Ran daily toolbox talks and stopped work on a bad scaffold.' }, 'Strong on quantities; confident with Bluebeam.')
    const ianCard = await submit('ian', { [takeoffs]: 3, [safety]: 1 }, { [takeoffs]: 'Solid takeoff, missed the waste factor once.', [safety]: 'Could not describe a single safety plan he owned.' }, 'Unclear who owned safety on his last job.')
    const adaCard = await submit('ada', { [takeoffs]: 4 }, { [takeoffs]: 'Priced concrete from drawings without help.' }, 'Good estimator for residential work.')

    const q = (card, criterion, quote, field = 'evidence') => ({ scorecard: card.id, field, criterion, quote })
    const good = [
      { kind: 'evidence', criterion: takeoffs, text: 'Every interviewer saw a worked takeoff.', citations: [q(ivyCard, takeoffs, 'full takeoff for a 6-unit walk-up'), q(adaCard, takeoffs, 'Priced concrete from drawings')] },
      { kind: 'agreement', criterion: takeoffs, text: 'Ivy and Ian both rate takeoffs at or above the bar.', citations: [q(ivyCard, takeoffs, 'Walked through a full takeoff'), q(ianCard, takeoffs, 'Solid takeoff')] },
      { kind: 'disagreement', criterion: safety, text: 'Ivy saw site safety owned; Ian did not.', citations: [q(ivyCard, safety, 'stopped work on a bad scaffold'), q(ianCard, safety, 'Could not describe a single safety plan')] },
      { kind: 'gap', criterion: scheduling, text: 'Nobody assessed scheduling.' },
      { kind: 'question', text: 'Who owned safety on the last job?', citations: [q(ianCard, null, 'Unclear who owned safety', 'takeaways')] },
    ]
    const brief = statements => send('/api/lodge/command/debrief', { application: application.id, statements }, agent)

    assert.equal((await brief(good)).status, 409, 'a brief before release is refused')
    await cmd('release-feedback', { application: application.id }, morgan)
    const refused = async (statements, pattern, why) => { const r = await brief(statements); assert.equal(r.status, 400, why); assert.match(r.value.error, pattern, why) }
    await refused(good.filter(x => x.kind !== 'disagreement'), /disagreement on Site safety/, 'the disagreement must be named')
    await refused(good.filter(x => x.kind !== 'gap'), /Scheduling as a criterion nobody assessed/, 'the gap must be named')
    await refused([...good, { kind: 'evidence', criterion: takeoffs, text: 'Best takeoff we have seen.', citations: [] }], /no cited passage/, 'an unsupported statement')
    await refused([...good, { kind: 'evidence', criterion: takeoffs, text: 'Ian found it flawless.', citations: [q(ianCard, takeoffs, 'Flawless takeoff')] }], /exactly as the interviewer wrote/, 'a quote that is not in the card')
    await refused([...good, { kind: 'agreement', criterion: safety, text: 'Everyone liked his safety record.', citations: [q(ivyCard, safety, 'Ran daily toolbox talks'), q(ianCard, safety, 'Could not describe')] }], /do not agree/, 'a false agreement')
    await refused([...good, { kind: 'gap', criterion: takeoffs, text: 'Nobody checked takeoffs.' }], /was assessed/, 'a false gap')
    await refused([...good, { kind: 'evidence', criterion: takeoffs, text: 'Overall a 3.7 average score.', citations: [q(adaCard, takeoffs, 'Priced concrete from drawings')] }], /no combined score or recommendation/, 'a combined score')
    await refused([...good, { kind: 'question', text: 'Is his age a concern for site work?', citations: [q(ianCard, safety, 'Could not describe')] }], /protected trait/, 'a protected-trait reference')
    await refused([...good, { kind: 'evidence', criterion: takeoffs, text: 'Panel views.', citations: [q(adaCard, null, 'Good estimator', 'takeaways')] }], /quote the evidence written for Takeoffs/, 'evidence quotes the criterion’s own evidence')

    const before = (await state(morgan)).applications[0]
    const made = await brief(good)
    assert.equal(made.status, 200, JSON.stringify(made.value))
    assert.equal(made.value.model, null, 'no model result is claimed')
    assert.deepEqual(Object.keys(made.value).filter(k => /score|recommend/i.test(k)), [], 'no combined score or recommendation field')
    assert.deepEqual(made.value.criteria.map(c => [c.name, c.agreement]), [['Takeoffs', 'agree'], ['Site safety', 'disagree'], ['Scheduling', 'unassessed']])
    assert.deepEqual(made.value.statements[2].citations.map(c => [c.author, c.rating]), [['ivy@example.test', 4], ['ian@example.test', 1]], 'each quote links its card and rating')

    // Only the people who run the job (and their agents) see it; interviewers neither see nor write one, and the agent cannot keep it.
    const managerView = await state(morgan)
    assert.equal(managerView.debriefs.length, 1)
    assert.equal((await state(agent)).debriefs.length, 1)
    assert.deepEqual((await state(panel.ivy)).debriefs, [])
    assert.equal((await send('/api/lodge/command/debrief', { application: application.id, statements: good }, panel.ivy)).status, 403)
    assert.equal((await send('/api/lodge/command/decide-debrief', { id: made.value.id, decision: 'keep' }, agent)).status, 403)
    const exported = (await send(`/api/lodge/download/vacancy/${vacancy.id}`, undefined, morgan)).value
    assert.deepEqual(exported.debriefs.map(d => d.id), [made.value.id])
    assert.deepEqual([managerView.applications[0].stage, managerView.applications[0].status, managerView.applications[0].history.length], [before.stage, before.status, before.history.length], 'the brief never moves the candidate')

    // The manager edits under the same checks, then keeps it; a correction to a quoted card marks it out of date.
    const edited = good.filter(x => x.kind !== 'question').map(x => x.kind === 'evidence' ? { ...x, text: 'Two interviewers quote a worked takeoff.' } : x)
    assert.equal((await send('/api/lodge/command/edit-debrief', { id: made.value.id, statements: edited.map(x => x.kind === 'agreement' ? { ...x, text: 'Both recommend him.' } : x) }, morgan)).status, 400)
    await cmd('edit-debrief', { id: made.value.id, statements: edited }, morgan)
    await cmd('correct-scorecard', { scorecard: ianCard.id, reason: 'Waste factor was mine', evidence: { [takeoffs]: 'Solid takeoff with the waste factor.', [safety]: 'Could not describe a single safety plan he owned.' } }, panel.ian)
    const after = (await state(morgan)).debriefs[0]
    assert.deepEqual([after.statements.length, after.stale, after.editedBy], [4, true, 'morgan@example.test'])
    await cmd('decide-debrief', { id: made.value.id, decision: 'keep' }, morgan)
    assert.equal((await send('/api/lodge/command/decide-debrief', { id: made.value.id, decision: 'discard' }, morgan)).status, 409)
    // A fresh brief quotes the corrected card; discarding deletes it.
    const second = (await brief(good.filter(x => x.kind !== 'agreement').map(x => ({ ...x, citations: x.citations?.map(c => ({ ...c, scorecard: c.scorecard === ianCard.id ? `${ianCard.id}:v2` : c.scorecard })) })))).value
    assert.equal((await brief(good)).status, 400, 'the superseded card is no longer quotable')
    await cmd('decide-debrief', { id: second.id, decision: 'discard' }, morgan)
    assert.deepEqual((await state(morgan)).debriefs.map(d => [d.id, d.status]), [[made.value.id, 'kept']])
    // Erasing the candidate (LDG-012) deletes the kept brief with their other records.
    await cmd('move', { application: application.id, to: 'rejected', closeReason: 'skills', reason: 'Went with another estimator' }, morgan)
    const erased = await send('/api/lodge/delete-candidate', { candidate: application.candidate, confirm: 'Riley Park', reason: 'Asked to be forgotten' }, h.owner)
    assert.equal(erased.status, 200, JSON.stringify(erased.value))
    assert.equal(erased.value.counts.debrief, 1)
    assert.deepEqual((await state(morgan)).debriefs, [])
  } finally { await h.close() }
})

test('Persistent reminders deliver on cadence, escalate once and survive restart without stale contact', checkReminderCadence)

test('Reminder stops honor live work and contact, preserve honest failures, and erase personal schedules', checkReminderStops)
