import { staticAssetResponse } from '../src/base/static-assets'
import { careersHostResponse } from '../src/lodge/careers/host'
import { afterWrite, scheduledRun } from '../src/lodge/notify/run'
// The Worker under test: Lodge's real auth, applicant pages and API routes,
// without the TanStack document renderer (the browser journeys cover that).
import { authResponse, type Bindings } from '../src/auth.server'
import { api } from '../src/lodge/http/api'
import { publicPages } from '../src/lodge/http/public'
import { embedPages, isEmbedPage } from '../src/lodge/http/embed'
import { eventPages } from '../src/lodge/http/event-pages'
import { privacyPages } from '../src/lodge/http/privacy-pages'
import { isSignPage, signPages } from '../src/lodge/http/sign-pages'
import publicCss from '../public/lodge-public.css'
import themeCss from '../public/rer-theme.css'

export default {
  scheduled: scheduledRun,
  async fetch(request: Request, env: Bindings, execution: ExecutionContext) { return afterWrite(request, await route(request, env, execution), env) },
}

async function route(request: Request, env: Bindings, execution: ExecutionContext) {
  const careers = await careersHostResponse(request, env, async req => await staticAssetResponse(req, env) ?? (/^\/privacy-requests(\/|$)/.test(new URL(req.url).pathname) ? privacyPages.fetch(req, env, execution) : publicPages.fetch(req, env, execution)))
  if (careers) return careers
  const asset = await staticAssetResponse(request, env)
  if (asset) return asset
  // The stylesheets a hosted Worker serves from its assets, so pages in a browser look as shipped.
  const sheet = ({ '/lodge-public.css': publicCss, '/rer-theme.css': themeCss } as Record<string, string>)[new URL(request.url).pathname]
  if (sheet) return new Response(sheet, { headers: { 'content-type': 'text/css' } })
  const auth = await authResponse(request, env)
  if (auth) return auth
  const path = new URL(request.url).pathname
  if (path.startsWith('/careers/') || path === '/jobs' || path.startsWith('/jobs/') || path.startsWith('/availability/')) return publicPages.fetch(request, env, execution)
  if (isSignPage(path)) return signPages.fetch(request, env, execution)
  if (isEmbedPage(path)) return embedPages.fetch(request, env, execution)
  if (path.startsWith('/events/')) return eventPages.fetch(request, env, execution)
  if (/^\/privacy-requests(\/|$)/.test(path)) return privacyPages.fetch(request, env, execution)
  return api.fetch(request, env, execution)
}
