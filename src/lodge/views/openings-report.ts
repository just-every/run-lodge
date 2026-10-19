import type { State } from '../core/state'
import { has, isAdmin } from '../core/access'
import { businessZone, times } from '../core/time'
import type { Actor, Data } from '../core/types'
import { subtree } from '../records/org'
import type { WorkspaceRecords } from './workspace'

/**
 * REQ-001 and REQ-004 in REPORT-001's first slice: for the jobs the reader runs,
 * optionally only those in a department (with its sub-departments) or an office
 * (the job's own, or an opening's), each opening's status and time to fill, and
 * the applications funnel summed across those jobs. Time to fill counts whole
 * calendar days, in the business's time zone, from the opening's own open date
 * to its filled date; spam never counts as an applicant.
 */
export function openingsReport(s: State, a: Actor, w: WorkspaceRecords, filter: { department?: string; office?: string }) {
  if (!isAdmin(a) && !has(a, 'manager')) return null
  const day = times(businessZone(s.find('business', 'main'))).dateOf
  const days = (from: string, to: string) => Math.round((Date.parse(day(to)) - Date.parse(day(from))) / 86400000)
  const within = filter.department && s.find('department', filter.department) ? subtree(s, filter.department) : null
  const officeOf = (v: Data, o: Data) => o.officeId ?? v.officeId
  const jobs = w.vacancies.filter(v => v.manages && !v.imported && (!within || within.has(v.departmentId)) && (!filter.office || v.officeId === filter.office || (v.openings ?? []).some((o: Data) => o.officeId === filter.office)))
  const openings = jobs.flatMap(v => (v.openings ?? []).filter((o: Data) => !filter.office || officeOf(v, o) === filter.office).map((o: Data) => ({
    vacancy: v.id, title: v.title, opening: o.code, status: o.status, office: officeOf(v, o) ?? null, openedAt: o.openedAt ?? null, filledAt: o.filledAt ?? null,
    daysToFill: o.status === 'filled' && o.openedAt ? days(o.openedAt, o.filledAt) : null,
  })))
  const funnel = { applicants: 0, active: 0, rejected: 0, withdrawn: 0, transferred: 0, hired: 0, spam: 0 }
  for (const v of jobs) {
    const f = v.funnel
    funnel.applicants += f.applicants; funnel.spam += f.spam; funnel.rejected += f.rejected; funnel.withdrawn += f.withdrawn; funnel.transferred += f.transferred; funnel.hired += f.hired
    funnel.active += Object.values(f.stages as Record<string, number>).reduce((n, x) => n + x, 0)
  }
  // ATTR-005: internal applications and moves apart from external applicants and hires.
  const ids = new Set(jobs.map(v => v.id))
  const apps = w.applications.filter(x => ids.has(x.vacancy) && x.status !== 'spam')
  const internal = { applications: apps.filter(x => x.internal).length, moves: apps.filter(x => x.internal && x.status === 'hired').length }
  const external = { applications: apps.length - internal.applications, hires: apps.filter(x => !x.internal && x.status === 'hired').length }
  return {
    filter: { department: within ? filter.department : null, office: filter.office ?? null }, jobs: jobs.map(v => ({ id: v.id, title: v.title })), openings, funnel, internal, external,
    definitions: 'Time to fill: whole calendar days in the business time zone from the opening’s own open date to its filled date. Funnel: non-spam applications to the jobs shown, by current status. Internal moves: hires from internal (ATTR-005) applications; external hires: every other hire.',
  }
}
