import { authResponse, type Bindings } from '../../auth.server'
import { api } from '../http/api'
import { applicationEmailPages } from '../http/application-email-pages'
import { afterWrite, scheduledRun } from '../notify/run'
import { crmPages } from './pages'
import { crmReplyPages } from './reply-pages'
import { lodgeEmail } from './email'

/** Optional native mail receiver, bound to the same installation database and auth configuration. */
export default {
  email: lodgeEmail,
  scheduled: scheduledRun,
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname
    const auth = await authResponse(request, env)
    if (auth) return auth
    const response = path.startsWith('/crm/reply/') ? await crmReplyPages.fetch(request, env, ctx)
      : path === '/crm' || path.startsWith('/crm/') ? await crmPages.fetch(request, env, ctx)
      : path.startsWith('/application-emails/') ? await applicationEmailPages.fetch(request, env, ctx)
      : path.startsWith('/api/') ? await api.fetch(request, env, ctx)
      : new Response(null, { status: 303, headers: { location: '/crm' } })
    return afterWrite(request, response, env)
  },
} satisfies ExportedHandler<Bindings>
