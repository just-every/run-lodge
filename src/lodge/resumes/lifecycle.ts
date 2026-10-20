import type { State } from '../core/state'
import { isAdmin, requireAdmin } from '../core/access'
import { actorFor } from '../core/store'
import { requireThat, type Actor, type Data } from '../core/types'
import { requireIntakeScope } from './scope'

const DAY = 86400000
export const intakeRetentionDays = (s: State): number => s.find('resume-intake-settings', 'main')?.retentionDays ?? 30
// Older uploads have the original thirty-day deadline; changing settings never extends a saved upload.
export const intakeDeadline = (row: Data): string => row.expiresAt ?? new Date(Date.parse(row.uploadedAt) + 30 * DAY).toISOString()
export const intakeExpired = (row: Data, at = Date.now()) => row.status !== 'committed' && Date.parse(intakeDeadline(row)) <= at
export const newIntakeDeadline = (s: State, uploadedAt: string) => new Date(Date.parse(uploadedAt) + intakeRetentionDays(s) * DAY).toISOString()

/** The saved membership and the current job/level/grant records decide orphan status, never the requesting admin. */
function orphaned(s: State, row: Data) {
 const member = s.find('member', row.by)
 if (!member?.active || member.agent) return true
 try {
  const uploader = actorFor({ id: '', operator: { id: '', email: row.by, displayName: member.name, role: member.owner ? 'owner' : 'operator', version: 0 } }, s)
  requireIntakeScope(s, uploader, row.vacancy)
  return false
 } catch { return true }
}

export function intakeLifecycleView(s: State, a: Actor) {
 return { resumeIntakePolicy: { retentionDays: intakeRetentionDays(s) },
  ...(isAdmin(a) && !a.agent ? { orphanedResumeIntakeCount: s.all('resume-intake').filter(row => row.status !== 'committed' && orphaned(s, row)).length } : {}) }
}

export function intakeSettings(s: State, a: Actor, b: Data) {
 requireAdmin(a)
 requireThat(!a.agent, 'A person sets resume retention', 403)
 const days = Number(b.retentionDays)
 requireThat(Number.isSafeInteger(days) && days > 0 && Number.isFinite(new Date(Date.now() + days * DAY).getTime()), 'Enter a positive whole number of days')
 const record = s.put('resume-intake-settings', 'main', { retentionDays: days })
 s.audit(a, 'resume-intake-retention-set', 'resume-intake-settings:main', { retentionDays: days })
 return record
}

function removePending(s: State, row: Data) {
 // The intake revision is the ownership fence: a concurrent commit keeps its document and bytes.
 s.get('resume-intake', row.id)
 s.drop('blob', row.id)
 s.remove('resume-intake', row.id)
}

/** Count-only bulk discard. No admin receives a filename, decoded text, blob or review token. */
export function discardOrphanedIntakes(s: State, a: Actor) {
 requireAdmin(a)
 requireThat(!a.agent, 'A person discards abandoned resumes', 403)
 // actorFor expands department grants; fence that hierarchy as well as each membership/job/level read.
 s.scan('department')
 const rows = s.scan('resume-intake').filter(row => row.status !== 'committed' && orphaned(s, row))
 for (const row of rows) removePending(s, row)
 s.audit(a, 'resume-intakes-discarded', 'resume-intake:pending', { count: rows.length, reason: 'uploader-access-lost' })
 return { discarded: rows.length }
}

/** Called by the Worker's real scheduled handler; deletion and its safe receipt share one fenced transaction. */
export function expireIntakes(s: State, at: number) {
 const rows = s.scan('resume-intake').filter(row => intakeExpired(row, at))
 for (const row of rows) removePending(s, row)
 if (rows.length) s.audit(null, 'resume-intakes-expired', 'resume-intake:pending', { count: rows.length })
 return { expired: rows.length }
}
