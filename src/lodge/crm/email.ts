import type { Bindings } from '../../auth.server'
import { load } from '../core/store'
import { captureEmail } from '../records/capture'
import { nurtureEmail } from './inbound'

/** Existing capture custody is unchanged; the explicit nurture address has its own stop-only receiver. */
export async function lodgeEmail(message: ForwardableEmailMessage, env: Bindings) {
  const s = await load(env.DB), route = s.find('crm-reply-route', 'main')
  if (route?.address && message.to.toLowerCase() === route.address.toLowerCase()) return nurtureEmail(message, env)
  return captureEmail(message, env)
}
