import { analysisPages } from '../src/lodge/analysis/pages'
import { crmReplyPages } from '../src/lodge/crm/reply-pages'
import { crmPages } from '../src/lodge/crm/pages'
import { lodgeEmail } from '../src/lodge/crm/email'
import { reminderPages } from '../src/lodge/reminders/pages'
import { applicationEmailPages } from '../src/lodge/http/application-email-pages'
import { capturePages } from '../src/lodge/http/capture-pages'
import { surveyPages } from '../src/lodge/surveys/http'
import { candidatePages } from '../src/lodge/http/candidate-pages'
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
import candidateCss from '../public/lodge-candidate.css'
import themeCss from '../public/rer-theme.css'
import fontsCss from '../public/fonts/fonts.css'

// Fixture clock exists only in this test Worker, never in the shipped server.
const RealDate = Date
let testNow: number | undefined
function setClock(at: string) {
  testNow = RealDate.parse(at)
  globalThis.Date = class extends RealDate {
    constructor(value?: any) { super(value === undefined ? testNow! : value) }
    static now() { return testNow! }
  } as DateConstructor
}
export default {
  email: lodgeEmail,
  scheduled: scheduledRun,
  async fetch(request: Request, env: Bindings, execution: ExecutionContext) {
    const fixture = (env as any).TEST_CLOCK
    if (fixture && testNow === undefined) setClock(fixture)
    if (fixture && new URL(request.url).pathname === '/__test/clock') { setClock((await request.json() as any).at); return Response.json({ ok: true }) }
    return afterWrite(request, await route(request, env, execution), env) },
}

async function route(request: Request, env: Bindings, execution: ExecutionContext) {
  const careers = await careersHostResponse(request, env, async req => await staticAssetResponse(req, env) ?? (/^\/privacy-requests(\/|$)/.test(new URL(req.url).pathname) ? privacyPages.fetch(req, env, execution) : publicPages.fetch(req, env, execution)))
  if (careers) return careers
  const asset = await staticAssetResponse(request, env)
  if (asset) return asset
  // The stylesheets a hosted Worker serves from its assets, so pages in a browser look as shipped.
  const sheet = ({ '/lodge-candidate.css': candidateCss, '/lodge-public.css': publicCss, '/rer-theme.css': themeCss, '/fonts/fonts.css': fontsCss } as Record<string, string>)[new URL(request.url).pathname]
  if (sheet) return new Response(sheet, { headers: { 'content-type': 'text/css' } })
  const auth = await authResponse(request, env)
  if (auth) return auth
  const path = new URL(request.url).pathname
  if (/^\/candidate(\/|$)/.test(path)) return candidatePages.fetch(request, env, execution)
  if (path.startsWith('/careers/') || path === '/jobs' || path.startsWith('/jobs/') || path.startsWith('/availability/')) return publicPages.fetch(request, env, execution)
  if (new URL(request.url).pathname === '/analysis' || new URL(request.url).pathname.startsWith('/analysis/') || new URL(request.url).pathname.startsWith('/api/lodge/analysis')) return analysisPages.fetch(request, env, execution)
  if (new URL(request.url).pathname.startsWith('/crm/reply/')) return crmReplyPages.fetch(request, env, execution)
    if (/^\/crm(\/|$)/.test(new URL(request.url).pathname)) return crmPages.fetch(request, env, execution)
  if (new URL(request.url).pathname.startsWith('/reminders/')) return reminderPages.fetch(request, env, execution)
  if (new URL(request.url).pathname.startsWith('/application-emails/')) return applicationEmailPages.fetch(request, env, execution)
  if (/^\/capture(\/|$)/.test(new URL(request.url).pathname)) return capturePages.fetch(request, env, execution)
  if (new URL(request.url).pathname.startsWith('/surveys/')) return surveyPages.fetch(request, env, execution)
  if (isSignPage(path)) return signPages.fetch(request, env, execution)
  if (isEmbedPage(path)) return embedPages.fetch(request, env, execution)
  if (path.startsWith('/events/')) return eventPages.fetch(request, env, execution)
  if (/^\/privacy-requests(\/|$)/.test(path)) return privacyPages.fetch(request, env, execution)
  return api.fetch(request, env, execution)
}
