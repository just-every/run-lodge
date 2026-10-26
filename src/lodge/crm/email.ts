import type { Bindings } from '../../auth.server'
import { captureEmail } from '../records/capture'
import { nurtureEmail } from './inbound'

/** Existing capture custody is unchanged; the explicit nurture address has its own stop-only receiver. */
export async function lodgeEmail(message: ForwardableEmailMessage, env: Bindings) {
  if (env.CRM_REPLY_ADDRESS && message.to.toLowerCase() === env.CRM_REPLY_ADDRESS.toLowerCase()) return nurtureEmail(message, env)
  return captureEmail(message, env)
}
