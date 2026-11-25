import { runWeeklyReports } from '../reports/schedules'
import { scheduledAnalysis } from '../analysis/schedules'
import { runNurture } from '../crm/run'
import { runReminders } from '../reminders/run'
import { flushApplicationEmails } from '../communications/deliver'
import { surveyMaintenance } from '../surveys/http'
import type { Bindings } from '../../auth.server'
import { resumeIntakeMaintenance } from '../resumes/maintenance'
import { flushReferralEmails } from '../referrals/email'
import { flushAlerts, sendDigests } from './deliver'
import { maintenanceDue } from './due'
import { markSwept } from '../core/store'

/**
 * The hourly scheduled run: upkeep, due work, then every daily digest whose 8:00 has come round.
 * Each step starts from an indexed probe (due.ts), so a company with nothing due costs a few rows
 * an hour, however much history it holds.
 */
export async function scheduledRun(controller: ScheduledController, env: Bindings) {
  const due = await maintenanceDue(env.DB, controller.scheduledTime)
  if (due.surveys) await surveyMaintenance(env)
  if (due.intakes) await resumeIntakeMaintenance(controller, env)
  await scheduledAnalysis(env, controller.scheduledTime)
  await runWeeklyReports(env, controller.scheduledTime)
  if (due.nurture) await runNurture(env, controller.scheduledTime)
  if (due.reminders) await runReminders(env, controller.scheduledTime)
  await flushApplicationEmails(env)
  await sendDigests(env, controller.scheduledTime)
  // Looked over as it stood at the start; this run's own writes leave one more look, then the store is settled.
  await markSwept(env.DB, due.n)
}

/** TEAM-002/003: the immediate emails a write queued in its own save go out once it has committed, whichever door it came through. */
export async function afterWrite(request: Request, response: Response, env: Bindings) {
  const path = new URL(request.url).pathname
  const mailConfiguration = path === '/application-emails/settings' || /^\/api\/lodge\/command\/application-email-(policy|template)$/.test(path)
  if (!['GET', 'HEAD'].includes(request.method) && response.status < 400) { if (!mailConfiguration) await flushApplicationEmails(env); await flushAlerts(env); await flushReferralEmails(env) }
  return response
}
