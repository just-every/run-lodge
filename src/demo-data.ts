import { State, type Row } from './lodge/core/state'
import { terms, versionOf, type Subject } from './lodge/records/approvals'
import type { Data } from './lodge/core/types'
import { DELETED, demoAt } from './demo-activity'

/** A small, connected hiring workspace; all addresses are reserved example domains. */
export async function demoRecords(ownerEmail: string, now: Date): Promise<Row[]> {
  const rows: Row[] = []
  const at = (days: number) => demoAt(now, days)
  const put = (kind: string, id: string, value: Data): Data => {
    const record = { ...value, id }
    rows.push({ kind, id, revision: 'demo-v1', value: record })
    return record
  }
  const manager = 'maya@northline.example', reviewer = 'leo@northline.example'
  put('business', 'main', { name: 'Lodge', accommodationContact: 'Maya Chen · hiring@northline.example', retentionDays: 365, jurisdiction: 'Northline Studio · Portland, Oregon', notices: [{ version: 1, text: 'Northline Studio uses your application to assess you for the role you chose. Only the hiring team sees it. We keep unsuccessful applications for one year. Contact hiring@northline.example for access, corrections, deletion or interview adjustments.', at: at(-30) }] })
  for (const [email, name, roles, owner] of [
    [ownerEmail, 'Alex Morgan', ['admin', 'manager', 'interviewer', 'approver'], true],
    [manager, 'Maya Chen', ['manager', 'interviewer'], false],
    [reviewer, 'Leo Martinez', ['interviewer'], false],
    ['priya@northline.example', 'Priya Shah', ['approver'], false],
  ] as const) put('member', email, { email, name, roles, owner, active: true, agent: false })
  const vacancies = [
    ['designer', 'Product Designer', 'Design', 9500000, 12000000, 'Shape accessible tools for independent businesses. Work with customers, engineers and our small design team.', ['Research', 'Interaction design']],
    ['engineer', 'Full Stack Engineer', 'Engineering', 11500000, 14500000, 'Build reliable web applications and take features from customer conversation to production.', ['Engineering judgement', 'Collaboration']],
    ['operations', 'Studio Operations Coordinator', 'Operations', 6000000, 7500000, 'Keep a distributed studio organized, improve onboarding and help our team do thoughtful work.', ['Organisation', 'Communication']],
  ].map(([key, title, department, min, max, description, focus], index) => {
    const id = 'demo-' + key
    return put('vacancy', id, { title, department, location: 'Portland, OR', workMode: 'hybrid', employmentType: 'full-time', description, compensation: { currency: 'USD', min, max, period: 'year' }, headcount: 1, manager, status: index === 2 ? 'draft' : 'open', slug: index === 2 ? undefined : String(key), stages: ['Applied', 'Screen', 'Interview', 'Decision'].map((name, i) => ({ id: id + '-stage-' + i, name })), rubrics: [{ version: 1, by: manager, at: at(-20), criteria: (focus as string[]).map((name, i) => ({ id: id + '-criterion-' + i, name, description: 'Describe a specific example from your past work and explain the choices you made.' })) }], plan: [{ id: id + '-plan', name: 'Working conversation', stage: id + '-stage-2', durationMinutes: 45, criteria: [id + '-criterion-0', id + '-criterion-1'] }], createdBy: manager, createdAt: at(-24 + index), publishedAt: index === 2 ? undefined : at(-18), noticeVersion: 1, hires: 0 })
  })
  const candidates = [
    ['Samira Patel', 'samira.patel', 'Product designer · 6 years', 'Customer interviews, prototyping, accessible design systems'],
    ['Daniel Brooks', 'daniel.brooks', 'UX designer · 4 years', 'Interaction design, research synthesis, service design'],
    ['Elena Torres', 'elena.torres', 'Senior product designer', 'Design systems, usability studies, cross-functional delivery'],
    ['Jordan Kim', 'jordan.kim', 'Full stack engineer · 5 years', 'TypeScript, React, SQL, observability'],
    ['Amara Okafor', 'amara.okafor', 'Software engineer · 7 years', 'Distributed systems, accessible frontends, mentoring'],
    ['Noah Williams', 'noah.williams', 'Product engineer · 3 years', 'Node.js, testing, customer support tooling'],
    ['Sofia Rossi', 'sofia.rossi', 'Operations coordinator · 5 years', 'Scheduling, onboarding, vendor management'],
    ['Oliver Grant', 'oliver.grant', 'Studio manager · 4 years', 'Team operations, documentation, procurement'],
  ]
  const applications = candidates.slice(0, 6).map(([name, key, headline, skills], i) => {
    const candidate = put('candidate', 'demo-candidate-' + i, { name, email: key + '@example.com', phone: '', location: i % 2 ? 'Portland, OR' : 'Vancouver, WA', headline, skills, source: i % 2 ? 'Referral' : 'Application page', consent: { basis: 'application', talentPool: true, noticeVersion: 1, at: at(-12 + i), recordedBy: 'applicant' }, retainUntil: at(353 + i).slice(0, 10), createdAt: at(-12 + i) })
    const vacancy = vacancies[i < 3 ? 0 : 1], stage = Math.min(i % 3 + 1, 3)
    const app = put('application', 'demo-application-' + i, { candidate: candidate.id, vacancy: vacancy.id, stage: vacancy.stages[stage].id, status: 'active', source: candidate.source, rubricVersion: 1, reviewers: [ownerEmail, reviewer], feedbackReleased: i === 2, submittedAt: at(-12 + i), coverNote: 'I enjoy working closely with a small team and would love to discuss how my experience could help Northline.' })
    put('stage-event', app.id + '-received', { application: app.id, from: null, to: vacancy.stages[0].id, reason: 'Application received (' + candidate.source + ')', actor: 'applicant', at: app.submittedAt })
    put('stage-event', app.id + '-reviewed', { application: app.id, from: vacancy.stages[0].id, to: app.stage, reason: 'Relevant experience reviewed; moving to the agreed next stage.', actor: manager, at: at(-6 + i / 2) })
    put('audit', app.id + '-audit', { actor: manager, email: manager, action: 'application-received', record: 'application:' + app.id, at: app.submittedAt })
    return app
  })
  for (let i = 6; i < candidates.length; i++) {
    const [name, key, headline, skills] = candidates[i]
    put('candidate', 'demo-candidate-' + i, { name, email: key + '@example.com', phone: '', location: 'Portland, OR', headline, skills, source: 'Referral', consent: { basis: 'talent-pool', talentPool: true, at: at(-8), recordedBy: manager }, retainUntil: at(357).slice(0, 10), createdAt: at(-8) })
  }
  // Marcus later withdrew and asked to be deleted; Ben is a past talent-pool contact now past the retention date.
  const marcus = put('candidate', DELETED, { name: 'Marcus Lee', email: 'marcus.lee@example.com', phone: '', location: 'Seattle, WA', headline: 'Product designer · 8 years', skills: 'Brand systems, illustration', source: 'Application page', consent: { basis: 'application', talentPool: false, noticeVersion: 1, at: at(-18), recordedBy: 'applicant' }, retainUntil: at(347).slice(0, 10), createdAt: at(-18) })
  const withdrawn = put('application', 'demo-application-6', { candidate: marcus.id, vacancy: vacancies[0].id, stage: vacancies[0].stages[0].id, status: 'active', source: marcus.source, rubricVersion: 1, reviewers: [ownerEmail, reviewer], feedbackReleased: false, submittedAt: at(-18), coverNote: 'I would love to bring brand and illustration craft to Northline’s product work.' })
  put('stage-event', withdrawn.id + '-received', { application: withdrawn.id, from: null, to: vacancies[0].stages[0].id, reason: 'Application received (Application page)', actor: 'applicant', at: withdrawn.submittedAt })
  put('audit', withdrawn.id + '-audit', { actor: manager, email: manager, action: 'application-received', record: 'application:' + withdrawn.id, at: withdrawn.submittedAt })
  put('candidate', 'demo-candidate-9', { name: 'Ben Carter', email: 'ben.carter@example.com', phone: '', location: 'Portland, OR', headline: 'Office manager · 6 years', skills: 'Facilities, purchasing, events', source: 'Application page', consent: { basis: 'talent-pool', talentPool: true, at: at(-368), recordedBy: manager }, retainUntil: at(-3).slice(0, 10), createdAt: at(-368) })
  for (let i = 0; i < 3; i++) {
    const app = applications[i], v = vacancies[0], start = at(i === 0 ? -1 : 2 + i)
    const iv = put('interview', 'demo-interview-' + i, { application: app.id, vacancy: v.id, planItem: v.plan[0].id, title: 'Working conversation: Product Designer', durationMinutes: 45, participants: [ownerEmail, reviewer], slots: [start, at(4 + i)], availability: { [ownerEmail]: [0], [reviewer]: [0], candidate: [0, 1] }, candidateToken: String(i + 1).repeat(48), location: 'Northline Studio · meeting room 2', timezone: 'America/Los_Angeles', status: i === 2 ? 'proposed' : 'scheduled', start: i === 2 ? undefined : start, createdBy: manager, createdAt: at(-4), scheduledBy: manager, scheduledAt: at(-3) })
    if (i === 0) put('scorecard', `${app.id}:${iv.id}:${reviewer}`, { application: app.id, interview: iv.id, author: reviewer, rubricVersion: 1, ratings: { [v.rubrics[0].criteria[0].id]: 4, [v.rubrics[0].criteria[1].id]: 3 }, evidence: { [v.rubrics[0].criteria[0].id]: 'Explained how five customer interviews changed the onboarding flow and reduced confusion.', [v.rubrics[0].criteria[1].id]: 'Walked through keyboard navigation and testing with a screen reader.' }, recommendation: 'yes', notes: 'Discuss collaboration with engineering in the next conversation.', status: 'submitted', updatedAt: at(-0.5), submittedAt: at(-0.5) })
  }
  const reviewed = applications[2], rubric = vacancies[0].rubrics[0]
  put('scorecard', `${reviewed.id}:review:${ownerEmail}`, { application: reviewed.id, interview: null, author: ownerEmail, rubricVersion: 1, ratings: { [rubric.criteria[0].id]: 3, [rubric.criteria[1].id]: 4 }, evidence: { [rubric.criteria[0].id]: 'Connected customer interviews to a clear change in product direction.', [rubric.criteria[1].id]: 'Showed a practical, accessible component library used by three engineering teams.' }, recommendation: 'yes', notes: 'Ready for the final discussion about the role.', status: 'submitted', updatedAt: at(-1), submittedAt: at(-1) })
  const app = applications[2]
  put('offer', 'demo-offer', { application: app.id, title: 'Product Designer', salary: { amount: 11000000, currency: 'USD', period: 'year' }, startDate: at(30).slice(0, 10), terms: 'Full-time, hybrid. Twenty days paid leave. Final terms subject to the signed employment agreement.', status: 'draft', createdBy: manager, createdAt: at(-1) })
  put('message', 'demo-message', { application: applications[0].id, purpose: 'interview-invitation', to: candidates[0][1] + '@example.com', subject: 'Your next conversation with Northline Studio', body: 'Hi Samira,\nThank you for sharing your work with us. We would love to invite you to a working conversation with Alex and Leo. Please let Maya know if any adjustments would help.\nBest, Maya', draftedBy: manager, draftedAt: at(-2), downloads: [] })
  const state = new State(rows)
  for (const [kind, id, status] of [['vacancy', vacancies[0].id, 'approved'], ['vacancy', vacancies[1].id, 'approved'], ['vacancy', vacancies[2].id, 'pending'], ['offer', 'demo-offer', 'pending'], ['message', 'demo-message', 'approved']] as const) {
    const record = state.get(kind, id)
    put('approval', id + '-approval', { subjectKind: kind as Subject, subjectId: id, version: await versionOf(state, kind, record), terms: terms(state, kind, record), requestedBy: manager, approver: ownerEmail, status, requestedAt: at(kind === 'vacancy' && status === 'approved' ? -21 : -2), ...(status === 'approved' ? { decidedBy: ownerEmail, decidedAt: at(kind === 'vacancy' ? -19 : -1), reason: 'Reviewed the agreed scope and budget.' } : {}) })
  }
  return rows
}
