import type { State } from '../core/state'
import { canSeeDocument, isAdmin, canSeeApplication, managesVacancy } from '../core/access'
import { blindFor } from '../core/blind'
import type { Actor, Data } from '../core/types'

/** DATA-001: namespaced field permissions follow their job across every workspace door. */
export function fieldProjection<T extends Data>(s: State, a: Actor, view: T): T {
  const admin = isAdmin(a), apps: Data[] = view.applications
  const allowed = (v: Data) => (v.customSchema ?? []).filter((f: Data) => admin || !f.restricted)
  const pick = (values: Data | undefined, fields: Data[]) => Object.fromEntries(fields.filter(f => Object.hasOwn(values ?? {}, f.id)).map(f => [f.id, values![f.id]]))
  const privateIds = new Set(s.all('vacancy').flatMap(v => (v.customSchema ?? []).filter((f: Data) => !admin && f.restricted).map((f: Data) => f.id)))
  const clean = (value: any): any => {
    if (Array.isArray(value)) return value.filter(x => !(x?.restricted && !admin) && !(x?.filters?.some((f: Data) => privateIds.has(f.field)))).map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !privateIds.has(k)).map(([k,v]) => [k, clean(v)]))
    return value
  }
  const out: Data = clean(view)
  out.vacancies = out.vacancies.map((v: Data) => ({ ...v, customSchema: allowed(s.get('vacancy', v.id)), customValues: pick(v.customValues, allowed(s.get('vacancy', v.id))) }))
  out.applications = out.applications.map((app: Data) => ({ ...app, customValues: blindFor(s, a, app) ? {} : pick(app.customValues, allowed(s.get('vacancy', app.vacancy))) }))
  out.candidates = out.candidates.map((c: Data) => {
    const mine = apps.filter(app => app.candidate === c.id && !blindFor(s, a, app))
    const fields = mine.flatMap(app => allowed(s.get('vacancy', app.vacancy)))
    const docs = view.documents.filter((d: Data) => d.candidate === c.id && d.kind === 'resume' && (!d.application || mine.some(app => app.id === d.application)) && canSeeDocument(s, a, d))
    const passages = [...docs.map((d: Data) => s.resumeTexts.get(d.id)), ...s.all('resume-extraction').filter((r: Data) => r.candidate === c.id && docs.some((d: Data) => d.id === r.document) && (!r.application || mine.some(app => app.id === r.application))).map((r: Data) => r.sourceText)].filter(Boolean)
    let resumeText = [...new Set(passages)].join('\n\n')
    if (!admin) {
      const secretValues = s.all('vacancy').flatMap(v => (v.customSchema ?? []).filter((f: Data) => f.restricted).flatMap((f: Data) => [s.find('candidate', c.id)?.customValues?.[f.id], ...apps.filter(app => app.candidate === c.id && app.vacancy === v.id).map(app => app.customValues?.[f.id]), v.customValues?.[f.id]]))
      for (const value of secretValues) if (value !== null && value !== undefined && String(value)) resumeText = resumeText.replaceAll(String(value), '[restricted]')
    }
    return { ...c, customValues: pick(c.customValues ?? s.find('candidate', c.id)?.customValues, fields), resumeText }
  })
  return out as T
}

/** Command and proposal responses obey the same field scopes as state and exports. */
export function fieldResult(s: State, a: Actor, value: any): any {
  const admin = isAdmin(a)
  const permitted = new Set(s.all('vacancy').filter(v => managesVacancy(a, v) || s.all('application').some(app => app.vacancy === v.id && canSeeApplication(s, a, app))).flatMap(v => (v.customSchema ?? []).filter((f: Data) => admin || !f.restricted).map((f: Data) => f.id)))
  const allIds = new Set(s.all('vacancy').flatMap(v => (v.customSchema ?? []).map((f: Data) => f.id)))
  const clean = (x: any): any => {
    if (Array.isArray(x)) return x.filter(r => !(r?.record && r?.type && r?.id && allIds.has(r.id) && !permitted.has(r.id)) && !(r?.filters?.some((f: Data) => !permitted.has(f.field)))).map(clean)
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([k]) => !allIds.has(k) || permitted.has(k)).map(([k,v]) => [k, k === 'customValues' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([id]) => permitted.has(id))) : clean(v)]))
    return x
  }
  return clean(value)
}
