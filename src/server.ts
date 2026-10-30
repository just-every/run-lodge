import { agentResponse } from './lodge/agent-door/index.ts'
import { weeklyPages } from './lodge/reports/pages'
import { bulkInvitationPages } from './lodge/operations/bulk-invitations-page'
import { enterprisePages } from './lodge/enterprise/http'
import { schedulePages } from './lodge/analysis/schedule-pages'
import { analysisPages } from './lodge/analysis/pages'
import { crmReplyPages } from './lodge/crm/reply-pages'
import { crmPages } from './lodge/crm/pages'
import { lodgeEmail } from './lodge/crm/email'
import { reminderPages } from './lodge/reminders/pages'
import { applicationEmailPages } from './lodge/http/application-email-pages'
import { capturePages } from './lodge/http/capture-pages'
import { surveyPages } from './lodge/surveys/http'
import { withDemo } from './modules/demo/index.mjs'
import { candidatePages } from './lodge/http/candidate-pages'
import { careersHostResponse } from './lodge/careers/host'
import { afterWrite, scheduledRun } from './lodge/notify/run'
import { seedDemo } from './demo'
import start from '@tanstack/react-start/server-entry'
import { dispatch } from './base/dispatch'
import { staticAssetResponse } from './base/static-assets'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'
import { api } from './lodge/http/api'
import { publicPages } from './lodge/http/public'
import { embedPages, isEmbedPage } from './lodge/http/embed'
import { eventPages } from './lodge/http/event-pages'
import { privacyPages } from './lodge/http/privacy-pages'
import { isSignPage, signPages } from './lodge/http/sign-pages'

// Applicant pages are plain server-rendered HTML; /api/* is Lodge's JSON API;
// every other document (the /app workspace) is TanStack Start.
const isPublicPage = (path: string) => path.startsWith('/careers/') || path === '/jobs' || path.startsWith('/jobs/') || path.startsWith('/availability/')

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function route(request: Request, env: Bindings, execution: ExecutionContext): Promise<Response> {
    const careers = await careersHostResponse(request, env, async req => await staticAssetResponse(req, env) ?? (/^\/privacy-requests(\/|$)/.test(new URL(req.url).pathname) ? privacyPages.fetch(req, env, execution) : publicPages.fetch(req, env, execution)))
    if (careers) return careers
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
  if (/^\/enterprise\/invitations(?:\/|$)/.test(new URL(request.url).pathname)) return bulkInvitationPages.fetch(request, env, execution)
  if (/^\/(?:enterprise|scim)(?:\/|$)/.test(new URL(request.url).pathname) || new URL(request.url).pathname.startsWith('/auth/oidc/lodge-okta/')) return enterprisePages.fetch(request, env, execution)
    const door = await agentResponse(request, env)
  if (door) return door
  const auth = await authResponse(request, env)
    if (auth) return auth
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
    if (lobby) return lobby
    if (/^\/candidate(\/|$)/.test(new URL(request.url).pathname)) return candidatePages.fetch(request, env, execution)
    if (isPublicPage(new URL(request.url).pathname)) return publicPages.fetch(request, env, execution)
    if (new URL(request.url).pathname.startsWith('/reports/weekly') || new URL(request.url).pathname.startsWith('/api/lodge/reports/weekly')) return weeklyPages.fetch(request, env, execution)
    if (new URL(request.url).pathname.startsWith('/analysis/schedules') || new URL(request.url).pathname.startsWith('/api/lodge/analysis/schedules')) return schedulePages.fetch(request, env, execution)
    if (new URL(request.url).pathname === '/analysis' || new URL(request.url).pathname.startsWith('/analysis/') || new URL(request.url).pathname.startsWith('/api/lodge/analysis')) return analysisPages.fetch(request, env, execution)
    if (new URL(request.url).pathname.startsWith('/crm/reply/')) return crmReplyPages.fetch(request, env, execution)
    if (/^\/crm(\/|$)/.test(new URL(request.url).pathname)) return crmPages.fetch(request, env, execution)
    if (new URL(request.url).pathname.startsWith('/reminders/')) return reminderPages.fetch(request, env, execution)
    if (new URL(request.url).pathname.startsWith('/application-emails/')) return applicationEmailPages.fetch(request, env, execution)
    if (/^\/capture(\/|$)/.test(new URL(request.url).pathname)) return capturePages.fetch(request, env, execution)
    if (new URL(request.url).pathname.startsWith('/surveys/')) return surveyPages.fetch(request, env, execution)
    if (isSignPage(new URL(request.url).pathname)) return signPages.fetch(request, env, execution)
    if (isEmbedPage(new URL(request.url).pathname)) return embedPages.fetch(request, env, execution)
    if (new URL(request.url).pathname.startsWith('/events/')) return eventPages.fetch(request, env, execution)
    if (/^\/privacy-requests(\/|$)/.test(new URL(request.url).pathname)) return privacyPages.fetch(request, env, execution)
    return dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request)))
}

export default withDemo({
  email: lodgeEmail,
  scheduled: scheduledRun,
  async fetch(request, env, execution) { return afterWrite(request, await route(request, env, execution), env) },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })
