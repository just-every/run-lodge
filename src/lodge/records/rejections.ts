import type { State } from '../core/state'
import { managesVacancy, requireAdmin } from '../core/access'
import { businessZone, fromWall, toWall } from '../core/time'
import { integer, list, now, oneOf, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { cancelTasks } from './tasks'

// DISP-001: the employer's rejection reasons, grouped as "we rejected them" and
// "they withdrew", used for every close (a person's move, a confirmed or
// automatic screening rule); rejection templates; and the rejection email a
// close schedules now, after a number of business days, or not at all.
//
// Lodge has no candidate mailbox until COM-001 connects one, so a scheduled
// email is never sent: once its time passes it reads "due, not sent", never
// "sent". Reopening the application (DISP-002) cancels it; erasing the
// candidate deletes it with their other records.

export const GROUPS = ['rejected', 'withdrew'] as const
export const GROUP_LABELS: Record<(typeof GROUPS)[number], string> = { rejected: 'We rejected them', withdrew: 'They withdrew' }

/** The list every business starts with, until an admin saves its own. */
export const DEFAULT_REASONS: Data[] = [
  { id: 'skills', label: 'Skills or experience do not match', group: 'rejected' },
  { id: 'certification', label: 'Lacks required certification', group: 'rejected' },
  { id: 'another-candidate', label: 'Hired another candidate', group: 'rejected' },
  { id: 'work-authorization', label: 'Not authorized to work in the US', group: 'rejected' },
  { id: 'position-closed', label: 'Position closed', group: 'rejected' },
  { id: 'pay-expectation', label: 'Pay expectation above the range', group: 'rejected' },
  { id: 'availability', label: 'Location or availability does not fit', group: 'rejected' },
  { id: 'no-show', label: 'Did not respond or attend', group: 'rejected' },
  { id: 'other-offer', label: 'Accepted another offer', group: 'withdrew' },
  { id: 'pay', label: 'Pay or benefits', group: 'withdrew' },
  { id: 'location', label: 'Location or schedule', group: 'withdrew' },
  { id: 'no-response', label: 'Stopped responding', group: 'withdrew' },
]

/** Every reason ever on the list; retired ones keep their label for history and reports but take no new close. */
export const reasons = (s: State): Data[] => s.find('rejection-reasons', 'main')?.reasons ?? DEFAULT_REASONS

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reason'

/** An admin saves the whole list. An entry left out is retired, never deleted, so closes that used it still read. */
export function rejectionReasons(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const before = reasons(s)
  const given = list(b.reasons, 'Reasons', 60, (x: any) => ({ id: typeof x?.id === 'string' && x.id ? x.id : undefined, label: text(x?.label, 'Reason name', 120), group: oneOf(x?.group, GROUPS, 'Group') }))
  const labels = given.map(x => x.label.toLowerCase())
  requireThat(new Set(labels).size === labels.length, 'Each reason needs its own name')
  for (const g of GROUPS) requireThat(given.some(x => x.group === g), `Keep at least one “${GROUP_LABELS[g]}” reason`)
  const taken = new Set(before.map(r => r.id))
  const saved = given.map(x => {
    const known = x.id && before.find(r => r.id === x.id)
    requireThat(!x.id || known, 'That reason is not on the list')
    if (known) { requireThat(known.group === x.group, `“${known.label}” stays in its group; retire it and add a new reason instead`); return { id: known.id, label: x.label, group: x.group } }
    let id = slug(x.label)
    for (let n = 2; taken.has(id); n++) id = `${slug(x.label)}-${n}`
    taken.add(id)
    return { id, label: x.label, group: x.group }
  })
  const kept = new Set(saved.map(r => r.id))
  // A reason a live screening rule proposes stays on the list until that rule changes (SCREEN-002).
  for (const rule of s.all('screening-rule').filter(r => r.active)) {
    const then = rule.versions.at(-1).then
    requireThat(then.kind !== 'propose-reject' || kept.has(then.closeReason), `Rule “${rule.name}” proposes “${before.find(r => r.id === then.closeReason)?.label}”; change the rule before retiring that reason`, 409)
  }
  const retired = before.filter(r => !kept.has(r.id)).map(r => ({ ...r, retired: true }))
  const record = s.put('rejection-reasons', 'main', { reasons: [...saved, ...retired], by: a.email, at: now() })
  s.audit(a, 'rejection-reasons-saved', 'business:main', { active: saved.length, retired: retired.length })
  return record
}

export const MERGE_FIELDS = ['candidate_name', 'job_title', 'business_name'] as const

/** An admin keeps the rejection templates; editing one never changes an email already scheduled from it. */
export function rejectionTemplate(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const current = b.id ? s.get('rejection-template', b.id, 'template') : null
  const fields = { name: text(b.name, 'Template name', 120), subject: text(b.subject, 'Subject', 200), body: text(b.body, 'Message', 20000), retired: b.retired === true }
  for (const field of `${fields.subject} ${fields.body}`.match(/\{[^{}]*\}/g) ?? [])
    requireThat((MERGE_FIELDS as readonly string[]).includes(field.slice(1, -1)), `Unknown merge field ${field}; use ${MERGE_FIELDS.map(f => `{${f}}`).join(', ')}`)
  if (current && fields.retired) for (const rule of s.all('screening-rule').filter(r => r.active))
    requireThat(rule.versions.at(-1).then.template !== current.id, `Rule “${rule.name}” sends “${current.name}”; change the rule before retiring the template`, 409)
  const record = s.put('rejection-template', current?.id ?? uid(), { ...(current ?? { createdBy: a.email, createdAt: now() }), ...fields, editedBy: a.email, editedAt: now() })
  s.audit(a, current ? 'rejection-template-edited' : 'rejection-template-created', 'rejection-template:' + record.id)
  return record
}

/**
 * `days` business days after `iso`, at the same wall-clock time in the business's
 * time zone. Saturdays and Sundays are skipped; public holidays are not.
 */
export function addBusinessDays(iso: string, days: number, zone: string) {
  let wall = toWall(Date.parse(iso), zone)
  for (let left = days; left > 0;) {
    wall += 86_400_000
    const weekday = new Date(wall).getUTCDay()
    if (weekday !== 0 && weekday !== 6) left--
  }
  return fromWall(wall, zone)
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(candidate_name|job_title|business_name)\}/g, (_, k) => values[k])

/** What a close asks for: a reason from the list, an optional note, and for a rejection the email choice. */
export interface CloseChoice { to: 'rejected' | 'withdrawn'; reason: Data; note: string; email: null | { template: Data; send: 'now' | 'delay'; businessDays: number } }

export function closeChoice(s: State, to: 'rejected' | 'withdrawn', b: Data): CloseChoice {
  const reason = reasons(s).find(r => r.id === b.closeReason)
  requireThat(reason, `Choose why: a reason from the ${to === 'rejected' ? '“We rejected them”' : '“They withdrew”'} list`)
  requireThat(!reason.retired, `“${reason.label}” is retired; choose a current reason`)
  requireThat(reason.group === (to === 'rejected' ? 'rejected' : 'withdrew'), `“${reason.label}” is a “${GROUP_LABELS[reason.group as 'rejected']}” reason`)
  const send = oneOf(b.send ?? 'none', ['none', 'now', 'delay'] as const, 'When to send the rejection email')
  if (send === 'none') {
    requireThat(!b.template, 'Choose when to send the rejection email, or no email')
    return { to, reason, note: optionalText(b.reason, 'Note', 2000), email: null }
  }
  requireThat(to === 'rejected', 'A rejection email goes only with a rejection, not a withdrawal', 400)
  requireThat(typeof b.template === 'string' && b.template, 'Choose a rejection template')
  const template = s.get('rejection-template', b.template, 'rejection template')
  requireThat(!template.retired, 'That rejection template is retired')
  return { to, reason, note: optionalText(b.reason, 'Note', 2000), email: { template, send, businessDays: send === 'delay' ? integer(b.businessDays, 'Business days to wait', 1, 20) : 0 } }
}

/** Close an active application with its reason, cancel its tasks, and schedule the chosen rejection email. */
export function closeApplication(s: State, app: Data, choice: CloseChoice, actor: string, extra: Data = {}) {
  const at = now()
  const record = s.put('application', app.id, { ...app, status: choice.to, closedAt: at })
  const label = choice.reason.label
  s.put('stage-event', uid(), { application: app.id, from: app.stage, to: choice.to, reason: label, ...(choice.note ? { note: choice.note } : {}), closeReason: choice.reason.id, closeGroup: choice.reason.group, actor, at, ...extra })
  cancelTasks(s, app.id, `Application ${choice.to}`)
  if (choice.email) {
    const candidate = s.get('candidate', app.candidate), vacancy = s.get('vacancy', app.vacancy), business = s.find('business', 'main')
    requireThat(candidate.email, 'This candidate has no email address; choose no email', 409)
    const values = { candidate_name: candidate.name, job_title: vacancy.title, business_name: business?.name ?? '' }
    const { template, send, businessDays } = choice.email
    s.put('rejection-email', uid(), {
      application: app.id, vacancy: app.vacancy, candidate: candidate.id, to: candidate.email, template: template.id, templateName: template.name,
      subject: fill(template.subject, values), body: fill(template.body, values), send, businessDays,
      sendAt: send === 'now' ? at : addBusinessDays(at, businessDays, businessZone(business)), status: 'scheduled', scheduledBy: actor, scheduledAt: at,
    })
  }
  return record
}

/** Every scheduled rejection email of an application is canceled, so it can never send. */
export function cancelRejectionEmails(s: State, applicationId: string, reason: string) {
  for (const m of s.all('rejection-email').filter(m => m.application === applicationId && m.status === 'scheduled'))
    s.put('rejection-email', m.id, { ...s.get('rejection-email', m.id), status: 'canceled', canceledAt: now(), canceledReason: reason })
}

/** How a rejection email reads now: waiting for its time, due but not sent (no COM-001 mailbox), or canceled. */
export function emailState(m: Data, at = now()) {
  if (m.status === 'canceled') return 'canceled'
  return m.sendAt > at ? 'scheduled' : 'due-not-sent'
}

/** Reasons for everyone; templates and the jobs' rejection emails for the people who run those jobs. */
export function rejectionsView(s: State, a: Actor, visibleApps: Set<string>) {
  const runs = (id: string) => { const v = s.find('vacancy', id); return !!v && managesVacancy(a, v) }
  const runsAny = s.all('vacancy').some(v => runs(v.id))
  return {
    rejectionReasons: reasons(s),
    rejectionTemplates: runsAny || a.owner || a.roles.includes('admin') ? s.all('rejection-template').sort((x, y) => x.name.localeCompare(y.name)) : [],
    rejectionEmails: s.all('rejection-email').filter(m => visibleApps.has(m.application) && runs(m.vacancy)).sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt)).map((m): Data => ({ ...m, state: emailState(m) })),
  }
}
