import { createSandbox, editSandbox, previewSandbox, deploySandbox, rollbackSandbox } from '../operations/sandbox'
import { businessZone } from '../core/time'
import { now } from '../core/types'
import { statusTiming, timingLabel, dueLabel, TIMING_RULE } from '../communications/timing'
import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { requireAdmin, requireApplication, requireCan, requireManages } from '../core/access'
import { actorFor, load, save, signedIn } from '../core/store'
import { Fault, requireThat, type Actor, type Data } from '../core/types'
import { applicationEmailSettings, configureApplicationEmails, reviewApplicationEmailTemplate } from '../communications/templates'
import { approveApplicationTransport } from '../communications/transport'
import { applicationEmailPreview } from './application-email-preview'
import { applicationEmailSenderForm } from './application-email-sender-form'
import type { State } from '../core/state'
import { esc, formBody, page } from './public'

type C = Context<{ Bindings: Bindings }>
type Draft = { timing?: Data; kind: string; stage: string; language: string; subject: string; body: string; publicStatus?: string; footer?: string; previewApplication?: string; reviewed: boolean }
type Edit = { draft?: Draft; transport?: Data; policy?: { acknowledgment: boolean; stages: string[] }; error?: string; preview?: boolean }
const settingsPath = '/application-emails/settings'
const settingsUrl = (id: string) => settingsPath + '?vacancy=' + encodeURIComponent(id)
const checked = (yes: boolean) => yes ? ' checked' : ''
const selected = (yes: boolean) => yes ? ' selected' : ''
const when = (value: unknown) => value ? esc(value) : 'Not recorded'

export const applicationEmailPages = new Hono<{ Bindings: Bindings }>()
applicationEmailPages.use('*', async (c, next) => {
  await next()
  c.header('referrer-policy', 'same-origin')
  c.header('cache-control', 'no-store')
})
applicationEmailPages.onError(error => page('Application email unavailable', `<h1>Application email unavailable</h1><p role="alert">${esc(error instanceof Fault ? error.message : 'Please try again later.')}</p><p><a href="/app">Back to workspace</a></p>`, error instanceof Fault ? error.status : 500))

async function staff(c: C) {
  const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
  requireAdmin(a)
  requireThat(!a.agent, 'A person must review application email settings and outcomes', 403)
  return { s, a }
}

function jobFor(jobs: Data[], id: unknown) {
  const job = jobs.find(job => job.id === id)
  requireThat(job, 'Vacancy not found', 404)
  return job
}

const stageName = (job: Data, id: unknown) => job.stages.find((stage: Data) => stage.id === id)?.name ?? 'Stage no longer available'
const templateName = (job: Data, template: Data) => template.kind === 'acknowledgment' ? 'Application acknowledgment' : `Status update: ${stageName(job, template.stage)}`
const exactText = (subject: unknown, body: unknown) => `<p>Subject</p><div class="sign-doc">${esc(subject)}</div><p>Body</p><div class="sign-doc">${esc(body)}</div>`

function reviewedTemplates(job: Data) {
  return job.templates.length ? job.templates.map((template: Data) => `<details class="disclosure"><summary>${esc(templateName(job, template))} · ${esc(template.language)} · version ${esc(template.version)}</summary><p>Reviewed by ${esc(template.reviewedBy)} · ${when(template.reviewedAt)}</p>${exactText(template.subject, template.body)}<p><a href="${esc(settingsUrl(job.id) + '&template=' + encodeURIComponent(template.id))}">Edit this template</a></p></details>`).join('') : '<p>No reviewed templates yet.</p>'
}

function policyForm(job: Data, edit: Edit) {
  const policy = edit.policy ?? job.policy
  return `<details class="disclosure" name="application-email-editor"${edit.policy ? ' open' : ''}><summary>Configure sending</summary><form action="${settingsPath}" method="post"><input type="hidden" name="vacancy" value="${esc(job.id)}"><input type="hidden" name="action" value="configure"><fieldset><legend>Send automatically for this vacancy</legend><label><input type="checkbox" name="acknowledgment" value="yes"${checked(policy.acknowledgment)}> Acknowledge new applications</label>${job.stages.map((stage: Data) => `<label><input type="checkbox" name="stages" value="${esc(stage.id)}"${checked(policy.stages.includes(stage.id))}> Send an update on entering ${esc(stage.name)}</label>`).join('')}</fieldset><button>Apply sending settings</button></form></details>`
}

function timingForm(s: State, job: Data) {
  const zone = businessZone(s.get('business', 'main'))
  const box = s.all('workflow-sandbox').filter(b => b.vacancy === job.id && b.name === 'Application status timing').at(-1)
  const reviewed = box?.status === 'review' ? box.preview : undefined
  const timing = reviewed ? statusTiming(box!.config) : statusTiming(job)
  return `<details class="disclosure" name="application-email-editor"${reviewed ? ' open' : ''}><summary>Review status timing</summary><p>Current timing: ${esc(timingLabel(statusTiming(job)))}</p><p>Preview timing in isolation, then unpublish this vacancy before activation or rollback. Review each status template again after a timing change. Existing queued due times and text stay frozen; changed configuration withholds them.</p><form action="${settingsPath}" method="post"><input type="hidden" name="vacancy" value="${esc(job.id)}"><input type="hidden" name="action" value="timing-preview"><label>Delay in eligible local days<input name="delayDays" type="number" min="0" max="60" required value="${esc(timing.delayDays)}"></label><fieldset><legend>Eligible weekdays</legend>${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => `<label><input type="checkbox" name="weekdays" value="${i}"${checked(timing.weekdays.includes(i))}> ${day}</label>`).join('')}</fieldset><p>Business time zone: ${esc(zone)}</p><details><summary>Timing behavior</summary><p>${esc(TIMING_RULE)}</p></details><label>Trial stage event time (ISO instant)<input name="eventAt" required value="${now()}"></label><button>Preview status timing</button></form>${reviewed ? `<section aria-label="Status timing preview"><h3>Status timing preview</h3><p>${esc(timingLabel(statusTiming(box!.config)))}</p><p>${esc(TIMING_RULE)}</p>${reviewed.impact.outcomes.map((o: Data) => o.statusEmail ? `<p>Event: ${esc(o.statusEmail.eventAt)}. Due: ${esc(dueLabel(o.statusEmail.dueAt, statusTiming(box!.config)))} (${esc(o.statusEmail.dueAt)}). Production contact: 0.</p>` : `<p role="alert">${esc(o.error)}</p>`).join('')}<form action="${settingsPath}" method="post"><input type="hidden" name="vacancy" value="${esc(job.id)}"><input type="hidden" name="action" value="timing-activate"><input type="hidden" name="sandbox" value="${esc(box!.id)}"><input type="hidden" name="token" value="${esc(reviewed.token)}"><label><input name="confirmProduction" type="checkbox" value="yes" required> I approve this exact reviewed timing for production</label><button>Activate reviewed timing</button></form></section>` : ''}${box?.status === 'deployed' ? `<form action="${settingsPath}" method="post"><input type="hidden" name="vacancy" value="${esc(job.id)}"><input type="hidden" name="action" value="timing-rollback"><input type="hidden" name="sandbox" value="${esc(box!.id)}"><button>Rollback status timing</button></form>` : ''}</details>`
}

function templateForm(s: State, job: Data, a: Actor, draft: Draft | undefined, preview: boolean) {
  const d = draft ?? { kind: 'acknowledgment', stage: '', language: '', subject: '', body: '', reviewed: false }
  return `<details class="disclosure" name="application-email-editor"${draft ? ' open' : ''}><summary>Review an email template</summary><form action="${settingsPath}" method="post"><input type="hidden" name="vacancy" value="${esc(job.id)}"><input type="hidden" name="timing" value="${esc(JSON.stringify(d.timing ?? statusTiming(job)))}"><label>Email purpose<select name="kind" required><option value="acknowledgment"${selected(d.kind === 'acknowledgment')}>Application acknowledgment</option><option value="status"${selected(d.kind === 'status')}>Status update</option></select></label><label>Stage for a status update<select name="stage"><option value="">Acknowledgment does not need a stage</option>${job.stages.map((stage: Data) => `<option value="${esc(stage.id)}"${selected(d.stage === stage.id)}>${esc(stage.name)}</option>`).join('')}</select></label><label>Reviewed public status label<input name="publicStatus" value="${esc(d.publicStatus)}"></label><label>Application language code<input name="language" required value="${esc(d.language)}" placeholder="en, es or fr" autocomplete="off"></label><label>Subject<input name="subject" required value="${esc(d.subject)}"></label><label>Body<textarea name="body" aria-label="Body" rows="10" required>${esc(d.body)}</textarea></label><label>Footer in this language<textarea name="footer" aria-label="Footer in this language" rows="4" required>${esc(d.footer ?? (d.language === "en" ? s.find("application-email-transport", "main")?.footer : ""))}</textarea></label><details><summary>Template placeholders</summary><p>Use <code>{{candidateName}}</code>, <code>{{jobTitle}}</code>, <code>{{businessName}}</code> and <code>{{receiptCode}}</code> and the reviewed <code>{{publicStatus}}</code>. An acknowledgment must include <code>{{receiptCode}}</code> in its body. Candidate emails contain only the text you review here.</p></details><p>Status timing: ${esc(timingLabel(statusTiming(job)))}. ${esc(TIMING_RULE)}</p><button name="action" value="preview" formnovalidate>Preview template</button>${applicationEmailPreview(s, a, job, d, preview)}<label><input type="checkbox" name="reviewed" value="yes" required${checked(d.reviewed)}> I, ${esc(a.name)}, have reviewed this exact message, timing, footer, sender and reply-to in this language for candidate email.</label><button name="action" value="review">Review and save template</button></form></details>`
}

function settingsPage(c: C, s: State, a: Actor, id?: string, edit: Edit = {}, status = 200) {
  const { jobs, transport, active } = applicationEmailSettings(s, a)
  const job = id ? jobFor(jobs, id) : jobs[0]
  const chosenTemplate = job?.templates.find((template: Data) => template.id === c.req.query('template'))
  const draft = edit.draft ?? (chosenTemplate ? { kind: chosenTemplate.kind, stage: chosenTemplate.stage ?? '', language: chosenTemplate.language, subject: chosenTemplate.subject, body: chosenTemplate.body, publicStatus: chosenTemplate.publicStatus, footer: chosenTemplate.footer, reviewed: false } : undefined)
  return page('Application email settings', `<h1>Application email settings</h1><p><a href="/app">Back to workspace</a></p>${edit.error ? `<p role="alert">${esc(edit.error)}</p>` : c.req.query('saved') ? '<p role="status">Saved</p>' : ''}${applicationEmailSenderForm(c.env.MAIL_FROM ?? "", transport, active, edit.transport)}${jobs.length ? `<form action="${settingsPath}" method="get"><label>Vacancy<select name="vacancy" required>${jobs.map(item => `<option value="${esc(item.id)}"${selected(item.id === job!.id)}>${esc(item.title)}</option>`).join('')}</select></label><button>Open vacancy settings</button></form>` : '<p>No vacancies are available for application email settings.</p>'}${job ? `<h2>${esc(job.title)}</h2><p>Acknowledgments: ${job.policy.acknowledgment ? 'On' : 'Off'}. Status updates: ${job.policy.stages.length ? job.policy.stages.map((id: string) => esc(stageName(job, id))).join(', ') : 'Off'}.</p><details class="disclosure"><summary>How sending works</summary><p>Sending starts off. Enable only the events you want. Each application needs an exact reviewed template in its recorded language; a missing template withholds the email. A provider handoff does not confirm delivery.</p></details>${policyForm(job, edit)}${timingForm(s, job)}${templateForm(s, job, a, draft, edit.preview === true)}<h2>Current reviewed templates</h2>${reviewedTemplates(job)}<h2>Recent email outcomes</h2>${job.outcomes.length ? `<ul>${job.outcomes.slice(-20).reverse().map((mail: Data) => `<li><a href="/application-emails/application/${esc(mail.application)}">${esc(mail.kind === 'acknowledgment' ? 'Acknowledgment' : 'Status update')} · ${esc(mail.language)} · ${esc(outcomeLabels[mail.status] ?? mail.status)}</a></li>`).join('')}</ul>` : '<p>No application emails have been recorded.</p>'}` : ''}`, status)
}

applicationEmailPages.get(settingsPath, async c => {
  const { s, a } = await staff(c)
  return settingsPage(c, s, a, c.req.query('vacancy'))
})

applicationEmailPages.post(settingsPath, async c => {
  const { s, a } = await staff(c), { jobs } = applicationEmailSettings(s, a), input = await formBody(c)
  const action = input.get('action')
  const value = (key: string) => { const v = input.get(key); return typeof v === 'string' ? v : '' }
  if (action === 'transport' || action === 'transport-disable') {
    const transport = { enabled: action === 'transport', replyTo: value('replyTo'), footer: value('footer'), monitored: input.get('monitored') === 'yes', reviewed: input.get('legalReviewed') === 'yes' }
    try { await approveApplicationTransport(c.env, s, a, transport) }
    catch (error) { return settingsPage(c, s, a, undefined, { transport, error: error instanceof Fault ? error.message : 'Sender authentication could not be checked; sending remains off' }, error instanceof Fault ? error.status : 409) }
    return c.redirect(settingsPath + '?saved=1', 303)
  }
  const job = jobFor(jobs, input.get('vacancy'))
  if (typeof action === 'string' && action.startsWith('timing-')) {
    try {
      if (action === 'timing-preview') {
        const eventAt = value('eventAt')
        requireThat(Number.isFinite(Date.parse(eventAt)), 'Choose a valid trial event instant')
        const application = s.all('application').find(app => app.vacancy === job.id)?.id
        const box = await createSandbox(s, a, { name: 'Application status timing', vacancy: job.id, mode: application ? 'historical' : 'synthetic', confirmSynthetic: true, samples: [application ? { application, eventAt } : { label: 'Status timing trial', eventAt, answers: {} }] })
        editSandbox(s, a, { id: box.id, edits: [{ op: 'application-email-timing', input: { timing: { delayDays: Number(value('delayDays')), weekdays: input.getAll('weekdays').map(Number), timeZone: businessZone(s.get('business', 'main')) } } }] })
        await previewSandbox(s, a, { id: box.id })
      } else {
        const box = s.get('workflow-sandbox', value('sandbox'))
        requireThat(box.vacancy === job.id && box.name === 'Application status timing', 'Choose this job timing review', 403)
        if (action === 'timing-activate') await deploySandbox(s, a, { id: box.id, token: value('token'), confirmProduction: input.get('confirmProduction') === 'yes' })
        else { requireThat(action === 'timing-rollback', 'Choose a timing action'); await rollbackSandbox(s, a, { id: box.id }) }
      }
      await save(c.env.DB, s, a)
      return c.redirect(settingsUrl(job.id) + '&saved=1', 303)
    } catch (error) { if (!(error instanceof Fault)) throw error; return settingsPage(c, s, a, job.id, { error: error.message }, error.status) }
  }
  let timing: Data | undefined
  try { timing = JSON.parse(value('timing') || 'null') ?? undefined } catch { /* Invalid review cannot match a delayed configuration. */ }
  const draft: Draft = { timing, kind: value('kind'), stage: value('stage'), language: value('language'), subject: value('subject'), body: value('body'), publicStatus: value('publicStatus'), footer: value('footer'), previewApplication: value('previewApplication'), reviewed: input.get('reviewed') === 'yes' }
  const policy = { acknowledgment: input.get('acknowledgment') === 'yes', stages: input.getAll('stages').filter((id): id is string => typeof id === 'string') }
  if (action === 'preview') return settingsPage(c, s, a, job.id, { draft: { ...draft, reviewed: false }, preview: true })
  try {
    if (action === 'configure') configureApplicationEmails(s, a, { vacancy: job.id, ...policy })
    else {
      requireThat(action === 'review', 'Choose a settings action')
      requireThat(draft.reviewed, 'Confirm your review of this exact subject and body first')
      reviewApplicationEmailTemplate(s, a, { vacancy: job.id, ...draft, stage: draft.kind === 'status' ? draft.stage : undefined, reviewed: true })
    }
    await save(c.env.DB, s, a)
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    return settingsPage(c, s, a, job.id, { error: error.message, ...(action === 'configure' ? { policy } : { draft: { ...draft, reviewed: false }, preview: true }) }, error.status)
  }
  return c.redirect(settingsUrl(job.id) + '&saved=1', 303)
})

const outcomeLabels: Record<string, string> = { pending: 'Pending', sending: 'Uncertain', uncertain: 'Uncertain — human reconciliation required', canceled: 'Canceled', suppressed: 'Suppressed', bounced: 'Bounced', handed: 'Handed to provider', delivered: 'Delivered', failed: 'Failed', withheld: 'Withheld' }

applicationEmailPages.get('/application-emails/application/:id', async c => {
  const { s, a } = await staff(c), app = requireApplication(s, a, c.req.param('id')), job = s.get('vacancy', app.vacancy)
  requireManages(a, job)
  requireCan(s, a, job, 'contact')
  requireThat(!job.imported, 'Imported vacancies are kept as history', 409)
  const outcomes = s.all('application-email').filter(email => email.application === app.id)
  return page('Application email outcomes', `<h1>Application email outcomes</h1><p><a href="/app">Back to workspace</a> · <a href="${esc(settingsUrl(job.id))}">Application email settings</a></p><h2>${esc(job.title)}</h2>${outcomes.length ? outcomes.map(email => `<article><h3>${esc(email.kind === 'acknowledgment' ? 'Application acknowledgment' : 'Status update')} · ${esc(email.language)}</h3><p>${esc(outcomeLabels[email.status] ?? 'Status unavailable')}</p><dl class="application-email-facts"><dt>Responsible reviewer</dt><dd>${esc(email.reviewedBy || "Review required")}</dd><dt>Language and template version</dt><dd>${esc(email.language)} · ${esc(email.templateVersion)}</dd><dt>Recorded</dt><dd>${when(email.at)}</dd><dt>Due</dt><dd>${when(email.dueAt)}${email.timing ? ' · ' + esc(dueLabel(email.dueAt, email.timing)) : ''}</dd>${email.timing ? `<dt>Reviewed timing</dt><dd>${esc(timingLabel(email.timing))}</dd>` : ''}<dt>Attempts</dt><dd>${esc(email.attempts ?? 0)}</dd>${email.finishedAt ? `<dt>Finished</dt><dd>${when(email.finishedAt)}</dd>` : ''}${email.provider ? `<dt>Provider</dt><dd>${esc(email.provider)}</dd>` : ''}${email.providerMessageId ? `<dt>Provider message reference</dt><dd><code>${esc(email.providerMessageId)}</code></dd>` : ''}${email.reason ? `<dt>Reason</dt><dd>${esc(email.reason)}</dd>` : ''}</dl></article>`).join('') : '<p>No application email outcomes have been recorded.</p>'}`)
})
