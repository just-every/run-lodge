import { blindFor } from '../core/blind'
import type { State } from '../core/state'
import { can, canSeeApplication, requireApplication, requireCan, requireManages } from '../core/access'
import { protectedTerm } from '../core/protected'
import { list, now, oneOf, requireThat, text, uid, type Actor, type Data } from '../core/types'

export const REFERENCE_ROLES = ['owner', 'admin', 'manager', 'interviewer'] as const

/** A selected role never adds application or contact authority. Agents do not read referee records. */
export function canReadReference(s: State, a: Actor, app: Data, questionnaire: Data) {
  const v = s.get('vacancy', app.vacancy)
  const roles = questionnaire.versions.at(-1)?.roles ?? []
  return !a.agent && !app.imported && !blindFor(s, a, app) && canSeeApplication(s, a, app) && can(s, a, v, 'contact')
    && (a.owner ? roles.includes('owner') : a.roles.some(role => roles.includes(role)))
}

export function referenceQuestionnaire(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application), v = s.get('vacancy', app.vacancy)
  requireManages(a, v)
  requireCan(s, a, v, 'settings')
  requireCan(s, a, v, 'contact')
  requireThat(app.status === 'active' && !app.imported, 'Use an active native application', 409)
  const current = s.find('reference-questionnaire', app.id)
  requireThat(Number(b.version) === (current?.versions.length ?? 0), 'The questionnaire changed; reload before saving', 409)
  const questions = list(b.questions, 'Reference questions', 20, (value: any) => {
    const wording = text(value, 'Reference question', 500)
    requireThat(!protectedTerm(wording), 'Reference questions about protected traits are refused')
    return { id: uid(), text: wording }
  })
  requireThat(questions.length > 0, 'Write at least one reference question')
  const roles = list(b.roles, 'Reader roles', 4, value => oneOf(value, REFERENCE_ROLES, 'Reader role'))
  requireThat(roles.length > 0 && new Set(roles).size === roles.length, 'Choose distinct reader roles')
  const version = { version: (current?.versions.length ?? 0) + 1, questions, roles, by: a.email, at: now() }
  s.put('reference-questionnaire', app.id, { application: app.id, candidate: app.candidate, versions: [...(current?.versions ?? []), version] })
  s.audit(a, 'reference-questionnaire-version', 'application:' + app.id, { version: version.version })
  return { application: app.id, version: version.version }
}

/** The assigned caller records what they heard; this is never a referee submission or a stage decision. */
export function recordReference(s: State, a: Actor, b: Data) {
  const task = s.get('task', b.task)
  requireThat(task.kind === 'task' && task.purpose === 'call-references' && task.application, 'Choose an application-linked call-references task', 409)
  const app = requireApplication(s, a, task.application)
  const questionnaire = s.get('reference-questionnaire', app.id)
  requireThat(canReadReference(s, a, app, questionnaire), 'Reference record not found', 404)
  requireThat(task.owner === a.email, 'Only the assigned caller records answers', 403)
  requireThat(task.status !== 'cancelled' && app.status === 'active', 'This reference task is closed', 409)
  const form = questionnaire.versions.at(-1)!
  requireThat(Number(b.questionnaireVersion) === form.version, 'The questionnaire changed; reload before recording', 409)
  const current = s.find('reference-record', task.id)
  requireThat(Number(b.version) === (current?.versions.length ?? 0), 'The answers changed; reload before recording', 409)
  requireThat(b.consentConfirmed === true, 'Record the referee consent evidence before recording answers')
  requireThat(b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers), 'Record structured answers')
  requireThat(Object.keys(b.answers).length === form.questions.length && Object.keys(b.answers).every(id => form.questions.some((q: Data) => q.id === id)), 'Answer exactly the current questionnaire')
  const answers = form.questions.map((q: Data) => ({ question: q.id, text: q.text, answer: text(b.answers[q.id], 'Answer', 8000) }))
  const version = {
    version: (current?.versions.length ?? 0) + 1, questionnaireVersion: form.version,
    referee: { name: text(b.refereeName, 'Referee name', 200), relationship: text(b.relationship, 'Referee relationship', 500) },
    source: text(b.source, 'Call source evidence', 2000), consent: text(b.consent, 'Recorded consent evidence', 2000),
    method: 'manually-recorded', answers, by: a.email, at: now(),
  }
  const saved = s.put('reference-record', task.id, { application: app.id, candidate: app.candidate, task: task.id, versions: [...(current?.versions ?? []), version] })
  s.audit(a, 'reference-answers-recorded', 'application:' + app.id, { task: task.id, version: version.version, questionnaireVersion: form.version })
  return saved
}
