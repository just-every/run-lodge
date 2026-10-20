import { resumeIntakeMaintenance } from './lodge/resumes/maintenance'
import { withDemo } from './modules/demo/index.mjs'
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

// Applicant pages are plain server-rendered HTML; /api/* is Lodge's JSON API;
// every other document (the /app workspace) is TanStack Start.
const isPublicPage = (path: string) => path === '/jobs' || path.startsWith('/jobs/') || path.startsWith('/availability/')

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default withDemo({
  scheduled: resumeIntakeMaintenance,
  async fetch(request, env, execution) {
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const auth = await authResponse(request, env)
    if (auth) return auth
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
    if (lobby) return lobby
    if (isPublicPage(new URL(request.url).pathname)) return publicPages.fetch(request, env, execution)
    if (isEmbedPage(new URL(request.url).pathname)) return embedPages.fetch(request, env, execution)
    if (new URL(request.url).pathname.startsWith('/events/')) return eventPages.fetch(request, env, execution)
    if (/^\/privacy-requests(\/|$)/.test(new URL(request.url).pathname)) return privacyPages.fetch(request, env, execution)
    return dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request)))
  },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })
