import { BUSINESS, harness } from './harness.mjs'

export async function fixture() {
  const h = await harness()
  try {
    const cmd = h.command
    await cmd('business', BUSINESS)
    const manager = await h.member('m1@example.test', ['manager'])
    const otherManager = await h.member('m2@example.test', ['manager'])
    const approver = await h.member('approve@example.test', ['approver'])
    const panel = await h.member('panel@example.test', ['interviewer'])
    const reviewer = await h.member('review@example.test', ['interviewer'])
    const outsider = await h.member('outside@example.test', ['interviewer'])
    const agent = await h.member('agent@example.test', [], 'Agent', { agent: true, actsFor: 'm1@example.test' })
    async function open(title, email, cookie) {
      const v = await cmd('vacancy', { title, location: 'New York', headcount: 1, manager: email, compensation: { currency: 'USD', min: 100, max: 200, period: 'year' } }, cookie)
      await cmd('rubric', { id: v.id, criteria: [{ name: 'Experience', description: 'Explains previous job work' }] }, cookie)
      await cmd('interview-plan', { id: v.id, plan: [{ name: 'Work review', stageName: 'Interview' }] }, cookie)
      const approval = await cmd('request-vacancy-approval', { id: v.id, approver: 'owner@example.test' }, cookie)
      await cmd('decide-approval', { id: approval.id, decision: 'approved', version: approval.version, reason: 'Approved budget' })
      return cmd('publish', { id: v.id }, cookie)
    }
    const vacancy = await open('Protected vacancy', 'm1@example.test', manager)
    const otherVacancy = await open('Other manager vacancy', 'm2@example.test', otherManager)
    const added = await cmd('candidate', { name: 'Integrity Candidate', email: 'private-candidate@example.test', phone: '+15551234567', source: 'Referral', consentBasis: 'referral', consentNote: 'Private consent note', vacancy: vacancy.id }, manager)
    const candidate = added.candidate, app = added.application
    await cmd('assign-reviewers', { application: app.id, reviewers: ['panel@example.test', 'review@example.test'] }, manager)
    const document = await cmd('document', { application: app.id, name: 'ordinary.txt', kind: 'resume', base64: Buffer.from('Ordinary original bytes').toString('base64') }, manager)
    const restricted = await cmd('document', { application: app.id, name: 'CONFIDENTIAL-right-to-work-ID.txt', kind: 'right-to-work', base64: Buffer.from('RESTRICTED-IDENTITY-BYTES').toString('base64') }, manager)
    const interview = await cmd('interview', { application: app.id, planItem: vacancy.plan[0].id, participants: ['panel@example.test'], slots: ['2026-12-01T15:00:00.000Z'], location: 'Private meeting address' }, manager)
    await cmd('availability', { interview: interview.id, slots: [0] }, panel)
    await cmd('schedule', { interview: interview.id, slot: 0 }, manager)
    const note = await cmd('note', { application: app.id, text: 'PRIVATE-NOTE-PASSAGE from my interview' }, panel)
    const card = await cmd('scorecard', { application: app.id, ratings: { [vacancy.rubrics[0].criteria[0].id]: 4 }, evidence: { [vacancy.rubrics[0].criteria[0].id]: 'PRIVATE-SCORECARD-EVIDENCE' }, recommendation: 'yes', submit: true }, panel)
    const message = await cmd('message', { application: app.id, purpose: 'other', subject: 'Private hiring communication', body: 'PRIVATE-CANDIDATE-MESSAGE' }, manager)
    const ma = await cmd('request-message-approval', { id: message.id, approver: 'owner@example.test' }, manager)
    await cmd('decide-approval', { id: ma.id, decision: 'approved', version: ma.version, reason: 'Exact text approved' })
    const offer = await cmd('offer', { application: app.id, title: 'Protected role', salary: { currency: 'USD', amount: 150, period: 'year' }, startDate: '2026-12-10', terms: 'Offer terms' }, manager)
    const oa = await cmd('request-offer-approval', { id: offer.id, approver: 'owner@example.test' }, manager)
    await cmd('decide-approval', { id: oa.id, decision: 'approved', version: oa.version, reason: 'Offer approved' })
    const pendingVacancy = await cmd('vacancy', { title: 'Pending vacancy', location: 'New York', headcount: 1, manager: 'm1@example.test', compensation: vacancy.compensation }, manager)
    await cmd('rubric', { id: pendingVacancy.id, criteria: [{ name: 'Experience', description: 'Previous work' }] }, manager)
    await cmd('interview-plan', { id: pendingVacancy.id, plan: [{ name: 'Call', stageName: 'Interview' }] }, manager)
    const pending = await cmd('request-vacancy-approval', { id: pendingVacancy.id, approver: 'approve@example.test' }, manager)
    const hold = await cmd('hold', { candidate: candidate.id, reason: 'Review hold' })
    const request = await cmd('data-request', { candidate: candidate.id, type: 'access', channel: 'email' })
    const proposal = await cmd('propose', { workflow: 'prepare-vacancy', summary: 'Manager review', approver: 'm1@example.test', sources: [{ kind: 'vacancy', id: pendingVacancy.id }], changes: [{ op: 'vacancy', input: { ...pendingVacancy, description: 'Proposed change' } }] }, agent)
    return { ...h, manager, otherManager, approver, panel, reviewer, outsider, agent, vacancy, otherVacancy, candidate, app, document, restricted, interview, note, card, message, offer, pendingVacancy, pending, hold, request, proposal }
  } catch (e) { await h.close(); throw e }
}
