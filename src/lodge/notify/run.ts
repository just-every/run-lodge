import { runApprovalEscalations } from '../records/approval-escalations'
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

/** The hourly scheduled run: resume intake upkeep, then every daily digest whose 8:00 has come round. */
export async function scheduledRun(controller: ScheduledController, env: Bindings) {
  await runApprovalEscalations(env, controller.scheduledTime)
  await surveyMaintenance(env)
  await resumeIntakeMaintenance(controller, env)
  await scheduledAnalysis(env, controller.scheduledTime)
  await runWeeklyReports(env, controller.scheduledTime)
  await runNurture(env, controller.scheduledTime)
  await runReminders(env, controller.scheduledTime)
  await flushApplicationEmails(env)
  await sendDigests(env, controller.scheduledTime)
}

/** TEAM-002/003: the immediate emails a write queued in its own save go out once it has committed, whichever door it came through. */
export async function afterWrite(request: Request, response: Response, env: Bindings) {
  const path = new URL(request.url).pathname
  const mailConfiguration = path === '/application-emails/settings' || /^\/api\/lodge\/command\/application-email-(policy|template)$/.test(path)
  if (!['GET', 'HEAD'].includes(request.method) && response.status < 400) { if (!mailConfiguration) await flushApplicationEmails(env); await flushAlerts(env); await flushReferralEmails(env) }
  return response
}
