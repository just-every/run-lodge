import type { State } from '../core/state'
import { can, has, isAdmin } from '../core/access'
import { businessZone, isZone, times } from '../core/time'
import { requireThat, type Actor, type Data } from '../core/types'
import { reasons } from '../records/rejections'
import type { WorkspaceRecords } from './workspace'

export type CohortFilter = { vacancy?: string; from?: string; to?: string; timeZone?: string; history?: string }
const calendarDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const timestamp = (value: unknown): value is string => typeof value === 'string' && (calendarDate(value) || /^\d{4}-\d{2}-\d{2}T/.test(value)) && Number.isFinite(Date.parse(value))

/** Scope before counting: report rows use the same field and blind projection as the workspace. */
export function cohortReport(s: State, a: Actor, w: WorkspaceRecords, input: CohortFilter = {}, exporting = false) {
  requireThat(isAdmin(a) || has(a, 'manager'), 'Only admins and hiring managers see cohort reports', 403)
  const zone = input.timeZone || businessZone(s.find('business', 'main'))
  requireThat(isZone(zone), 'Choose a valid reporting time zone')
  for (const date of [input.from, input.to]) requireThat(!date || calendarDate(date), 'Use a valid calendar date')
  requireThat(!input.from || !input.to || input.from <= input.to, 'The end date must follow the start date')
  const history = input.history || 'all'
  requireThat(['all', 'native', 'imported'].includes(history), 'Choose all, native or imported history')
  const jobs = w.vacancies.filter(v => v.manages)
  requireThat(!input.vacancy || jobs.some(v => v.id === input.vacancy), 'Report job not found', 404)
  const selected = jobs.filter(v => !input.vacancy || v.id === input.vacancy)
  if (exporting) requireThat(selected.every(v => can(s, a, s.get('vacancy', v.id), 'export')), 'Your permission level does not let you export this report', 403)
  const ids = new Set(selected.map(v => v.id)), day = times(zone).dateOf, listed = reasons(s)
  const eligible = w.applications.filter(app => ids.has(app.vacancy) && app.status !== 'spam' && (history === 'all' || !!app.imported === (history === 'imported')))
  const missingSubmission = eligible.filter(app => !timestamp(app.submittedAt)).length
  const apps = eligible.filter(app => {
    if (!timestamp(app.submittedAt)) return !input.from && !input.to
    const date = day(app.submittedAt)
    return (!input.from || date >= input.from) && (!input.to || date <= input.to)
  })
  const rows = apps.map(app => {
    const job = selected.find(v => v.id === app.vacancy)!
    const accepted = w.offers.filter(o => o.application === app.id && o.status === 'accepted')
    const dated = accepted.filter(o => timestamp(o.outcomeAt)).sort((x, y) => x.outcomeAt.localeCompare(y.outcomeAt))
    const offer = dated[0], submittedAt = timestamp(app.submittedAt) ? app.submittedAt : null
    const acceptedAt = offer?.outcomeAt ?? null
    const elapsed = submittedAt && acceptedAt ? Math.round((Date.parse(day(acceptedAt)) - Date.parse(day(submittedAt))) / 86400000) : null
    const daysToHire = elapsed !== null && elapsed >= 0 ? elapsed : null
    const closed = app.status === 'rejected' || app.status === 'withdrawn'
    const event = closed ? [...app.history].reverse().find((e: Data) => e.to === app.status) : null
    const reason = closed ? listed.find(r => r.id === event?.closeReason) : null
    return {
      application: app.id, candidateName: app.candidateName, vacancy: job.id, job: job.title,
      status: app.status, imported: !!app.imported, submittedAt, acceptedAt, daysToHire,
      timing: !can(s, a, s.get('vacancy', job.id), 'offers') ? 'Offer access unavailable' : daysToHire !== null ? 'Measured' : app.status === 'hired' || accepted.length ? 'Missing or invalid timing history' : 'No accepted offer',
      closeReason: closed ? reason?.id ?? null : null, closeLabel: closed ? reason?.label ?? 'No listed reason' : null,
      link: '/app?application=' + encodeURIComponent(app.id),
    }
  }).sort((x, y) => x.job.localeCompare(y.job) || x.application.localeCompare(y.application))
  const measured = rows.filter(r => r.daysToHire !== null)
  const statuses = ['active', 'rejected', 'withdrawn', 'transferred', 'hired']
  const breakdown = ['rejected', 'withdrawn'].flatMap(status => {
    const closed = rows.filter(r => r.status === status)
    return [...new Set(closed.map(r => r.closeReason))].map(reason => ({ status, reason, label: closed.find(r => r.closeReason === reason)!.closeLabel, count: closed.filter(r => r.closeReason === reason).length }))
  })
  return {
    filter: { vacancy: input.vacancy || null, from: input.from || null, to: input.to || null, timeZone: zone, history },
    jobs: jobs.map(v => ({ id: v.id, title: v.title })), rows, reasons: breakdown,
    totals: { applications: rows.length, statuses: Object.fromEntries(statuses.map(status => [status, rows.filter(r => r.status === status).length])), measuredHires: measured.length, meanDaysToHire: measured.length ? measured.reduce((n, r) => n + r.daysToHire!, 0) / measured.length : null },
    disclosures: { missingSubmission, excludedUndated: input.from || input.to ? missingSubmission : 0, incompleteHireTiming: rows.filter(r => r.timing === 'Missing or invalid timing history').length, offerAccessUnavailable: rows.filter(r => r.timing === 'Offer access unavailable').length },
    definitions: {
      cohort: 'Non-spam applications by original submission date, inclusive of both dates in the selected time zone. Reopening never resets submission. Unknown submission dates remain visible without a date filter and are excluded with a date filter, with the excluded count disclosed.',
      timeToHire: 'Calendar days in the selected time zone from original submission to the earliest recorded accepted offer. Mean denominator: only applications with both valid dates and a nonnegative interval. No accepted offer, unavailable offer access and missing history are distinct; no date is invented.',
      reasons: 'Each currently rejected or withdrawn application counts once by its latest matching close event and listed DISP-001 reason. Active reopened applications, hires, transfers and spam do not count as closes. Unknown imported reasons are shown as No listed reason.',
      history: 'Native and imported records can be selected separately. Imported timestamps are used only when recorded and valid; imports remain inert. Counts and underlying records reflect current job, private-candidate, permission and blind-review scope. This report does not calculate offer acceptance or cost per hire.',
    },
  }
}
