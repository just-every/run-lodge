import { runtimeBindings, type Bindings } from '../../auth.server'
import { load } from '../core/store'
import { careersDomainProbe, careersHost } from './domain'

/** A careers hostname never becomes a second origin for sign-in or private APIs. */
export async function careersHostResponse(request: Request, env: Bindings, serve: (request: Request) => Promise<Response>): Promise<Response | null> {
  const url = new URL(request.url)
  const installationOrigin = runtimeBindings(env).AUTH_ORIGIN
  // An emitted Worker can serve its bootstrap/health doors before setup has
  // configured an origin. Once configured, every other host is public-only.
  if (!installationOrigin || url.origin === installationOrigin) return null
  const absent = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  if (url.protocol !== 'https:') return absent()
  const state = await load(env.DB)
  if (!careersHost(state, url.hostname)) return absent()
  const probe = careersDomainProbe(state, request)
  if (probe) return probe
  if (url.pathname === '/') return new Response(null, { status: 302, headers: { location: '/jobs', 'cache-control': 'no-store' } })
  const publicPath = /^\/privacy-requests(\/|$)/.test(url.pathname) || url.pathname === '/jobs' || url.pathname.startsWith('/jobs/') || ['/careers/logo', '/careers/brand.css', '/careers-form.js', '/rer-theme.css', '/lodge-public.css', '/favicon.svg'].includes(url.pathname) || url.pathname.startsWith('/fonts/')
  if (!publicPath || !['GET', 'HEAD', 'POST'].includes(request.method) || request.method === 'POST' && !url.pathname.startsWith('/jobs/') && !/^\/privacy-requests(\/|$)/.test(url.pathname)) return absent()
  return serve(request)
}
