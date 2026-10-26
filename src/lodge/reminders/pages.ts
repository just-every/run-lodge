import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { requireAdmin } from '../core/access'
import type { State } from '../core/state'
import { actorFor, load, save, signedIn } from '../core/store'
import { businessZone, instantOf, times, toWall } from '../core/time'
import { Fault, requireThat, type Actor, type Data } from '../core/types'
import { esc, formBody, page, sameOrigin } from '../http/public'
import { reminderView, configureReminder, cancelReminder } from './records'

type C = Context<{ Bindings: Bindings }>
const path = '/reminders/settings'
const heading = 'Persistent hiring reminders'
const kinds: Record<string, string> = { availability: 'Missing availability', upcoming: 'Upcoming interview', scorecard: 'Missing scorecard' }
const statuses: Record<string, string> = { queued: 'Queued', held: 'Held', acknowledged: 'Response received', active: 'Active', disabled: 'Off', pending: 'Pending', sending: 'Handoff in progress', handed: 'Handed to provider', delivered: 'Delivered', uncertain: 'Uncertain; human reconciliation required', completed: 'Completed', canceled: 'Canceled', withheld: 'Withheld', suppressed: 'Suppressed', failed: 'Failed', bounced: 'Bounced', exhausted: 'Attempt limit reached', task: 'Internal task recorded' }
const checked = (yes: boolean) => yes ? ' checked' : ''
const selected = (yes: boolean) => yes ? ' selected' : ''
const url = (id: string) => path + '?interview=' + encodeURIComponent(id)
const option = (value: string, label: string, current: unknown) => `<option value="${esc(value)}"${selected(value === current)}>${esc(label)}</option>`
const input = (label: string, name: string, value: unknown, type = 'text', attrs = 'required') => `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`
const area = (label: string, name: string, value: unknown, rows: number) => `<label>${label}<textarea name="${name}" rows="${rows}" required>${esc(value)}</textarea></label>`

export const reminderPages = new Hono<{ Bindings: Bindings }>()
reminderPages.use('*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('referrer-policy', 'same-origin') })
reminderPages.onError(error => page(heading, `<h1>${heading}</h1><p role="alert">${esc(error instanceof Fault ? error.message : 'Please try again later.')}</p><p><a href="${path}">Reminder settings</a> · <a href="/app">Back to workspace</a></p>`, error instanceof Fault ? error.status : 500))

async function staff(c: C) {
  const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
  requireAdmin(a)
  requireThat(!a.agent, 'A person must review reminder settings and outcomes', 403)
  return { s, a }
}

function reminderForm(s: State, a: Actor, iv: Data, members: Data[], record?: Data, draft?: Data) {
  const zone = businessZone(s.find('business', 'main')), language = s.get('application', iv.application).language ?? 'en'
  const d = draft ?? { ...(record ?? {}), dueAt: record?.nextDueAt ? new Date(toWall(Date.parse(record.nextDueAt), zone)).toISOString().slice(0, 16) : '', language: record?.language ?? language, reviewed: false, enabled: false }
  const people = (name: string, label: string) => `<label>${label}<select name="${name}" aria-label="${esc(label)}" required>${option('', 'Choose a person', d[name])}${members.map(m => option(m.email, m.name ? `${m.name} · ${m.email}` : m.email, d[name])).join('')}</select></label>`
  return `<details class="disclosure"${record || draft ? ' open' : ''}><summary>${record ? 'Review reminder settings' : 'Configure a reminder'}</summary>
<form action="${path}" method="post"><input type="hidden" name="interview" value="${esc(iv.id)}"><input type="hidden" name="action" value="configure">
<label>Reminder purpose<select name="kind" aria-label="Reminder purpose" required>${option('', 'Choose a purpose', d.kind)}${Object.entries(kinds).map(([id, label]) => option(id, label, d.kind)).join('')}</select></label>
<label>Recipient<select name="recipient" aria-label="Recipient" required>${option('', 'Choose a recipient', d.recipient)}${option('candidate', 'Candidate for this interview', d.recipient)}${iv.participants.map((email: string) => option(email, email, d.recipient)).join('')}</select></label>
${people('owner', 'Responsible owner')}${people('escalation', 'Escalation hiring manager')}
${input(`First due time · ${zone}`, 'dueAt', d.dueAt, 'datetime-local')}
${input('Hours between attempts', 'cadenceHours', d.cadenceHours, 'number', 'required min="1" step="1"')}${input('Maximum attempts', 'maxAttempts', d.maxAttempts, 'number', 'required min="1" step="1"')}
<details><summary>Business hours and weekdays</summary><p>All reminder windows use ${esc(zone)}. End hour is exclusive.</p>${input('Start hour, 0–23', 'startHour', d.startHour, 'number', 'required min="0" max="23" step="1"')}${input('End hour, 1–24', 'endHour', d.endHour, 'number', 'required min="1" max="24" step="1"')}<fieldset><legend>Permitted weekdays</legend>${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => `<label><input type="checkbox" name="weekdays" value="${i}"${checked((d.weekdays ?? []).includes(i))}> ${day}</label>`).join('')}</fieldset></details>
<p>Current candidate application language: ${esc(language || 'Not recorded')}.</p>${input('Reviewed message language code', 'language', d.language)}
${input('Exact subject', 'subject', d.subject)}${area('Exact message body', 'body', d.body, 8)}${area('Exact employer footer in this language', 'footer', d.footer, 4)}
<p>Enter the complete final text. Placeholders are not accepted.</p><label><input type="checkbox" name="reviewed" value="yes" required> I, ${esc(a.name)}, reviewed this exact subject, body and footer in the current recipient language.</label>
<label><input type="checkbox" name="enabled" value="yes" required${checked(d.enabled === true)}> Enable this reminder</label><button>Enable reviewed reminder</button></form></details>`
}

function reminderCard(r: Data, zone: string, open = false) {
  const when = (value: string | undefined) => value ? esc(times(zone).stamped(value)) : 'Not recorded'
  const facts = (entries: [string, unknown][]) => `<dl class="application-email-facts">${entries.map(([label, value]) => `<dt>${label}</dt><dd>${esc(value ?? 'Not recorded')}</dd>`).join('')}</dl>`
  return `<details class="disclosure"${open ? ' open' : ''}><summary>${esc(r.title)} · ${esc(kinds[r.kind] ?? r.kind)} · ${esc(statuses[r.status] ?? r.status)}</summary>
${facts([['Recipient', r.recipient], ['Responsible owner', r.owner], ['Escalation owner', r.escalation || 'None'], ['Attempts', `${r.attempts} of ${r.maxAttempts}`], ['Hours between attempts', r.cadenceHours], ['Business hours', `${r.startHour}:00 to ${r.endHour}:00 · ${zone}`], ['Weekdays', (r.weekdays ?? []).map((n: number) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n]).join(', ')], ['Reason', r.reason || 'None']])}<p>Next due: ${when(r.nextDueAt)}</p>
<p><a href="${esc(url(r.interview) + '&reminder=' + encodeURIComponent(r.id))}">Review these settings</a></p>
<details><summary>Reviewed message</summary><p>${esc(r.language)}</p><p>Subject</p><div class="sign-doc">${esc(r.subject)}</div><p>Body</p><div class="sign-doc">${esc(r.body)}</div><p>Footer</p><div class="sign-doc">${esc(r.footer)}</div></details>
<h3>Recorded outcomes</h3>${r.outcomes?.length ? r.outcomes.map((o: Data) => `<article><h4>${esc(statuses[o.status] ?? o.status)} · ${esc(o.purpose)}</h4>${facts([['To', o.to || 'No external recipient'], ['Reason', o.reason || 'None']])}<p>Due: ${when(o.dueAt)}<br>Claimed: ${when(o.claimedAt)}<br>Finished: ${when(o.finishedAt)}</p></article>`).join('') : '<p>No outcomes recorded.</p>'}
<form action="${path}" method="post"><input type="hidden" name="reminder" value="${esc(r.id)}">${input('Cancellation reason', 'reason', '')}<button name="action" value="cancel">Cancel this reminder</button></form></details>`
}

function settingsPage(c: C, s: State, a: Actor, draft?: Data, error?: string, status = 200) {
  const v = reminderView(s, a), zone = businessZone(s.find('business', 'main'))
  const record = v.reminders.find((r: Data) => r.id === c.req.query('reminder'))
  const id = draft?.interview ?? record?.interview ?? c.req.query('interview'), iv = v.interviews.find((item: Data) => item.id === id) ?? v.interviews[0]
  return page(heading, `<h1>${heading}</h1><p><a href="/app">Back to workspace</a> · <a href="/application-emails/settings">Email transport settings</a></p>
${error ? `<p role="alert">${esc(error)}</p>` : c.req.query('saved') ? '<p role="status">Saved</p>' : ''}<p>Email transport: ${v.transportReady ? 'Ready for provider handoff' : 'Unavailable'}.</p>
<details class="disclosure"><summary>How reminders work</summary><p>Reminders start off. Enable each reviewed reminder explicitly. Attempts follow its business hours, weekdays and limit while the interview still needs this action. Upcoming interview reminders run once before the interview; scorecard reminders wait until it finishes. Cancel an existing reminder before enabling its replacement.</p><p>A provider handoff confirms provider acceptance, not delivery. Only a recorded delivery outcome confirms delivery. Escalation sends a separate factual email to the named manager after the reminder limit.</p></details>
${iv ? `<form action="${path}" method="get"><label>Interview<select name="interview" aria-label="Interview" required>${v.interviews.map((item: Data) => option(item.id, `${item.title} · ${item.status}`, iv.id)).join('')}</select></label><button>Open interview reminders</button></form><h2>${esc(iv.title)}</h2>${reminderForm(s, a, iv, v.members, record, draft)}` : '<p>No interviews are available. Create an interview in the workspace to configure a reminder.</p>'}
<h2>Reminder settings and outcomes</h2>${v.reminders.length ? v.reminders.map((r: Data) => reminderCard(r, zone, r.id === record?.id)).join('') : '<p>No reminders configured.</p>'}`, status)
}

reminderPages.get(path, async c => { const { s, a } = await staff(c); return settingsPage(c, s, a) })
reminderPages.post(path, async c => {
  await sameOrigin(c)
  const { s, a } = await staff(c), form = await formBody(c)
  const value = (key: string) => { const v = form.get(key); return typeof v === 'string' ? v : '' }
  const draft: Data = Object.fromEntries(['interview', 'kind', 'recipient', 'owner', 'escalation', 'dueAt', 'language', 'subject', 'body', 'footer'].map(key => [key, value(key)]))
  for (const key of ['cadenceHours', 'maxAttempts', 'startHour', 'endHour']) draft[key] = value(key) === '' ? undefined : Number(value(key))
  draft.weekdays = form.getAll('weekdays').map(Number)
  draft.enabled = form.get('enabled') === 'yes'
  try {
    if (value('action') === 'cancel') cancelReminder(s, a, { id: value('reminder'), reason: value('reason') })
    else {
      requireThat(value('action') === 'configure', 'Choose a reminder action')
      requireThat(form.get('reviewed') === 'yes', 'Review the exact subject, body and footer first')
      requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.dueAt), 'Enter the first due date and time in the business time zone')
      const zone = businessZone(s.find('business', 'main')), dueAt = instantOf(draft.dueAt, zone)
      requireThat(new Date(toWall(Date.parse(dueAt), zone)).toISOString().slice(0, 16) === draft.dueAt, 'Choose a valid local date and time')
      await configureReminder(s, a, { ...draft, dueAt, reviewed: true })
    }
    await save(c.env.DB, s, a)
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    return settingsPage(c, s, a, value('action') === 'cancel' ? undefined : draft, error.message, error.status)
  }
  return c.redirect(path + '?saved=1', 303)
})
