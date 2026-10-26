import type { Bindings } from '../../auth.server'
import { has, isAdmin } from '../core/access'
import type { State } from '../core/state'
import { requireThat, type Actor } from '../core/types'
import { workspaceRecords } from '../views/workspace'
import { dateContext } from './query'

export interface Job { id: string; title: string; stages: { id: string; name: string }[]; offers: boolean }
export interface Application { id: string; job: string; source: string; submittedAt: string; events: { id: string; at: string; from: string | null; to: string }[] }
export interface Interview { id: string; application: string; createdAt: string | null; scheduledAt: string | null; status: string }
export interface Offer { id: string; application: string; status: string; outcomeAt: string | null }
export interface AnalysisScope { jobs: Job[]; applications: Application[]; interviews: Interview[]; offers: Offer[]; sources: string[]; dates: ReturnType<typeof dateContext> }
const instant = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null

/** Project scalar evidence from the same current-access view used by the workspace. */
export async function analysisScope(s: State, a: Actor, env?: Bindings): Promise<AnalysisScope> {
  requireThat(!a.agent && (isAdmin(a) || has(a, 'manager')), 'Recruiting analysis is available to native hiring managers and admins', 403)
  const w = await workspaceRecords(s, a, env)
  const jobs: Job[] = w.vacancies.filter(v => v.manages).map(v => ({ id: v.id, title: v.title, stages: (v.stages ?? []).map((st: { id: string; name: string }) => ({ id: st.id, name: st.name })), offers: v.permissions.includes('offers') }))
  const jobIds = new Set(jobs.map(j => j.id)), candidateIds = new Set(w.candidates.map(c => c.id))
  const applications: Application[] = w.applications.filter(x => x.manages && jobIds.has(x.vacancy) && candidateIds.has(x.candidate) && x.status !== 'spam').map(x => ({
    id: x.id, job: x.vacancy, source: x.sourceEntry?.name || x.source || 'Not recorded', submittedAt: instant(x.submittedAt) ?? '',
    events: (x.history ?? []).map((e: { id: string; at: string; from: string | null; to: string }) => ({ id: e.id, at: instant(e.at) ?? '', from: e.from, to: e.to })),
  }))
  const appIds = new Set(applications.map(x => x.id))
  const interviews: Interview[] = w.interviews.filter(i => appIds.has(i.application)).map(i => ({ id: i.id, application: i.application, createdAt: instant(i.createdAt), scheduledAt: instant(i.scheduledAt), status: i.status }))
  const offers: Offer[] = w.offers.filter(o => appIds.has(o.application)).map(o => ({ id: o.id, application: o.application, status: o.status, outcomeAt: instant(o.outcomeAt) }))
  return { jobs, applications, interviews, offers, sources: [...new Set(applications.map(x => x.source))].sort(), dates: dateContext(w.business ?? undefined) }
}

/** Provider context includes filter metadata and metric definitions only, never evidence or workspace records. */
export function modelMetadata(scope: AnalysisScope) {
  return {
    dates: scope.dates,
    jobs: scope.jobs.slice(0, 100).map(j => ({ id: j.id, title: j.title, offers: j.offers })),
    sources: scope.sources.slice(0, 100),
    metadataLimit: 'At most 100 job and 100 source filter choices are supplied. Empty filters mean all currently authorized records; no evidence rows are supplied.',
  }
}
