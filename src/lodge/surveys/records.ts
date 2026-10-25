import { holdsFor } from '../records/retention'
import type { State } from '../core/state'
import { canSeeApplication, cleared, isAdmin, requireAdmin, requireApplication } from '../core/access'
import { integer, list, now, oneOf, requireThat, sha256, text, uid, type Actor, type Data } from '../core/types'

// REPORT-004: separate invitation custody from answers. Anonymous answers carry no person, application, token or time.
export function configureSurvey(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const v = s.get('vacancy', b.vacancy)
  requireThat(cleared(a, v, 'confidential'), 'Job not found', 404)
  requireThat(!v.imported, 'Choose a live Lodge job')
  const trigger = oneOf(b.trigger, [...v.stages.map((x: Data) => x.id), 'withdrawn', 'rejected', 'hired'], 'Survey stage or closure')
  const id = v.id + ':' + trigger, old = s.find('survey', id)
  const questions = list(b.questions, 'Experience questions', 5, x => text(x, 'Question', 240))
  requireThat(questions.length > 0, 'Add an experience question')
  // Experience ratings are process feedback only; no free text or protected-answer collection.
  const row = s.put('survey', id, { vacancy: v.id, trigger, title: text(b.title, 'Survey title'), questions, language: oneOf(b.language, ['en', 'es'], 'Reviewed language'), subject: text(b.subject, 'Reviewed email subject', 200), invitation: text(b.invitation, 'Reviewed email text', 2000), version: (old?.version ?? 0) + 1, enabled: b.enabled === true, reviewedBy: a.email, reviewedAt: now() })
  s.audit(a, 'survey-configured', 'vacancy:' + v.id, { survey: id, version: row.version })
  return row
}

export function surveyConsent(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const app = requireApplication(s, a, b.application), c = s.get('candidate', app.candidate)
  requireThat(!c.deleted && !c.mergedInto, 'Candidate is unavailable', 409)
  const enabled = b.enabled === true
  requireThat(!enabled || c.contactPreference?.preference !== 'none', 'The candidate declined contact', 409)
  const row = s.put('survey-consent', c.id, { candidate: c.id, enabled, basis: text(b.basis, 'Explicit candidate consent or refusal', 1000), by: a.email, at: now() })
  s.audit(a, 'survey-consent-recorded', 'candidate:' + c.id, { enabled })
  return { enabled: row.enabled }
}

export const retained = (r: Data) => Date.parse(r.expiresAt) > Date.now()
export function contactable(s: State, c: Data) {
  return !c.deleted && !c.mergedInto && !!c.email && (!c.retainUntil || c.retainUntil >= now().slice(0, 10)) && c.contactPreference?.preference !== 'none' && s.find('survey-consent', c.id)?.enabled === true
}
export async function prepareInvitation(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(b.confirm === true, 'Confirm this survey invitation')
  const app = requireApplication(s, a, b.application), c = s.get('candidate', app.candidate)
  const survey = s.get('survey', b.survey)
  requireThat(survey.enabled && survey.vacancy === app.vacancy && survey.trigger === (app.status === 'active' ? app.stage : app.status), 'The application is not at this survey stage or closure', 409)
  requireThat(contactable(s, c), 'Explicit survey consent and permitted contact are required', 409)
  requireThat((app.language ?? 'en') === survey.language, 'Review the survey and email in the application language first', 409)
  const id = survey.id + ':' + app.id
  requireThat(!s.find('survey-invitation', id) && !s.find('survey-receipt', id), 'This application already had this survey invitation', 409)
  const token = uid() + uid(), stop = uid() + uid(), hash = await sha256(token)
  const expiresAt = new Date(Math.min(Date.now() + 30 * 86400000, c.retainUntil ? Date.parse(c.retainUntil + 'T23:59:59.999Z') : Infinity)).toISOString()
  s.put('survey-stop', await sha256(stop), { candidate: c.id, expiresAt })
  const row = s.put('survey-invitation', id, { survey: survey.id, candidate: c.id, application: app.id, vacancy: app.vacancy, hash, expiresAt, status: 'sending', version: survey.version, questions: survey.questions, language: survey.language, title: survey.title })
  s.audit(a, 'survey-invitation-claimed', 'application:' + app.id, { survey: survey.id })
  return { row, token, stop, to: c.email, survey }
}

export async function invitationFor(s: State, token: string) {
  const hash = await sha256(token)
  const row = s.scan('survey-invitation').find(r => r.hash === hash)
  const c = row && s.find('candidate', row.candidate)
  requireThat(row && retained(row) && row.status === 'handed' && c && contactable(s, c), 'This survey link is unavailable', 404)
  return s.get('survey-invitation', row.id)
}

export async function respond(s: State, token: string, b: Data) {
  const row = await invitationFor(s, token)
  requireThat(b.consent === 'yes', 'Choose to share your experience')
  const mode = oneOf(b.mode, ['anonymous', 'identified'], 'Response identity')
  requireThat(mode !== 'identified' || b.identify === 'yes', 'Explicitly agree to attach your identity')
  const scores = row.questions.map((_: string, i: number) => integer(b['score-' + i], 'Experience rating', 1, 5))
  // Anonymous rows retain only a survey version and daily expiry bucket, never the invitation id or its hash.
  const expiresAt = row.expiresAt.slice(0, 10) + 'T00:00:00.000Z'
  s.put('survey-response', uid(), { survey: row.survey, version: row.version, scores, expiresAt, ...(mode === 'identified' ? { candidate: row.candidate, application: row.application, consent: true } : {}) })
  s.put('survey-receipt', row.id, { candidate: row.candidate, application: row.application, survey: row.survey, expiresAt: row.expiresAt })
  s.remove('survey-invitation', row.id)
  // No response event, timestamp or id is put in a candidate's activity or audit.
}

export async function stopSurveys(s: State, token: string) {
  const row = s.find('survey-stop', await sha256(token))
  requireThat(row && retained(row), 'This preference link is unavailable', 404)
  const c = s.get('candidate', row.candidate)
  s.put('survey-consent', c.id, { candidate: c.id, enabled: false, at: now(), by: 'candidate' })
  s.put('candidate', c.id, { ...c, contactPreference: { preference: 'none', at: now(), by: 'candidate' } })
  for (const invite of s.scan('survey-invitation').filter(x => x.candidate === c.id)) s.remove('survey-invitation', invite.id)
  for (const answer of s.scan('survey-response').filter(x => x.candidate === c.id)) s.remove('survey-response', answer.id)
  s.audit(null, 'survey-contact-declined', 'candidate:' + c.id)
}

export function surveyReport(s: State, a: Actor) {
  requireAdmin(a)
  const surveys = s.all('survey').filter(r => { const v = s.find('vacancy', r.vacancy); return v && cleared(a, v, 'confidential') && s.all('application').filter(app => app.vacancy === v.id).every(app => canSeeApplication(s, a, app)) })
  return { minimumSample: 5, definition: 'Responses divided by invitations handed to the mail provider. Provider acceptance is not delivery. Results below five responses are suppressed. Experience ratings never score suitability.', surveys: surveys.map(r => {
    const responses = s.all('survey-response').filter(x => x.survey === r.id && x.version === r.version && retained(x))
    const count = s.all('survey-denominator').filter(x => x.survey === r.id && x.version === r.version && retained(x)).reduce((n, x) => n + x.count, 0)
    const suppressed = responses.length < 5
    const identified = suppressed ? [] : responses.filter(x => x.consent && x.application).flatMap(x => {
      const app = s.find('application', x.application), c = s.find('candidate', x.candidate)
      if (!app || !c || !canSeeApplication(s, a, app)) return []
      const events = s.all('stage-event').filter(e => e.application === app.id).sort((p, q) => p.at.localeCompare(q.at))
      const scheduled = s.all('interview').filter(iv => iv.application === app.id && iv.start)
      return [{ application: app.id, candidateName: c.name, scores: x.scores, stageDays: events.length ? Math.max(0, Math.floor((Date.parse(events.at(-1)!.at) - Date.parse(events[0].at)) / 86400000)) : 0, schedulingHours: scheduled.map(iv => Math.max(0, Math.round((Date.parse(iv.start) - Date.parse(app.submittedAt)) / 3600000))) }]
    })
    return { ...r, id: r.id, title: r.title, version: r.version, questions: r.questions, invitations: count, responses: responses.length, responseRate: count ? responses.length / count : null, suppressed, averages: suppressed ? null : r.questions.map((_: string, i: number) => responses.reduce((n, x) => n + x.scores[i], 0) / responses.length), identified }
  }) }
}

export function surveyView(s: State, a: Actor) { return isAdmin(a) && !a.agent ? surveyReport(s, a) : null }
export function expireSurveys(s: State) {
  for (const kind of ['survey-invitation', 'survey-response', 'survey-stop', 'survey-receipt', 'survey-denominator']) for (const row of s.scan(kind)) {
    const survey = row.survey && s.find('survey', row.survey)
    const held = row.candidate ? holdsFor(s, row.candidate).length > 0 : survey && s.scan('hold').some(h => h.status === 'active' && h.vacancy === survey.vacancy)
    if (!retained(row) && !held) s.remove(kind, row.id)
  }
}
