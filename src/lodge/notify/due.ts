import { generation } from '../core/store'

// What is waiting to be done, asked of D1 with indexed probes (migration 0025). Each
// probe reads the rows that match and no others, so a quiet company costs a handful of
// rows per scheduled run however long its history, and work only loads the store when
// there is some. Every probe over-asks rather than under-asks: a "yes" can find the
// work already done, a "no" never hides work.

const iso = (at: number) => new Date(at).toISOString()
const some = async (db: D1Database, sql: string, ...binds: unknown[]) => !!(await db.prepare(sql + ' LIMIT 1').bind(...binds).first())

/** A queued application email whose time has come (a delayed status email waits for its dueAt). */
export const applicationMailDue = (db: D1Database, at = Date.now()) => some(db,
  "SELECT 1 FROM l_records WHERE kind='application-email' AND json_extract(value,'$.status')='pending' AND (json_extract(value,'$.dueAt') IS NULL OR json_extract(value,'$.dueAt') <= ?)", iso(at))

export const alertQueued = (db: D1Database) => some(db,
  "SELECT 1 FROM l_records WHERE kind='alert' AND json_extract(value,'$.emailState')='queued'")

/** A daily digest whose 8:00 has come round. */
export const digestDue = (db: D1Database, at: number) => some(db,
  "SELECT 1 FROM l_records WHERE kind='alert' AND json_extract(value,'$.emailState')='digest' AND json_extract(value,'$.digestAt') <= ?", iso(at))

export const referralMailQueued = (db: D1Database) => some(db,
  "SELECT 1 FROM l_records WHERE kind='referral-email' AND json_extract(value,'$.emailState')='queued'")

const SURVEY_KINDS = ['survey-invitation', 'survey-response', 'survey-stop', 'survey-denominator', 'survey-consent', 'survey-receipt']
const nowOrUndated = (kind: string, status: string) =>
  `kind='${kind}' AND json_extract(value,'$.status')${status} AND (json_extract(value,'$.nextDueAt') IS NULL OR json_extract(value,'$.nextDueAt') <= ?)`

/**
 * Which of the hourly run's maintenance jobs have anything to do. A job that decides across the
 * whole store runs when something of its own is due, and, if any of its records exist, when
 * a write has landed since the last run that found the store settled, or at the first run of
 * the day (midnight UTC). A write is what can make a plan ineligible, and a person who stopped
 * being eligible is noticed on the next run after it; the daily run catches what only time
 * changes (a consent or retention date passing). Sending is never left to this: each email
 * re-checks its sender, policy and recipient when it goes out. `n` is the write counter the
 * answer was given at; the caller records it once the jobs have run.
 */
export async function maintenanceDue(db: D1Database, at: number) {
  const { n, swept } = await generation(db)
  const looking = n !== swept || new Date(at).getUTCHours() === 0, now = iso(at), marks = SURVEY_KINDS.map(() => '?').join(',')
  const [surveyExpired, surveyAny, intakes, nurtureDue, nurtureAny, remindersDue, remindersAny] = await Promise.all([
    some(db, `SELECT 1 FROM l_records WHERE kind IN (${marks}) AND json_extract(value,'$.expiresAt') <= ?`, ...SURVEY_KINDS, now),
    looking && some(db, `SELECT 1 FROM l_records WHERE kind IN (${marks})`, ...SURVEY_KINDS),
    some(db, "SELECT 1 FROM l_records WHERE kind='resume-intake' AND json_extract(value,'$.status') <> 'committed'"),
    some(db, `SELECT 1 FROM l_records WHERE ${nowOrUndated('crm-enrollment', "='active'")}`, now),
    looking && some(db, "SELECT 1 FROM l_records WHERE kind='crm-enrollment' AND json_extract(value,'$.status') IN ('active','completed')"),
    some(db, `SELECT 1 FROM l_records WHERE ${nowOrUndated('hiring-reminder', "='queued'")}`, now),
    looking && some(db, "SELECT 1 FROM l_records WHERE kind='hiring-reminder' AND json_extract(value,'$.status') IN ('queued','completed')"),
  ])
  return { n, surveys: surveyExpired || surveyAny, intakes, nurture: nurtureDue || nurtureAny, reminders: remindersDue || remindersAny }
}
