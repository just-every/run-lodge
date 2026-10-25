import { Hono } from 'hono'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { actorFor, load, save, signedIn } from '../core/store'
import { cleared, requireAdmin } from '../core/access'
import { Fault, requireThat } from '../core/types'
import { deliver, mailReady } from '../esign/mail'
import { esc, formBody, page, sameOrigin } from '../http/public'
import { configureSurvey, contactable, expireSurveys, invitationFor, prepareInvitation, respond, stopSurveys, surveyConsent, surveyReport } from './records'

export const surveyPages = new Hono<{ Bindings: Bindings }>()
surveyPages.onError(e => page('Survey unavailable', `<h1>Survey unavailable</h1><p role="alert">${esc(e instanceof Fault ? e.message : 'Please try again later.')}</p>`, e instanceof Fault ? e.status : 500))
const staff = async (c: any) => { const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s); requireAdmin(a); requireThat(!a.agent, 'A person must review surveys', 403); return { s, a } }
const form = (action: string, fields: string, button: string) => `<form method="post" action="${esc(action)}">${fields}<button type="submit">${esc(button)}</button></form>`
const field = (label: string, name: string, type = 'text') => `<label>${esc(label)}<input name="${esc(name)}" type="${type}" required></label>`

surveyPages.get('/surveys/settings', async c => {
  const { s, a } = await staff(c), report = surveyReport(s, a)
  const jobs = s.all('vacancy').filter(v => !v.imported && cleared(a, v, 'confidential'))
  const options = jobs.flatMap(v => [...v.stages.map((x: any) => ({ value: v.id + '|' + x.id, label: v.title + ' · ' + x.name })), ...['withdrawn', 'rejected', 'hired'].map(trigger => ({ value: v.id + '|' + trigger, label: v.title + ' · ' + trigger }))])
  return page('Survey settings', `<h1>Candidate experience surveys</h1><p><a href="/app">Back to workspace</a></p><p>Voluntary process feedback, never suitability scoring. Anonymous answers have no candidate link. Only the owner and hiring admins read these reports. Answers expire after at most 30 days. Results need five responses.</p><h2>Configure a survey</h2>${form('/surveys/settings', `<label>Job and trigger<select name="target" required>${options.map(x => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('')}</select></label>${field('Survey title', 'title')}<label>Experience questions, one per line<textarea name="questions" required></textarea></label><label>Reviewed application language<select name="language"><option value="en">English</option><option value="es">Spanish</option></select></label>${field('Reviewed email subject', 'subject')}<label>Reviewed invitation text<textarea name="invitation" required></textarea></label><label><input type="checkbox" name="enabled" value="yes"> Enable this survey</label>`, 'Save survey')}<h2>Explicit consent</h2><p>Record the candidate’s explicit survey consent obtained outside Lodge. This never overrides a contact opt-out.</p>${form('/surveys/consent', field('Application ID', 'application') + field('Consent or refusal evidence', 'basis') + '<label><input type="checkbox" name="enabled" value="yes"> Candidate explicitly opted in</label>', 'Record consent')}<h2>Send a reviewed invitation</h2>${form('/surveys/send', field('Application ID', 'application') + `<label>Survey<select name="survey">${report.surveys.map(r => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')}</select></label><label><input type="checkbox" name="confirm" value="yes" required> Send this invitation now</label>`, 'Send survey')}<h2>Aggregate results</h2><p>${esc(report.definition)}</p>${report.surveys.map(r => `<section><h3>${esc(r.title)} · version ${r.version}</h3><p>${r.responses} responses from ${r.invitations} invitations · response rate ${r.responseRate === null ? 'unavailable' : Math.round(r.responseRate * 100) + '%'}</p>${r.suppressed ? '<p>Small sample: results suppressed until five responses.</p>' : `<ol>${r.questions.map((q: string, i: number) => `<li>${esc(q)}: ${r.averages![i].toFixed(1)} of 5</li>`).join('')}</ol><p>Stage days measure first to latest stage event. Scheduling hours measure application arrival to interview start; neither establishes the cause of a delay.</p>${r.identified.map(x => `<p>${esc(x.candidateName)} · stage days ${x.stageDays} · scheduled interview hours ${x.schedulingHours.join(', ') || 'unavailable'}</p>`).join('')}`}</section>`).join('')}`)
})

surveyPages.post('/surveys/settings', async c => {
  const { s, a } = await staff(c), b = await formBody(c), [vacancy, trigger] = String(b.get('target')).split('|')
  configureSurvey(s, a, { vacancy, trigger, title: b.get('title'), questions: String(b.get('questions')).split('\n').filter(x => x.trim()), language: b.get('language'), subject: b.get('subject'), invitation: b.get('invitation'), enabled: b.get('enabled') === 'yes' })
  await save(c.env.DB, s, a); return c.redirect('/surveys/settings', 303)
})
surveyPages.post('/surveys/consent', async c => {
  const { s, a } = await staff(c), b = await formBody(c)
  surveyConsent(s, a, { application: b.get('application'), basis: b.get('basis'), enabled: b.get('enabled') === 'yes' })
  await save(c.env.DB, s, a); return c.redirect('/surveys/settings', 303)
})
surveyPages.post('/surveys/send', async c => {
  const { s, a } = await staff(c), b = await formBody(c)
  requireThat(mailReady(c.env), 'Installation mail is not configured; nothing was sent', 409)
  const invite = await prepareInvitation(s, a, { application: b.get('application'), survey: b.get('survey'), confirm: b.get('confirm') === 'yes' })
  await save(c.env.DB, s, a)
  // Recheck consent and the sender's live authority immediately before the network edge.
  const live = await staff(c), row = live.s.get('survey-invitation', invite.row.id), candidate = live.s.get('candidate', row.candidate)
  requireThat(candidate.email === invite.to && contactable(live.s, candidate), 'Contact consent changed; nothing was sent', 409)
  const origin = runtimeBindings(c.env).AUTH_ORIGIN
  const result = await deliver(c.env, invite.to, invite.survey.subject, `${invite.survey.invitation}\n\n${origin}/surveys/respond/${invite.token}\n\n${invite.survey.language === 'es' ? 'Dejar de recibir contacto' : 'Stop further contact'}: ${origin}/surveys/stop/${invite.stop}\n`, 'survey')
  const after = await load(c.env.DB), current = after.find('survey-invitation', row.id)
  if (current) after.put('survey-invitation', row.id, { ...current, status: result.outcome, provider: result.provider })
  if (result.outcome === 'handed') {
    const expiresAt = row.expiresAt.slice(0, 10) + 'T00:00:00.000Z', id = row.survey + ':' + row.version + ':' + expiresAt
    const count = after.find('survey-denominator', id)?.count ?? 0
    after.put('survey-denominator', id, { survey: row.survey, version: row.version, expiresAt, count: count + 1 })
  }
  after.audit(live.a, 'survey-invitation-' + result.outcome, 'application:' + row.application, { provider: result.provider })
  await save(c.env.DB, after, null)
  return page('Survey invitation', `<h1>Survey invitation</h1><p>${result.outcome === 'handed' ? 'Handed to the mail provider. Delivery is not confirmed.' : 'Mail failed. No delivery is claimed; an uncertain attempt is not retried automatically.'}</p><p><a href="/surveys/settings">Survey settings</a></p>`)
})

surveyPages.get('/surveys/respond/:token', async c => {
  const s = await load(c.env.DB), row = await invitationFor(s, c.req.param('token')), spanish = row.language === 'es'
  return page(row.title, `<h1>${esc(row.title)}</h1><p>${spanish ? 'Participar es opcional. Las respuestas anónimas no se vinculan a su candidatura. Conservamos las respuestas durante un máximo de 30 días. No se usan para puntuar su idoneidad.' : 'Participation is optional. Anonymous answers are not linked to your application. Answers are kept for at most 30 days and never score your suitability.'}</p>${form(c.req.path, row.questions.map((q: string, i: number) => `<label>${esc(q)}<select name="score-${i}" required><option value="">${spanish ? 'Elegir' : 'Choose'}…</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>`).join('') + `<label>${spanish ? 'Identidad' : 'Response identity'}<select name="mode"><option value="anonymous">${spanish ? 'Anónima' : 'Anonymous'}</option><option value="identified">${spanish ? 'Con mi identidad' : 'Identified'}</option></select></label><label><input type="checkbox" name="identify" value="yes"> ${spanish ? 'Si elijo identificarme, acepto vincular mi identidad y los tiempos del proceso a estas respuestas.' : 'If I choose Identified, I agree to attach my identity and process timings to these answers.'}</label><label><input type="checkbox" name="consent" value="yes" required> ${spanish ? 'Quiero compartir mi experiencia.' : 'I choose to share my experience.'}</label>`, spanish ? 'Enviar respuestas' : 'Share experience')}`, 200, undefined, row.language)
})
surveyPages.post('/surveys/respond/:token', async c => {
  await sameOrigin(c)
  const b = await formBody(c), s = await load(c.env.DB)
  await respond(s, c.req.param('token'), Object.fromEntries(b))
  await save(c.env.DB, s, null)
  return page('Thank you', '<h1>Thank you · Gracias</h1><p>Your experience was recorded. Su experiencia se ha registrado.</p>')
})
surveyPages.get('/surveys/stop/:token', c => page('Contact preferences', `<h1>Stop further contact · Dejar de recibir contacto</h1>${form(c.req.path, '<p>This stops future surveys and records that you declined contact. Esto detiene futuras encuestas y registra que no desea contacto.</p>', 'Stop contact · Detener contacto')}`))
surveyPages.post('/surveys/stop/:token', async c => {
  await sameOrigin(c)
  const s = await load(c.env.DB); await stopSurveys(s, c.req.param('token')); await save(c.env.DB, s, null)
  return page('Contact stopped', '<h1>Contact stopped · Contacto detenido</h1><p>No further survey will be sent. No se enviarán más encuestas.</p>')
})

export async function surveyMaintenance(env: Bindings) { const s = await load(env.DB); expireSurveys(s); await save(env.DB, s, null) }
