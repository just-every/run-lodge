import type { State } from '../core/state'
import { assignedTo, canSeeScorecard, managesVacancy, requireApplication, requireManages } from '../core/access'
import { now, oneOf, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'

// Flow 9: each interviewer writes their own scorecard against the rubric
// version the application was opened with. Colleagues' scorecards stay hidden
// until the hiring manager releases the feedback.

export const RECOMMENDATIONS = ['strong-no', 'no', 'yes', 'strong-yes'] as const

export function panel(s: State, app: Data) {
  const people = new Set<string>(app.reviewers ?? [])
  for (const iv of s.all('interview')) if (iv.application === app.id && iv.status === 'scheduled') for (const p of iv.participants) people.add(p)
  return [...people]
}

function rubricFor(s: State, app: Data) {
  const vacancy = s.get('vacancy', app.vacancy)
  return vacancy.rubrics.find((r: Data) => r.version === app.rubricVersion)
}

/** Ratings 1-4 per criterion; every rating needs the interviewer's evidence, and blanks stay unanswered. */
function rate(rubric: Data, b: Data) {
  const ratings: Data = {}, evidence: Data = {}
  for (const c of rubric.criteria) {
    const raw = b.ratings?.[c.id]
    const note = optionalText(b.evidence?.[c.id], `Evidence for ${c.name}`, 4000)
    if (raw === undefined || raw === null || raw === '') { ratings[c.id] = null; evidence[c.id] = note; continue }
    const rating = Number(raw)
    requireThat([1, 2, 3, 4].includes(rating), `Rate ${c.name} from 1 to 4`)
    requireThat(note, `Write the evidence behind your rating for ${c.name}`)
    ratings[c.id] = rating; evidence[c.id] = note
  }
  return { ratings, evidence }
}

export function scorecard(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireThat(assignedTo(s, a, app) || managesVacancy(a, s.get('vacancy', app.vacancy)), 'Only the panel writes scorecards', 403)
  requireThat(app.status === 'active', 'This application is closed', 409)
  const interviewId = b.interview ? s.get('interview', b.interview).id : null
  if (interviewId) requireThat(s.get('interview', interviewId).application === app.id, 'That interview belongs to another application')
  const id = `${app.id}:${interviewId ?? 'review'}:${a.email}`
  const existing = s.find('scorecard', id)
  requireThat(!existing || existing.status === 'draft', 'You already submitted this scorecard', 409)
  const rubric = rubricFor(s, app)
  const { ratings, evidence } = rate(rubric, b)
  const submit = b.submit === true
  const recommendation = b.recommendation ? oneOf(b.recommendation, RECOMMENDATIONS, 'Recommendation') : null
  const takeaways = optionalText(b.takeaways, 'Key take-aways', 4000)
  if (submit) requireThat(recommendation, 'Choose a recommendation before submitting')
  if (submit) requireThat(takeaways, 'Write your key take-aways before submitting')
  const record = s.put('scorecard', id, {
    application: app.id, interview: interviewId, author: a.email, rubricVersion: rubric.version, ratings, evidence, recommendation, takeaways,
    notes: optionalText(b.notes, 'Notes', 8000), status: submit ? 'submitted' : 'draft', updatedAt: now(), ...(submit ? { submittedAt: now() } : {}),
  })
  s.audit(a, submit ? 'scorecard-submitted' : 'scorecard-saved', 'application:' + app.id)
  return record
}

/**
 * The panel's scorecards for one application as the reader may see them. Before
 * release a reader learns only who has submitted; after it, every visible card's
 * recommendation, take-aways and ratings side by side by interview, with counts.
 */
export function summary(s: State, app: Data, visible: Data[]) {
  const submitted = new Set(s.all('scorecard').filter(c => c.application === app.id && c.status === 'submitted').map(c => c.author))
  const status = panel(s, app).map(email => ({ email, submitted: submitted.has(email) }))
  if (!app.feedbackReleased) return { released: false, panel: status }
  const cards = latest(visible.filter(c => c.application === app.id && c.status === 'submitted'))
  const interviews = [...new Set(cards.map(c => c.interview))]
  return {
    released: true, panel: status, waiting: status.filter(p => !p.submitted).map(p => p.email),
    counts: Object.fromEntries(RECOMMENDATIONS.map(r => [r, cards.filter(c => c.recommendation === r).length])),
    interviews: interviews.map(id => ({
      interview: id, title: id ? s.find('interview', id)?.title ?? '' : 'Application review',
      cards: cards.filter(c => c.interview === id).map(c => ({ author: c.author, recommendation: c.recommendation, takeaways: c.takeaways ?? '', ratings: c.ratings, corrected: !!c.corrects, version: c.version ?? 1 })),
    })),
  }
}

/** Each card with the version that replaced it, if one did; a correction never changes the card it corrects. */
export function versioned(cards: Data[]): Data[] {
  const next = new Map(cards.filter(c => c.corrects).map(c => [c.corrects, c.id]))
  return cards.map(c => next.has(c.id) ? { ...c, supersededBy: next.get(c.id) } : c)
}

export const latest = (cards: Data[]): Data[] => versioned(cards).filter(c => !c.supersededBy)

/**
 * While the job is open the author files a correction to their submitted card
 * with a reason: a new linked version against the same rubric version. The
 * original stays as submitted; blinding and release are unchanged, and a
 * correction after release tells the hiring manager.
 */
export function correct(s: State, a: Actor, b: Data) {
  const card = s.find('scorecard', b.scorecard)
  requireThat(card && canSeeScorecard(s, a, card), 'Scorecard not found', 404)
  requireThat(card.author === a.email, 'Only its author can correct a scorecard', 403)
  requireThat(card.status === 'submitted', 'Only a submitted scorecard can be corrected; edit the draft instead', 409)
  requireThat(!s.scan('scorecard').some(c => c.corrects === card.id), 'Correct the latest version of this scorecard', 409)
  const app = requireApplication(s, a, card.application), vacancy = s.get('vacancy', app.vacancy)
  requireThat(vacancy.status !== 'closed', 'This job is closed; its scorecards are final', 409)
  const reason = text(b.reason, 'Reason for the correction', 2000)
  const input = { ratings: card.ratings, evidence: card.evidence, recommendation: card.recommendation, takeaways: card.takeaways, notes: card.notes, ...b }
  const { ratings, evidence } = rate(vacancy.rubrics.find((r: Data) => r.version === card.rubricVersion), input)
  const recommendation = oneOf(input.recommendation, RECOMMENDATIONS, 'Recommendation')
  const takeaways = text(input.takeaways, 'Key take-aways', 4000)
  const original = card.original ?? card.id, version = (card.version ?? 1) + 1
  const record = s.put('scorecard', `${original}:v${version}`, {
    application: app.id, interview: card.interview, author: a.email, rubricVersion: card.rubricVersion, ratings, evidence, recommendation, takeaways,
    notes: optionalText(input.notes, 'Notes', 8000), status: 'submitted', submittedAt: now(), updatedAt: now(), original, corrects: card.id, version, correctionReason: reason,
  })
  if (app.feedbackReleased) s.put('notification', uid(), { to: vacancy.manager, kind: 'scorecard-corrected', application: app.id, scorecard: record.id, by: a.email, reason, at: now() })
  s.audit(a, 'scorecard-corrected', 'application:' + app.id, { scorecard: record.id, corrects: card.id, reason, afterRelease: app.feedbackReleased === true })
  return record
}

/** Release colleagues' feedback; early release (before the whole panel submits) needs a reason. */
export function releaseFeedback(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  requireThat(!app.feedbackReleased, 'Feedback is already visible to the panel', 409)
  const submitted = new Set(s.all('scorecard').filter(c => c.application === app.id && c.status === 'submitted').map(c => c.author))
  const waiting = panel(s, app).filter(p => !submitted.has(p))
  const reason = waiting.length ? text(b.reason, `Reason for releasing before ${waiting.join(', ')} submit`, 1000) : optionalText(b.reason, 'Reason', 1000)
  const record = s.put('application', app.id, { ...app, feedbackReleased: true, feedbackReleasedAt: now(), feedbackReleasedBy: a.email })
  s.audit(a, 'feedback-released', 'application:' + app.id, { waiting, reason })
  return record
}

/** Interviewer-supplied notes, private to their author; feedback-packet drafts cite them. */
export function note(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireThat(assignedTo(s, a, app) || managesVacancy(a, s.get('vacancy', app.vacancy)), 'Only the panel keeps interview notes', 403)
  const record = s.put('interview-note', uid(), { application: app.id, interview: b.interview ? s.get('interview', b.interview).id : null, author: a.email, text: text(b.text, 'Notes', 20000), at: now() })
  s.audit(a, 'interview-note', 'application:' + app.id)
  return record
}
