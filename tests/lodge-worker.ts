// The Worker under test: Lodge's real auth, applicant pages and API routes,
// without the TanStack document renderer (the browser journeys cover that).
import { authResponse, type Bindings } from '../src/auth.server'
import { api } from '../src/lodge/http/api'
import { publicPages } from '../src/lodge/http/public'

export default {
  async fetch(request: Request, env: Bindings, execution: ExecutionContext) {
    const auth = await authResponse(request, env)
    if (auth) return auth
    const path = new URL(request.url).pathname
    if (path === '/jobs' || path.startsWith('/jobs/') || path.startsWith('/availability/')) return publicPages.fetch(request, env, execution)
    return api.fetch(request, env, execution)
  },
}
