import type { State } from '../core/state'
import { isAdmin, requireAdmin, requireManages } from '../core/access'
import { protectedTerm } from '../core/protected'
import { CRIMINAL_HISTORY, fairChancePlace } from './fair-chance'
import { date, list, now, oneOf, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'

// SCREEN-001: the screening-question library. Admins keep reusable questions
// with typed answers; each edit is a new version, and an application keeps the
// version its applicant answered. A job attaches library questions with its own
// required flag. Questions about protected traits, and salary-history questions,
// are refused.

export const QUESTION_TYPES = ['yes-no', 'single-choice', 'multiple-choice', 'number', 'date', 'file', 'short-text', 'long-text'] as const
export type QuestionType = typeof QUESTION_TYPES[number]
/** Objective answers may drive SCREEN-002 rules; free text and files never can. */
export const OBJECTIVE: readonly QuestionType[] = ['yes-no', 'single-choice', 'multiple-choice', 'number', 'date']
const CHOICES: readonly QuestionType[] = ['single-choice', 'multiple-choice']

// Until ATTR-004 names the places that allow them, every salary-history question is refused.
const SALARY_HISTORY = /\b((salary|pay|wage|compensation|earnings) history|(current|previous|prior|past|last) (salary|pay|wage|wages|compensation|earnings)|how much (do|did) you (make|earn|get paid))\b/i

function allowed(value: string, label: string) {
  const trait = protectedTerm(value), salary = value.match(SALARY_HISTORY)?.[0]
  requireThat(!trait, `${label} asks about “${trait}”, a protected trait; Lodge does not ask it`)
  requireThat(!salary, `${label} asks about “${salary}”: salary-history questions are refused`)
  return value
}

/** Create a library question, or with `id` save its next version. */
export function question(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const type = oneOf(b.type, QUESTION_TYPES, 'Answer type')
  const wording = allowed(text(b.text, 'Question text', 300), 'The question')
  const options = CHOICES.includes(type) ? list(b.options, 'Choices', 20, (x, i) => allowed(text(x, `Choice ${i + 1}`, 120), `Choice ${i + 1}`)) : []
  if (CHOICES.includes(type)) requireThat(options.length >= 2 && new Set(options.map(o => o.toLowerCase())).size === options.length, 'Give at least two different choices')
  const version = { text: wording, type, options, objective: OBJECTIVE.includes(type), required: b.required !== false, help: optionalText(b.help, 'Help text', 500), by: a.email, at: now() }
  if (b.id) {
    const current = s.get('question', b.id)
    const n = current.versions.length + 1
    const record = s.put('question', current.id, { ...current, versions: [...current.versions, { ...version, version: n }] })
    s.audit(a, 'question-version', 'question:' + current.id, { version: n })
    return record
  }
  const record = s.put('question', uid(), { versions: [{ ...version, version: 1 }], createdBy: a.email, createdAt: now() })
  s.audit(a, 'question-created', 'question:' + record.id)
  return record
}

export const currentVersion = (q: Data) => q.versions.at(-1)

/** Attach library questions to a job, each with the job's own required flag; the applicant sees their current version. */
export function jobQuestions(s: State, a: Actor, b: Data) {
  const v = s.get('vacancy', b.id)
  requireManages(a, v)
  requireThat(!v.imported && v.status !== 'closed', 'Questions go on a live job only', 409)
  const place = fairChancePlace(s, v)
  const attached = list(b.questions ?? [], 'Screening questions', 20, (x: any) => {
    const q = s.get('question', x?.question, 'question')
    allowed(currentVersion(q).text, 'The question')
    // HIRE-007: at a fair-chance place criminal history waits until after a conditional offer.
    if (place) requireThat(!CRIMINAL_HISTORY.test(currentVersion(q).text), `${place.place} is a fair-chance place: criminal-history questions wait until after a conditional offer`)
    return { question: q.id as string, required: x.required === undefined ? currentVersion(q).required : x.required === true }
  })
  requireThat(new Set(attached.map(x => x.question)).size === attached.length, 'Attach each question once')
  const record = s.put('vacancy', v.id, { ...v, questions: attached })
  s.audit(a, 'job-questions', 'vacancy:' + v.id, { questions: attached.length })
  return record
}

/** The questions a job's applicants answer, as they read today. */
export function jobForm(s: State, v: Data) {
  // HIRE-007: a job at a fair-chance place never asks a criminal-history question, even one attached before the place was named.
  const fairChance = !!fairChancePlace(s, v)
  return (v.questions ?? []).flatMap((x: Data) => {
    const q = s.find('question', x.question)
    return q && !(fairChance && CRIMINAL_HISTORY.test(currentVersion(q).text)) ? [{ question: q.id, required: x.required, ...currentVersion(q) }] : []
  })
}

export type Answer = string | string[] | { name: string; mediaType: string; base64: string } | null

/**
 * Check an applicant's answers against the job's questions. Each answer keeps
 * the question version it answered, with that version's wording. Files are
 * returned for the caller to store as the application's documents.
 */
export function answers(s: State, v: Data, given: Record<string, Answer>) {
  return jobForm(s, v).flatMap((q: Data) => {
    const raw = given[q.question]
    const label = `“${q.text}”`
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length)
    if (empty) { requireThat(!q.required, `Answer ${label}`); return [] }
    let value: unknown
    switch (q.type as QuestionType) {
      case 'yes-no': value = oneOf(raw, ['yes', 'no'] as const, label); break
      case 'single-choice': requireThat(typeof raw === 'string' && q.options.includes(raw), `Choose one of the choices for ${label}`); value = raw; break
      case 'multiple-choice': { const picked = Array.isArray(raw) ? raw : [raw]; requireThat(picked.every(p => typeof p === 'string' && q.options.includes(p)), `Choose from the choices for ${label}`); value = [...new Set(picked)]; break }
      case 'number': { const n = Number(raw); requireThat(typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(n), `Answer ${label} with a number`); value = n; break }
      case 'date': value = date(raw, label); break
      case 'file': requireThat(typeof raw === 'object' && !Array.isArray(raw), `Attach a file for ${label}`); value = raw; break
      case 'short-text': value = text(raw, label, 300); break
      case 'long-text': value = text(raw, label, 8000); break
    }
    return [{ question: q.question, version: q.version, text: q.text, type: q.type, objective: q.objective, value }]
  })
}

/** Library questions for the people who keep or attach them. */
export const library = (s: State, a: Actor) => isAdmin(a) || a.roles.includes('manager') ? s.all('question') : []
