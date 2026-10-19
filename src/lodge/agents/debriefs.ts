import type { State } from '../core/state'
import { canSeeScorecard, managesVacancy, requireApplication } from '../core/access'
import { Fault, now, oneOf, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'
import { latest } from '../records/scorecards'
import { protectedTerm } from '../core/protected'

// COORD-006: a debrief brief for the hiring manager, prepared by their agent
// (or by a person) after feedback release. Lodge runs no model: the brief is the
// author's statements, and Lodge checks each one against the released scorecards
// before keeping it. Every statement quotes an interviewer's own words exactly;
// agreement, disagreement and gaps must match the ratings; nothing carries a
// combined score, a recommendation or a protected trait. The manager edits it and
// keeps or discards it; it never moves the candidate.

export const STATEMENT_KINDS = ['evidence', 'agreement', 'disagreement', 'gap', 'question'] as const
const MIN_QUOTE = 8

// Words a brief never uses, in a statement or a quote: a combined score or a
// recommendation (the panel's own recommendations stay on their scorecards), and
// protected traits (core/protected.ts). Matched case-insensitively as whole words.
const VERDICT = /\b(recommend\w*|strong[\s-]?(yes|no)|overall|average\w*|scor(e|es|ed|ing)|no[\s-]hire|verdict)\b/i

function clean(value: string, label: string) {
  const verdict = value.match(VERDICT), trait = protectedTerm(value)
  requireThat(!verdict, `${label} uses “${verdict?.[0]}”: a brief carries no combined score or recommendation`)
  requireThat(!trait, `${label} refers to “${trait}”: a brief never refers to a protected trait`)
  return value
}

/** Ratings 1–2 are below the bar and 3–4 at or above it; interviewers agree when every rating falls on one side. */
const side = (rating: number) => rating >= 3 ? 'above' : 'below'

/**
 * What the released scorecards say per criterion, as the reader may see them:
 * each latest submitted card's rating with its author, and whether the raters
 * agree (two or more on one side), disagree (both sides), stand alone (one) or
 * nobody assessed it.
 */
export function debriefFacts(s: State, a: Actor, app: Data) {
  const vacancy = s.get('vacancy', app.vacancy)
  const rubric = vacancy.rubrics.find((r: Data) => r.version === app.rubricVersion)
  const cards = latest(s.all('scorecard').filter(c => c.application === app.id && c.status === 'submitted' && canSeeScorecard(s, a, c)))
  return {
    cards,
    criteria: (rubric?.criteria ?? []).map((k: Data) => {
      const ratings = cards.filter(c => typeof c.ratings?.[k.id] === 'number').map(c => ({ author: c.author, scorecard: c.id, rating: c.ratings[k.id] as number }))
      const sides = new Set(ratings.map(r => side(r.rating)))
      const agreement = !ratings.length ? 'unassessed' : ratings.length === 1 ? 'single' : sides.size > 1 ? 'disagree' : 'agree'
      return { criterion: k.id, name: k.name, ratings, agreement }
    }),
  }
}

function released(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  const vacancy = s.get('vacancy', app.vacancy)
  requireThat(managesVacancy(a, vacancy), 'Debrief briefs are for the people who run this job', 403)
  requireThat(app.feedbackReleased === true, 'Feedback is not released yet; a debrief brief reads released scorecards only', 409)
  return { app, vacancy }
}

/** Check every statement against the released cards; return them with each citation resolved to its card, author and revision. */
function checkStatements(s: State, a: Actor, app: Data, raw: unknown) {
  requireThat(Array.isArray(raw) && raw.length > 0 && raw.length <= 60, 'Write between 1 and 60 statements')
  const facts = debriefFacts(s, a, app)
  const criterion = (id: unknown, label: string) => { const k = facts.criteria.find((c: Data) => c.criterion === id); requireThat(k, `${label}: choose a criterion from this application’s rubric`); return k }
  const statements = (raw as Data[]).map((x, i) => {
    const label = `Statement ${i + 1}`
    const kind = oneOf(x?.kind, STATEMENT_KINDS, `${label} kind`)
    const about = kind === 'question' && !x.criterion ? null : criterion(x.criterion, label)
    const said = clean(text(x.text, label, 1000), label)
    const citations = (Array.isArray(x.citations) ? x.citations : []).slice(0, 20).map((c: Data, j: number) => {
      const where = `${label}, citation ${j + 1}`
      const card = facts.cards.find((k: Data) => k.id === c?.scorecard)
      requireThat(card, `${where}: cite a released scorecard on this application, in its latest version`)
      const field = oneOf(c.field ?? 'evidence', ['evidence', 'takeaways'] as const, `${where} field`)
      const on = field === 'evidence' ? criterion(c.criterion ?? about?.criterion, where).criterion : null
      const passage: string = field === 'evidence' ? card.evidence?.[on!] ?? '' : card.takeaways ?? ''
      requireThat(typeof c.quote === 'string' && c.quote.length >= MIN_QUOTE && passage.includes(c.quote), `${where}: quote at least ${MIN_QUOTE} characters exactly as the interviewer wrote them`)
      clean(c.quote, `${where} quote`)
      s.get('scorecard', card.id)
      return { scorecard: card.id, author: card.author, version: card.version ?? 1, field, criterion: on, quote: c.quote, rating: on ? card.ratings?.[on] ?? null : null, revision: s.revisionOf('scorecard', card.id) }
    })
    const authors = new Set(citations.map((c: Data) => c.author))
    if (kind === 'gap') {
      requireThat(about!.agreement === 'unassessed', `${label}: ${about!.name} was assessed, so it is not a gap`)
    } else {
      requireThat(citations.length > 0, `${label} has no cited passage; every statement but a gap quotes released evidence`)
      if (about && kind !== 'question') requireThat(citations.every((c: Data) => c.criterion === about.criterion), `${label}: quote the evidence written for ${about.name}`)
    }
    if (kind === 'agreement') requireThat(about!.agreement === 'agree' && authors.size >= 2, `${label}: the ratings for ${about!.name} do not agree, or fewer than two interviewers are quoted`)
    if (kind === 'disagreement') {
      const sides = new Set(citations.filter((c: Data) => typeof c.rating === 'number').map((c: Data) => side(c.rating)))
      requireThat(about!.agreement === 'disagree' && sides.size === 2, `${label}: quote interviewers on both sides of ${about!.name}, which they must actually rate differently`)
    }
    return { kind, criterion: about?.criterion ?? null, text: said, citations }
  })
  // The brief names every disagreement and every criterion nobody assessed.
  for (const k of facts.criteria) {
    if (k.agreement === 'disagree') requireThat(statements.some(x => x.kind === 'disagreement' && x.criterion === k.criterion), `Name the disagreement on ${k.name}`)
    if (k.agreement === 'unassessed') requireThat(statements.some(x => x.kind === 'gap' && x.criterion === k.criterion), `Name ${k.name} as a criterion nobody assessed`)
  }
  return { statements, criteria: facts.criteria }
}

/** Prepare a brief (an agent for the manager, or a person who runs the job). It changes no hiring record. */
export function debrief(s: State, a: Actor, b: Data) {
  const { app, vacancy } = released(s, a, b)
  const { statements, criteria } = checkStatements(s, a, app, b.statements)
  const record = s.put('debrief', uid(), {
    application: app.id, vacancy: vacancy.id, statements, criteria, status: 'draft', model: null,
    preparedBy: a.email, preparedFor: scope(a), preparedByAgent: a.agent, preparedAt: now(),
  })
  s.audit(a, 'debrief-prepared', 'application:' + app.id, { debrief: record.id, statements: statements.length })
  return record
}

function draftBrief(s: State, a: Actor, id: unknown) {
  const brief = s.find('debrief', id)
  if (!brief) throw new Fault(404, 'Debrief brief not found')
  released(s, a, { application: brief.application })
  requireThat(brief.status === 'draft', 'This brief was already kept; prepare a new one', 409)
  return brief
}

/** The manager's edit: the whole statement list again, held to the same checks. */
export function editDebrief(s: State, a: Actor, b: Data) {
  const brief = draftBrief(s, a, b.id)
  const { statements, criteria } = checkStatements(s, a, s.get('application', brief.application), b.statements)
  const record = s.put('debrief', brief.id, { ...brief, statements, criteria, editedBy: a.email, editedAt: now(), edits: (brief.edits ?? 0) + 1 })
  s.audit(a, 'debrief-edited', 'application:' + brief.application, { debrief: brief.id })
  return record
}

/** Keep the brief as it stands, or discard it, which deletes it. */
export function decideDebrief(s: State, a: Actor, b: Data) {
  const brief = draftBrief(s, a, b.id)
  const decision = oneOf(b.decision, ['keep', 'discard'] as const, 'Decision')
  s.audit(a, decision === 'keep' ? 'debrief-kept' : 'debrief-discarded', 'application:' + brief.application, { debrief: brief.id })
  if (decision === 'discard') { s.remove('debrief', brief.id); return { id: brief.id, status: 'discarded' } }
  return s.put('debrief', brief.id, { ...brief, status: 'kept', keptBy: a.email, keptAt: now() })
}

/** A brief is out of date once a scorecard it quotes has a later version (SCORE-002). */
export const staleDebrief = (s: State, brief: Data) => brief.statements.some((x: Data) => x.citations.some((c: Data) => s.all('scorecard').some(k => k.corrects === c.scorecard)))
