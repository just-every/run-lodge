import { surveyMaintenance } from '../surveys/http'
import type { Bindings } from '../../auth.server'
import { resumeIntakeMaintenance } from '../resumes/maintenance'
import { flushReferralEmails } from '../referrals/email'
import { flushAlerts, sendDigests } from './deliver'

/** The hourly scheduled run: resume intake upkeep, then every daily digest whose 8:00 has come round. */
export async function scheduledRun(controller: ScheduledController, env: Bindings) {
  await surveyMaintenance(env)
  await resumeIntakeMaintenance(controller, env)
  await sendDigests(env, controller.scheduledTime)
}

/** TEAM-002/003: the immediate emails a write queued in its own save go out once it has committed, whichever door it came through. */
export async function afterWrite(request: Request, response: Response, env: Bindings) {
  if (!['GET', 'HEAD'].includes(request.method) && response.status < 400) { await flushAlerts(env); await flushReferralEmails(env) }
  return response
}
