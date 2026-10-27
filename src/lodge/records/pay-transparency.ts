import { translatedPay, uiCopy } from '../languages/copy'
import type { State } from '../core/state'
import { requireAdmin } from '../core/access'
import { date, list, now, requireThat, text, type Actor, type Data } from '../core/types'
import { names } from './fair-chance'
import { pay } from '../core/labels'

/** Employer and counsel supplied rules, never a claim of universal legal compliance. */
export function payRules(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(!a.agent, 'A human administrator must record the legal review', 403)
  const rules = list(b.rules ?? [], 'Pay rules', 60, (x: any) => ({
    place: text(x?.place, 'State or city', 100), reviewedOn: date(x?.reviewedOn, 'Legal review date'),
    rangeRequired: x?.rangeRequired === true, benefitsRequired: x?.benefitsRequired === true,
    salaryHistoryBan: x?.salaryHistoryBan === true,
  }))
  requireThat(new Set(rules.map(r => r.place.toLowerCase())).size === rules.length, 'Name each jurisdiction once')
  requireThat(rules.every(r => r.reviewedOn <= now().slice(0, 10)), 'Legal review date cannot be in the future')
  const business = s.get('business', 'main')
  s.put('business', 'main', { ...business, payRules: rules })
  s.audit(a, 'pay-rules-reviewed', 'business:main', { rules })
  return { rules }
}

export function payLocations(s: State, v: Data, post?: Data | null): Data[] {
  const ids: string[] = post?.locations ?? [...new Set([v.officeId, ...(v.locations ?? [])].filter(Boolean))]
  return ids.length ? ids.map(id => ({ officeId: id, location: s.get('office', id).name })) : [{ location: v.location }]
}

export function payProblems(s: State, v: Data): string[] {
  const rules: Data[] = s.get('business', 'main').payRules ?? []
  const locations = payLocations(s, v), problems: string[] = []
  for (const where of locations) {
    const applicable = rules.filter(r => names(r.place, where.location))
    const c = v.payRanges?.length ? v.payRanges.find((r: Data) => r.officeId === where.officeId)?.compensation : locations.length === 1 ? v.compensation : null
    if (c && c.currency !== 'USD') problems.push(`Pay range for ${where.location} must use USD`)
    if (!c) problems.push(`Add an approved pay range for ${where.location}`)
    if (applicable.some(r => r.benefitsRequired) && !v.benefits?.trim()) problems.push(`Add benefits and bonus text for ${where.location}`)
  }
  return problems
}

/** One shared representation for hosted pages, embeds and the public board. */
export function publicPay(s: State, v: Data, post?: Data | null) {
  const ranges = payLocations(s, v, post).flatMap(where => {
    const c = v.payRanges?.length ? v.payRanges.find((r: Data) => r.officeId === where.officeId)?.compensation : v.compensation
    return c ? [{ location: where.location || null, ...c, minorUnits: 2 }] : []
  })
  const copy = post && post.language !== 'en' ? uiCopy(post) : null
  return { ranges, text: [...ranges.map(r => copy ? copy.salary.replace(/\{pay\}/g, () => translatedPay(r, copy)) + (r.location ? ` (${r.location})` : '') : `Pay${r.location ? ' for ' + r.location : ''}: ${pay(r).replace(/\u00a0/g, ' ')}`), (copy ? post?.translation?.benefits : v.benefits) || ''].filter(Boolean).join('\n') }
}
