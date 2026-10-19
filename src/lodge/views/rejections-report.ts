import type { State } from '../core/state'
import { has, isAdmin } from '../core/access'
import type { Actor, Data } from '../core/types'
import { GROUP_LABELS, reasons } from '../records/rejections'
import type { WorkspaceRecords } from './workspace'

/**
 * DISP-001 in REPORT-001's first slice: for each job the reader runs, its closed
 * applications counted by the reason of their current close, grouped as "we
 * rejected them" and "they withdrew". A reopened application counts only if it
 * closed again, under its latest reason; spam, transfers and hires are not closes
 * here. A close recorded before the reason list (imported or older history)
 * counts as "No listed reason".
 */
export function rejectionsReport(s: State, a: Actor, w: WorkspaceRecords) {
  if (!isAdmin(a) && !has(a, 'manager')) return null
  const listed = reasons(s)
  const jobs = w.vacancies.filter(v => v.manages && !v.imported).map((v: Data) => {
    const counts = new Map<string, number>()
    for (const app of w.applications.filter(x => x.vacancy === v.id && (x.status === 'rejected' || x.status === 'withdrawn'))) {
      const close = [...app.history].reverse().find((e: Data) => e.to === app.status)
      const key = close?.closeReason ?? `unlisted:${app.status}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const rows = [...counts].map(([key, count]) => {
      const r = listed.find(x => x.id === key)
      const group = r?.group ?? (key === 'unlisted:rejected' ? 'rejected' : 'withdrew')
      return { reason: r?.id ?? null, label: r?.label ?? 'No listed reason', group, groupLabel: GROUP_LABELS[group as 'rejected'], retired: !!r?.retired, count }
    }).sort((x, y) => x.group.localeCompare(y.group) || y.count - x.count || x.label.localeCompare(y.label))
    return { id: v.id, title: v.title, rejected: rows.filter(r => r.group === 'rejected'), withdrew: rows.filter(r => r.group === 'withdrew') }
  })
  return { jobs, definitions: 'Each closed application counts once, under the reason of its current close. Spam, transfers and hires are not closes; reopened applications that are active again are not counted.' }
}
