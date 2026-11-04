import type { State } from '../core/state'
import { grantsOf } from '../core/store'
import { can, managesVacancy, requireCan, requireManages } from '../core/access'
import { canonical, date, list, now, requireThat, sha256, text, type Actor, type Data } from '../core/types'
import { approvedNow, latestApproval, terms } from '../records/approvals'
import { publicPay, payProblems } from '../records/pay-transparency'
import { shownJob, type Listing } from '../records/posts'

const EMPLOYMENT: Record<string, string> = { 'full-time': 'FULL_TIME', 'part-time': 'PART_TIME', contract: 'CONTRACTOR', temporary: 'TEMPORARY' }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const descriptionHtml = (value: string) => escapeHtml(value).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
const PERIOD: Record<string, string> = { year: 'YEAR', month: 'MONTH', hour: 'HOUR' }

/** Review covers the actual visible sources, not a client-supplied copy of the listing. */
export async function jobPostingSource(s: State, v: Data, p: Data) {
  const business = s.get('business', 'main')
  return sha256(canonical({ terms: terms(s, 'vacancy', v), approval: latestApproval(s, 'vacancy', v.id),
    post: { id: p.id, slug: p.slug, title: p.title, description: p.description, locations: p.locations, language: p.language, destinations: p.destinations, translation: p.translation, updatedAt: p.updatedAt },
    organization: business.name, businessRevision: s.revisionOf('business', 'main'), publishedAt: v.publishedAt,
    confidential: !!v.confidential, internalOnly: !!v.internalOnly,
    offices: p.locations.map((id: string) => ({ id, name: s.get('office', id).name, revision: s.revisionOf('office', id) })),
    pay: publicPay(s, v, p), payRules: business.payRules ?? [] }))
}

function metadata(s: State, v: Data, p: Data, input: Data) {
  requireThat(p.destinations.includes('careers') && !v.confidential && !v.internalOnly, 'Select a public careers post before reviewing structured data', 409)
  requireThat(p.description?.trim(), 'Add the visible post description before reviewing structured data', 409)
  let organizationUrl: URL
  try { organizationUrl = new URL(text(input.organizationUrl, 'Employer website', 500)) } catch { requireThat(false, 'Supply the employer HTTPS website'); throw new Error('unreachable') }
  requireThat(organizationUrl.protocol === 'https:' && !organizationUrl.username && !organizationUrl.password, 'Employer website must be an HTTPS URL without credentials')
  const datePosted = date(input.datePosted, 'Original posting date'), validThrough = date(input.validThrough, 'Application closing date')
  requireThat(datePosted <= now().slice(0, 10) && validThrough >= now().slice(0, 10) && validThrough >= datePosted, 'Supply the actual posting date and a current closing date')
  const locations = v.workMode === 'remote' ? [] : list(input.locations, 'Structured locations', 21, (x: any) => ({
    officeId: text(x?.officeId, 'Approved office', 64), streetAddress: text(x?.streetAddress, 'Street address', 200),
    addressLocality: text(x?.addressLocality, 'City', 100), addressRegion: text(x?.addressRegion, 'State', 100),
    postalCode: text(x?.postalCode, 'Postal code', 20), addressCountry: text(x?.addressCountry, 'Country code', 2),
  }))
  if (v.workMode === 'remote') requireThat(input.remoteCountry === 'US', 'Explicitly confirm United States remote eligibility')
  else {
    requireThat(locations.length === p.locations.length && new Set(locations.map(x => x.officeId)).size === p.locations.length && locations.every(x => p.locations.includes(x.officeId) && x.addressCountry === 'US'), 'Supply one US postal address for each selected approved office')
  }
  requireThat(!payProblems(s, v).length, 'Resolve current pay requirements before reviewing structured data', 409)
  return { organizationUrl: organizationUrl.href, datePosted, validThrough, locations, ...(v.workMode === 'remote' ? { remoteCountry: 'US' } : {}) }
}

/** Separate human opt-in; saving a post or publishing a vacancy never opts it in. */
export async function reviewJobPosting(s: State, a: Actor, b: Data) {
  const v = s.get('vacancy', b.vacancy)
  requireManages(a, v); requireCan(s, a, v, 'settings')
  requireThat(!a.agent, 'A human employer must review structured data', 403)
  const p = (v.posts ?? []).find((x: Data) => x.id === b.post)
  requireThat(p && !v.imported && v.status !== 'closed' && p.status !== 'closed', 'Choose a current native post', 409)
  let jobPosting: Data = { selected: false }
  if (b.selected === true) {
    const source = await jobPostingSource(s, v, p)
    requireThat(b.source === source, 'Listing sources changed; reload and review the current post', 409)
    jobPosting = { ...metadata(s, v, p, b), selected: true, source, reviewedBy: a.email, reviewedMemberRevision: s.revisionOf('member', a.email), reviewedAt: now() }
  }
  const result = s.put('vacancy', v.id, { ...v, posts: v.posts.map((x: Data) => x.id === p.id ? { ...x, jobPosting } : x) })
  s.audit(a, 'job-posting-reviewed', 'vacancy:' + v.id, { post: p.id, selected: jobPosting.selected })
  return result
}

/** Only a current, approved public post can produce Google-compatible native markup. */
export async function jobPosting(s: State, l: Listing, origin: string): Promise<Data | null> {
  const { v, post: p } = l, review = p?.jobPosting
  if (!p || !review?.selected || v.status !== 'open' || p.status !== 'live' || v.imported || v.confidential || v.internalOnly || !p.destinations.includes('careers')) return null
  if (payProblems(s, v).length || !await approvedNow(s, 'vacancy', v) || review.source !== await jobPostingSource(s, v, p)) return null
  const member = s.find('member', review.reviewedBy)
  if (!member?.active || member.agent || review.reviewedMemberRevision !== s.revisionOf('member', review.reviewedBy)) return null
  const reviewer = { ...member, grants: grantsOf(s, member) } as Actor
  if (!managesVacancy(reviewer, v) || !can(s, reviewer, v, 'settings')) return null
  try { metadata(s, v, p, review) } catch { return null }
  const pay = publicPay(s, v, p), ranges = pay.ranges
  // One JobPosting cannot truthfully attach different salaries to its locations.
  // Separate location posts can each opt in with their own reviewed range.
  const salary = ranges[0]
  if (!salary || ranges.length !== p.locations.length || !PERIOD[salary.period] || ranges.some(r => r.currency !== 'USD' || r.min !== salary.min || r.max !== salary.max || r.period !== salary.period)) return null
  const shown = shownJob(s, l), url = new URL('/jobs/' + l.slug, origin).href
  const location = v.workMode === 'remote'
    ? { jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'United States' } }
    : { jobLocation: review.locations.map((x: Data) => ({ '@type': 'Place', name: s.get('office', x.officeId).name, address: { '@type': 'PostalAddress', streetAddress: x.streetAddress, addressLocality: x.addressLocality, addressRegion: x.addressRegion, postalCode: x.postalCode, addressCountry: x.addressCountry } })) }
  return { '@context': 'https://schema.org', '@type': 'JobPosting', identifier: { '@type': 'PropertyValue', name: s.get('business', 'main').name, value: p.id },
    title: shown.title, description: descriptionHtml(shown.description), url, datePosted: review.datePosted, validThrough: review.validThrough + 'T23:59:59Z',
    hiringOrganization: { '@type': 'Organization', name: s.get('business', 'main').name, sameAs: review.organizationUrl },
    employmentType: EMPLOYMENT[v.employmentType], ...location,
    baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', minValue: salary.min / 100, maxValue: salary.max / 100, unitText: PERIOD[salary.period] } },
    ...(v.benefits ? { jobBenefits: p.language === 'en' ? v.benefits : p.translation?.benefits } : {}) }
}

/** Script data never contains an HTML end tag or executable markup. */
export const serializeJobPosting = (value: Data) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
