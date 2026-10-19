import { State, type Row } from './lodge/core/state'
import { terms, versionOf, type Subject } from './lodge/records/approvals'
import type { Data } from './lodge/core/types'
import { DEFAULT_REASONS } from './lodge/records/rejections'
import { DELETED, demoAt, easternWeek, pastPanel, storyMorning, workAt, ZONE, type Spread } from './demo-activity'

/** Fernway's people: Maya Torres runs hiring alone for a 60-person Columbus business; all addresses are reserved example domains. */
export const TEAM = {
  dev: 'dev@fernway.example', sam: 'sam@fernway.example', lena: 'lena@fernway.example', ana: 'ana@fernway.example', chris: 'chris@fernway.example',
}

type Seed = [name: string, source: string, days: number, headline?: string]
const L = 'LinkedIn', I = 'Indeed', A = 'Application page', R = 'Referral'

// Product Designer, 46 applications: 9 applied, 7 in the recruiter screen, 4 in panels, 1 at offer and 25 closed,
// from LinkedIn 19, Indeed 12, the application page 11 and referrals 4. `days` is how long since the last move.
const APPLIED: Seed[] = [['Avery Chen', L, 1, 'Product designer · 5 years'], ['Riley Park', I, 2, 'UX designer · 4 years'], ['Taylor Kim', A, 2, 'Product designer · 3 years'], ['Casey Nguyen', R, 3, 'Senior UX designer'], ['Harper Diaz', L, 3], ['Quinn Foster', I, 4], ['Rowan Mehta', L, 5], ['Sasha Ivanova', A, 5], ['Emery Walsh', L, 6]]
const SCREEN: Seed[] = [['Marcus Webb', L, 4, 'Product designer · 7 years'], ['Elena Cruz', I, 5, 'Interaction designer · 6 years'], ['Noah Singh', A, 6, 'Product designer · 4 years'], ['Jamie Park', L, 6, 'UX designer · 5 years'], ['Leah Goldberg', I, 7], ['Omar Haddad', L, 7], ['Grace Liu', A, 8]]
const CLOSED: [name: string, source: string, note: string, closeReason: string, withdrew?: boolean][] = [
  ['Ethan Cole', L, 'No product work in the portfolio; mostly brand and print.', 'skills'], ['Mia Robinson', L, 'Looking for a fully remote role; this one is hybrid in Columbus.', 'availability'], ['Lucas Ward', A, 'Junior for this role; invited to the talent pool.', 'skills'], ['Zoe Bennett', I, 'Pay expectation well above the approved range.', 'pay-expectation'],
  ['Henry Adams', L, 'No research or testing in the work shown.', 'skills'], ['Chloe Rivera', A, 'Accepted another offer before the screen.', 'other-offer', true], ['Jack Morales', I, 'Needs visa sponsorship, which this role cannot offer.', 'work-authorization'], ['Lily Turner', L, 'Portfolio is visual design only.', 'skills'],
  ['Mason Hughes', A, 'Not available until next summer.', 'availability'], ['Ella Price', L, 'Strong screens, little systems work; kept for future roles.', 'skills'], ['Logan Reed', I, 'No response to two scheduling requests.', 'no-show'], ['Aria Coleman', L, 'Junior for this role.', 'skills'],
  ['Wyatt Barnes', A, 'Applied for an engineering role by mistake.', 'skills'], ['Nora Jenkins', R, 'Prefers a contract role.', 'location', true], ['Caleb Perry', L, 'No product work in the portfolio.', 'skills'], ['Hazel Long', I, 'Pay expectation above the approved range.', 'pay-expectation'],
  ['Isaac Powell', A, 'Relocating to Seattle; withdrew.', 'location', true], ['Violet Butler', L, 'Little collaboration with engineering in the work shown.', 'skills'], ['Owen Foster', I, 'Junior for this role.', 'skills'], ['Stella Simmons', A, 'Looking for a fully remote role.', 'availability'],
  ['Levi Bryant', L, 'No research or testing in the work shown.', 'skills'], ['Aurora Gray', I, 'Not authorized to work in the US.', 'work-authorization'], ['Julian Ross', L, 'Mostly marketing site work.', 'skills'], ['Penelope Kelly', A, 'Applied twice; this copy closed as a duplicate.', 'position-closed'], ['Hudson Ford', L, 'Pay expectation above the approved range.', 'pay-expectation'],
]
const REASON_LABELS: Record<string, string> = Object.fromEntries(DEFAULT_REASONS.map(r => [r.id, r.label]))
const PLACES = ['Columbus, OH', 'Dublin, OH', 'Westerville, OH', 'Grandview Heights, OH', 'Worthington, OH', 'Cincinnati, OH', 'Cleveland, OH', 'Pittsburgh, PA']

/** Fernway's hiring workspace on a Monday in October: four open jobs, one awaiting approval, and Thursday's panel to rebook. */
export async function demoRecords(ownerEmail: string, now: Date, spread: Spread): Promise<Row[]> {
  const rows: Row[] = []
  // `done` for the hiring story (arrivals, moves, scorecards, approvals), on working days and in order, at a time of day
  // of its own for each record (`key`), so one day's unrelated events do not share a minute; `ago` for the rest.
  // Days count back from the morning of Thursday's exception, so that morning is the newest history whenever the demo opens.
  const anchor = new Date(storyMorning(now)(8, 0))
  const ago = (days: number) => demoAt(anchor, -days), done = (days: number, key = '') => key ? spread(workAt(anchor, -days), key) : workAt(anchor, -days)
  const week = easternWeek(now)
  const put = (kind: string, id: string, value: Data): Data => {
    const record = { ...value, id }
    rows.push({ kind, id, revision: 'demo-v1', value: record })
    return record
  }
  const maya = ownerEmail, { dev, sam, lena, ana, chris } = TEAM
  put('business', 'main', { name: 'Fernway', accommodationContact: 'Maya Torres · hiring@fernway.example', retentionDays: 365, jurisdiction: 'Fernway · Columbus, Ohio', timeZone: ZONE, notices: [{ version: 1, text: 'Fernway uses your application to assess you for the role you chose. Only the hiring team sees it. We keep unsuccessful applications for one year. Contact hiring@fernway.example for access, corrections, deletion or interview adjustments.', at: done(40) }] })
  for (const [email, name, roles, owner] of [
    [maya, 'Maya Torres', ['admin', 'manager', 'interviewer', 'approver'], true],
    [dev, 'Dev Kapoor', ['manager', 'interviewer'], false],
    [sam, 'Sam Okafor', ['approver'], false],
    [lena, 'Lena Brooks', ['interviewer'], false],
    [ana, 'Ana Ruiz', ['interviewer'], false],
    [chris, 'Chris Lee', ['interviewer'], false],
  ] as const) put('member', email, { email, name, roles, owner, active: true, agent: false })

  const vacancy = (key: string, v: Data, criteria: [string, string][], plan: [string, number, number[]][], stages: string[], status: 'open' | 'draft', createdDaysAgo: number) => {
    const id = 'demo-' + key
    return put('vacancy', id, {
      employmentType: 'full-time', headcount: 1, ...v, status, slug: status === 'open' ? key : undefined,
      stages: stages.map((name, i) => ({ id: `${id}-stage-${i}`, name })),
      rubrics: [{ version: 1, by: v.manager, at: done(createdDaysAgo - 1, id), criteria: criteria.map(([name, description], i) => ({ id: `${id}-criterion-${i}`, name, description })) }],
      plan: plan.map(([name, minutes, focus], i) => ({ id: `${id}-plan-${i}`, name, stage: `${id}-stage-2`, durationMinutes: minutes, criteria: focus.map(c => `${id}-criterion-${c}`) })),
      createdBy: v.manager, createdAt: done(createdDaysAgo, id), publishedAt: status === 'open' ? done(createdDaysAgo - 3, id) : undefined, noticeVersion: 1, hires: 0,
    })
  }
  const designer = vacancy('product-designer', { title: 'Product Designer', department: 'Design', location: 'Columbus, OH', workMode: 'hybrid', manager: dev, compensation: { currency: 'USD', min: 10200000, max: 12400000, period: 'year' }, description: 'Design the tools our customers and warehouse team use every day. Work with Dev Kapoor, two engineers and the people who use what you make.' },
    [['Craft', 'Shows finished product work and explains the decisions behind it.'], ['Systems thinking', 'Builds and extends components and patterns others can reuse.'], ['Collaboration', 'Works a problem through with engineers and product, and changes course on evidence.'], ['Communication', 'Explains trade-offs clearly to people outside design.']],
    [['Portfolio review', 60, [0, 1]], ['Design exercise', 90, [2, 3]]], ['Applied', 'Recruiter screen', 'Panel interview', 'Offer'], 'open', 21)
  const success = vacancy('customer-success-lead', { title: 'Customer Success Lead', department: 'Customer success', location: 'Remote, US', workMode: 'remote', manager: maya, compensation: { currency: 'USD', min: 6800000, max: 8000000, period: 'year' }, description: 'Own our largest wholesale accounts from onboarding to renewal.' },
    [['Account care', 'Describes keeping a difficult account and what changed.'], ['Communication', 'Writes clearly to customers under pressure.']], [['Customer conversation', 45, [0, 1]]], ['Applied', 'Recruiter screen', 'Interview', 'Offer'], 'open', 16)
  const warehouse = vacancy('warehouse-associate', { title: 'Warehouse Associate', department: 'Operations', location: 'Columbus, OH', workMode: 'onsite', manager: maya, compensation: { currency: 'USD', min: 1900, max: 2200, period: 'hour' }, description: 'Pick, pack and ship orders from our Columbus warehouse, Monday to Friday, 7 a.m. to 3:30 p.m.' },
    [['Safety', 'Describes working safely around equipment and stock.'], ['Reliability', 'Explains how they keep to a shift and a pick rate.']], [['Warehouse walk', 30, [0, 1]]], ['Applied', 'Phone screen', 'Interview', 'Offer'], 'open', 12)
  vacancy('marketing-coordinator', { title: 'Marketing Coordinator', department: 'Marketing', location: 'Columbus, OH', workMode: 'hybrid', manager: maya, compensation: { currency: 'USD', min: 5500000, max: 6500000, period: 'year' }, description: 'Run our email calendar, trade shows and product photography.' },
    [['Planning', 'Describes a campaign they planned and shipped on time.'], ['Writing', 'Shares writing they are proud of and why.']], [['Working conversation', 45, [0, 1]]], ['Applied', 'Recruiter screen', 'Interview', 'Offer'], 'open', 6)
  const accountant = vacancy('senior-accountant', { title: 'Senior Accountant', department: 'Finance', location: 'Columbus, OH', workMode: 'hybrid', manager: maya, compensation: { currency: 'USD', min: 7800000, max: 9200000, period: 'year' }, description: 'Close the books monthly and own our sales-tax filings across 30 states.' },
    [['Accounting judgement', 'Walks through a close they ran and a problem they caught.'], ['Systems', 'Explains a process they automated.']], [['Working conversation', 45, [0, 1]]], ['Applied', 'Recruiter screen', 'Interview', 'Offer'], 'draft', 3)

  let n = 0
  const person = (name: string, source: string, sinceDays: number, headline = 'Product designer', basis = source === R ? 'referral' : 'application') => {
    const key = name.toLowerCase().replace(/[^a-z]+/g, '.')
    return put('candidate', 'demo-candidate-' + n, { name, email: key + '@example.com', phone: '', location: PLACES[n++ % PLACES.length], headline, skills: 'Product design, prototyping, usability testing', source, consent: { basis, talentPool: n % 3 === 0, noticeVersion: 1, at: ago(sinceDays), recordedBy: source === R ? maya : 'applicant' }, retainUntil: ago(sinceDays - 365).slice(0, 10), createdAt: ago(sinceDays) })
  }
  /** An application with its received event and, when it moved, the move that brought it to `stage` `days` ago. */
  const apply = (v: Data, c: Data, stage: number, days: number, extra: Data = {}) => {
    const received = days + (stage ? (stage - 1) * 4 + 2 + (n % 3) : 0), id = 'demo-application-' + c.id.slice(15)
    const app = put('application', id, { candidate: c.id, vacancy: v.id, stage: v.stages[stage].id, status: 'active', source: c.source, rubricVersion: 1, reviewers: [], feedbackReleased: false, submittedAt: done(received, id), coverNote: c.source === R ? 'Priya Nair suggested I apply; I would love to design for the people who use Fernway’s tools every day.' : '', ...extra })
    // Applicants send their own applications (from a job board or the application page); Maya enters a referral.
    put('stage-event', id + '-received', { application: id, from: null, to: v.stages[0].id, reason: `Application received (${c.source})`, actor: c.source === R ? maya : 'applicant', at: app.submittedAt })
    put('audit', id + '-audit', { actor: c.source === R ? maya : 'public', email: c.source === R ? maya : 'public', action: 'application-received', record: 'application:' + id, at: app.submittedAt })
    for (let s = 1; s <= stage; s++) put('stage-event', `${id}-moved-${s}`, { application: id, from: v.stages[s - 1].id, to: v.stages[s].id, reason: s === 1 ? 'Relevant product work; moving to the recruiter screen.' : s === 2 ? 'Screen went well; booking the panel.' : 'Panel agreed; preparing the offer.', actor: s === 1 ? maya : dev, at: done(days + (stage - s) * 4, id) })
    return app
  }
  const crit = (v: Data, i: number) => `${v.id}-criterion-${i}`
  /** A submitted scorecard on criteria `on`, each with its written evidence: `daysAgo` for a screen, or the afternoon after its panel. */
  const card = (app: Data, author: string, interview: Data | null, on: [number, number, string][], recommendation: string, daysAgo: number) => {
    const at = interview ? new Date(Date.parse(interview.start) + (interview.durationMinutes + 30 + 25 * (author.length % 5)) * 60000).toISOString() : done(daysAgo, app.id)
    const v = rows.find(r => r.kind === 'vacancy' && r.id === app.vacancy)!.value as Data
    put('scorecard', `${app.id}:${interview?.id ?? 'review'}:${author}`, { application: app.id, interview: interview?.id ?? null, author, rubricVersion: 1, ratings: Object.fromEntries(on.map(([c, r]) => [crit(v, c), r])), evidence: Object.fromEntries(on.map(([c, , e]) => [crit(v, c), e])), recommendation, notes: '', status: 'submitted', updatedAt: at, submittedAt: at })
  }
  const SCREEN_NOTES: [number, number, string][] = [[0, 3, 'Portfolio shows two shipped product flows with the reasoning behind each.']]
  const screeners = [maya, dev, lena]

  APPLIED.forEach(([name, source, days, headline], i) => {
    const app = apply(designer, person(name, source, days, headline), 0, days, { reviewers: screeners })
    for (const author of screeners.slice(0, [2, 1, 0, 1, 0, 1, 0, 0, 0][i])) card(app, author, null, SCREEN_NOTES, 'yes', days / 2)
  })
  SCREEN.forEach(([name, source, days, headline], i) => {
    const app = apply(designer, person(name, source, days + 4, headline), 1, days, { reviewers: screeners })
    for (const author of screeners.slice(0, [2, 2, 1, 1, 2, 0, 1][i])) card(app, author, null, SCREEN_NOTES, 'yes', days - 1)
  })
  CLOSED.forEach(([name, source, note, closeReason, withdrew], i) => {
    const days = 6 + (i % 9), c = person(name, source, days + 5)
    const app = apply(designer, c, 0, days + 5, { status: withdrew ? 'withdrawn' : 'rejected', closedAt: done(days, 'demo-application-' + c.id.slice(15)) })
    put('stage-event', app.id + '-closed', { application: app.id, from: app.stage, to: withdrew ? 'withdrawn' : 'rejected', reason: REASON_LABELS[closeReason], note, closeReason, closeGroup: withdrew ? 'withdrew' : 'rejected', actor: maya, at: app.closedAt })
  })

  // The four panels. Jordan's Panel 1 is done with all three scorecards; Panel 2 is Thursday at 10:00 in Juniper,
  // and Lena Brooks, one of its three panellists, is out sick. Priya's Panel 1 still waits for Lena's scorecard.
  const pd = designer.plan as Data[]
  let tokens = 0
  const interview = (app: Data, key: string, plan: number, participants: string[], slots: string[], status: 'scheduled' | 'proposed', availability: Data = {}) => put('interview', 'demo-interview-' + key, {
    application: app.id, vacancy: designer.id, planItem: pd[plan].id, title: `${pd[plan].name}: Product Designer`, durationMinutes: pd[plan].durationMinutes, participants, slots, availability,
    candidateToken: (++tokens).toString(16).repeat(48), location: 'Juniper room · 1150 Goodale Blvd', timezone: week.zone, status, start: status === 'scheduled' ? slots[0] : undefined,
    createdBy: maya, createdAt: done(9, app.id), ...(status === 'scheduled' ? { scheduledBy: maya, scheduledAt: done(8, app.id) } : {}),
  })
  const jordan = apply(designer, person('Jordan Ellis', R, 13, 'Senior designer · Lakeshore Health'), 2, 8)
  const panel1 = interview(jordan, 'jordan-1', 0, [dev, ana, maya], [pastPanel(anchor, 5, 10)], 'scheduled')
  card(jordan, dev, panel1, [[0, 4, 'Rebuilt Lakeshore’s intake flow; form errors fell by half.'], [1, 4, 'Extended their component library with a form pattern three teams adopted.']], 'strong-yes', 4)
  card(jordan, ana, panel1, [[0, 4, 'Strong, clear screens with the reasoning for each change.'], [1, 2, 'The component library shown was thin; few shared patterns.']], 'yes', 4)
  card(jordan, maya, panel1, [[0, 3, 'Walked through the intake research and what it changed.']], 'yes', 4)
  interview(jordan, 'jordan-2', 1, [lena, dev, maya], [week.at(3, 10)], 'scheduled')

  const priya = apply(designer, person('Priya Raman', I, 12, 'Product designer · 6 years'), 2, 8)
  const priya1 = interview(priya, 'priya-1', 0, [lena, dev, ana], [pastPanel(anchor, 3, 13)], 'scheduled')
  card(priya, dev, priya1, [[0, 3, 'Clear case study on a returns flow; measured the change.'], [1, 3, 'Uses a shared library well; has not built one.']], 'yes', 2)
  card(priya, ana, priya1, [[0, 3, 'Good detail on edge cases in checkout.']], 'yes', 2)

  const devon = apply(designer, person('Devon Price', R, 15, 'UX designer · 5 years'), 2, 10)
  interview(devon, 'devon-1', 0, [dev, ana, maya], [week.at(8, 11)], 'scheduled')
  const liam = apply(designer, person('Liam O’Connor', L, 16, 'Product designer · 4 years'), 2, 11)
  interview(liam, 'liam-1', 0, [dev, ana, maya], [week.at(9, 14), week.at(10, 10)], 'proposed', { [dev]: [0, 1], [ana]: [0] })

  // Naomi's two panels were one day, both done and released; her offer waits for Sam Okafor, the approver.
  const naomi = apply(designer, person('Naomi Fields', I, 24, 'Senior product designer · 8 years'), 3, 3, { feedbackReleased: true })
  const naomi1 = interview(naomi, 'naomi-1', 0, [dev, ana, maya], [pastPanel(anchor, 4, 10)], 'scheduled')
  const naomi2 = interview(naomi, 'naomi-2', 1, [dev, chris, maya], [pastPanel(anchor, 4, 14)], 'scheduled')
  for (const [author, iv] of [[dev, naomi1], [ana, naomi1], [maya, naomi1], [dev, naomi2], [chris, naomi2], [maya, naomi2]] as const) card(naomi, author, iv, [[iv === naomi1 ? 0 : 2, 4, iv === naomi1 ? 'Led a design system used by four product teams; showed the adoption numbers.' : 'Paired with engineering on the exercise and adjusted the plan when constraints changed.']], 'strong-yes', 5)
  put('offer', 'demo-offer', { application: naomi.id, title: 'Product Designer', salary: { amount: 11200000, currency: 'USD', period: 'year' }, startDate: week.date(21), terms: 'Full-time, hybrid in Columbus. Fifteen days paid leave plus holidays. Final terms subject to the signed employment agreement.', status: 'draft', createdBy: maya, createdAt: done(1, naomi.id) })

  // Customer Success Lead and Warehouse Associate have smaller pipelines; Marketing Coordinator was published this week and has none yet.
  const smaller: [Data, Seed, number][] = [
    [success, ['Brianna Scott', L, 2, 'Account manager · 6 years'], 0], [success, ['Derek Owens', A, 3, 'Customer success manager'], 0], [success, ['Fatima Khan', L, 4, 'Customer success lead · 4 years'], 1], [success, ['Gabriel Ortiz', I, 5, 'Support lead'], 1], [success, ['Hannah Wells', R, 6, 'Account director'], 2],
    [warehouse, ['Andre Thomas', I, 1, 'Warehouse associate · 3 years'], 0], [warehouse, ['Carmen Lopez', I, 1, 'Picker and packer'], 0], [warehouse, ['Darnell Hayes', A, 2, 'Forklift certified'], 0], [warehouse, ['Erin Murphy', I, 3, 'Shipping clerk'], 1], [warehouse, ['Frank Nguyen', A, 3, 'Inventory associate'], 1], [warehouse, ['Gina Russo', I, 4, 'Warehouse lead'], 2],
  ]
  for (const [v, [name, source, days, headline], stage] of smaller) apply(v, person(name, source, days + 2, headline), stage, days, { reviewers: [maya] })

  // Owen asked to be deleted after withdrawing; Ben is a past talent-pool contact now past the retention date.
  const owen = put('candidate', DELETED, { name: 'Owen Hart', email: 'owen.hart@example.com', phone: '', location: 'Cincinnati, OH', headline: 'Account manager · 8 years', skills: 'Wholesale accounts, renewals', source: A, consent: { basis: 'application', talentPool: false, noticeVersion: 1, at: ago(18), recordedBy: 'applicant' }, retainUntil: ago(-347).slice(0, 10), createdAt: ago(18) })
  const withdrawn = put('application', 'demo-application-owen', { candidate: owen.id, vacancy: success.id, stage: success.stages[0].id, status: 'active', source: A, rubricVersion: 1, reviewers: [], feedbackReleased: false, submittedAt: ago(18), coverNote: '' })
  put('stage-event', withdrawn.id + '-received', { application: withdrawn.id, from: null, to: success.stages[0].id, reason: 'Application received (Application page)', actor: 'applicant', at: withdrawn.submittedAt })
  put('candidate', 'demo-candidate-ben', { name: 'Ben Carter', email: 'ben.carter@example.com', phone: '', location: 'Columbus, OH', headline: 'Office manager · 6 years', skills: 'Facilities, purchasing, events', source: A, consent: { basis: 'talent-pool', talentPool: true, at: ago(368), recordedBy: maya }, retainUntil: ago(3).slice(0, 10), createdAt: ago(368) })

  put('message', 'demo-message', { application: jordan.id, purpose: 'interview-invitation', to: 'jordan.ellis@example.com', subject: 'Your Panel 2 design exercise at Fernway', body: 'Hi Jordan,\nThank you for Panel 1. We would love to invite you to the design exercise with Lena, Dev and me in the Juniper room.\nBest,\nMaya Torres\nHead of Operations, Fernway', draftedBy: maya, draftedAt: done(7, jordan.id), downloads: [] })
  const state = new State(rows)
  for (const [kind, id, status, by] of [['vacancy', designer.id, 'approved', sam], ['vacancy', success.id, 'approved', sam], ['vacancy', warehouse.id, 'approved', sam], ['vacancy', 'demo-marketing-coordinator', 'approved', sam], ['vacancy', accountant.id, 'pending', sam], ['offer', 'demo-offer', 'pending', sam], ['message', 'demo-message', 'approved', maya]] as const) {
    const record = state.get(kind, id), key = kind === 'vacancy' ? id : record.application
    const decided = kind === 'vacancy' ? (record.createdAt < done(10) ? 17 : 4) : 6
    put('approval', id + '-approval', { subjectKind: kind as Subject, subjectId: id, version: await versionOf(state, kind, record), terms: terms(state, kind, record), requestedBy: kind === 'vacancy' ? record.manager : maya, approver: by, status, requestedAt: done(status === 'approved' ? decided + 1 : 1, key), ...(status === 'approved' ? { decidedBy: by, decidedAt: done(decided, key), reason: kind === 'message' ? 'Clear and kind; sending from my mailbox.' : 'Within this year’s hiring budget.' } : {}) })
  }
  return rows
}
