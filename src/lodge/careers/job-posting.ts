import { can, managesVacancy } from '../core/access'
import type { State } from '../core/state'
import { currentHuman } from '../core/store'
import { Fault, canonical, date, list, now, oneOf, requireThat, sha256, text, type Actor, type Data } from '../core/types'
import { approvedNow, latestApproval } from '../records/approvals'
import { listingById, shownJob, type Listing } from '../records/posts'
import { payProblems, publicPay } from '../records/pay-transparency'

const EMPLOYMENT: Record<string, string> = { 'full-time': 'FULL_TIME', 'part-time': 'PART_TIME', contract: 'CONTRACTOR', temporary: 'TEMPORARY' }
const UNIT: Record<string, string> = { hour: 'HOUR', month: 'MONTH', year: 'YEAR' }
const reviewId = (v: Data, p: Data) => v.id + ':' + p.id

/** Use the same saved-member grants and permission precedence as native commands. */
export const mayReviewJobPosting = (s: State, a: Actor, v: Data) => !a.agent && (a.owner || a.roles.includes('manager')) && managesVacancy(a, v) && can(s, a, v, 'settings')

async function eligible(s: State, v: Data, p: Data) {
  return !v.imported && !v.confidential && !v.internalOnly && v.status === 'open' && p.status === 'live' && p.destinations.includes('careers') && !payProblems(s, v).length && !!listingById(s, 'careers', p.id) && await approvedNow(s, 'vacancy', v)
}

/** The review is separate from its sources, so saving it never changes their revisions. */
export async function jobPostingSource(s: State, v: Data, p: Data) {
  const approval = latestApproval(s, 'vacancy', v.id)
  s.get('vacancy', v.id); s.get('business', 'main')
  const offices = p.locations.map((id: string) => { s.get('office', id); return [id, s.revisionOf('office', id)] })
  if (approval) s.get('approval', approval.id)
  return sha256(canonical({ vacancy: s.revisionOf('vacancy', v.id), business: s.revisionOf('business', 'main'), offices, approval: approval && [approval.id, s.revisionOf('approval', approval.id)] }))
}

function metadata(s: State, v: Data, p: Data, input: Data) {
  const employerName = text(input.employerName, 'Employer name', 160)
  requireThat(employerName === s.get('business', 'main').name, 'Employer name must match the visible business name')
  const employerUrl = text(input.employerUrl, 'Employer website', 2000)
  let url: URL
  try { url = new URL(employerUrl) } catch { throw new Fault(400, 'Employer website must be an HTTPS URL') }
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'Employer website must be an HTTPS URL without credentials or a fragment')
  const datePosted = date(input.datePosted, 'Original posting date'), validThrough = date(input.validThrough, 'Listing expiry date')
  requireThat(new Date(datePosted + 'T00:00:00Z').toISOString().slice(0, 10) === datePosted && new Date(validThrough + 'T00:00:00Z').toISOString().slice(0, 10) === validThrough, 'Supply real calendar dates')
  requireThat(datePosted <= now().slice(0, 10) && validThrough >= datePosted && validThrough + 'T23:59:59Z' > now(), 'Supply the original posting date and a future expiry date')
  const employmentType = oneOf(input.employmentType, Object.keys(EMPLOYMENT), 'Reviewed employment type')
  requireThat(employmentType === v.employmentType, 'Reviewed employment type must match the approved job')
  requireThat(p.title.trim() && p.description.trim(), 'The visible post needs a title and description', 409)
  const addresses = list(input.addresses, 'Structured locations', 20, (x: any) => ({
    officeId: text(x?.officeId, 'Approved office', 64), streetAddress: text(x?.streetAddress, 'Street address', 200),
    addressLocality: text(x?.addressLocality, 'City', 100), addressRegion: text(x?.addressRegion, 'State or region', 100),
    postalCode: text(x?.postalCode, 'Postal code', 30), addressCountry: text(x?.addressCountry, 'Country code', 2).toUpperCase(),
  }))
  requireThat(addresses.length === p.locations.length && new Set(addresses.map(x => x.officeId)).size === addresses.length && addresses.every(x => p.locations.includes(x.officeId) && /^[A-Z]{2}$/.test(x.addressCountry)), 'Supply one complete address and two-letter country code for every selected office')
  const applicantCountries = list(input.applicantCountries ?? [], 'Remote applicant country codes', 30, x => text(x, 'Country code', 2).toUpperCase())
  requireThat(applicantCountries.every(x => /^[A-Z]{2}$/.test(x)) && (v.workMode !== 'remote' || applicantCountries.length > 0), 'Remote jobs need explicitly reviewed applicant country codes')
  const ranges = publicPay(s, v, p).ranges
  requireThat(ranges.length === addresses.length && ranges.every(r => r.currency === 'USD' && UNIT[r.period] && r.min === ranges[0].min && r.max === ranges[0].max && r.period === ranges[0].period), 'Use a post with one location or identical approved pay ranges; never combine unequal location salaries', 409)
  return { employerName, employerUrl: url.href, datePosted, validThrough, employmentType, addresses, applicantCountries: [...new Set(applicantCountries)] }
}

/** Explicit human review only; validation and authorization precede every write. */
export async function reviewJobPosting(s: State, a: Actor, b: Data) {
  const v = s.get('vacancy', b.vacancy), p = (v.posts ?? []).find((x: Data) => x.id === b.post)
  requireThat(mayReviewJobPosting(s, a, v), 'Current human job settings authority is required', 403)
  requireThat(p, 'Post not found', 404)
  const source = await jobPostingSource(s, v, p)
  requireThat(b.source === source, 'The listing sources changed; reload and review the current post', 409)
  const previous = s.find('job-posting-review', reviewId(v, p))
  if (b.enabled === false) {
    const record = s.put('job-posting-review', reviewId(v, p), { ...previous, vacancy: v.id, post: p.id, enabled: false, source, reviewedBy: a.email, reviewedAt: now() })
    s.audit(a, 'job-posting-disabled', 'vacancy:' + v.id, { post: p.id })
    return record
  }
  requireThat(b.reviewed === true, 'Confirm employer review of the exact visible post and supplied metadata')
  requireThat(await eligible(s, v, p), 'Select an approved live public careers post with current pay and translation', 409)
  const supplied = metadata(s, v, p, b.metadata ?? {})
  const record = s.put('job-posting-review', reviewId(v, p), { vacancy: v.id, post: p.id, enabled: true, source, metadata: supplied, reviewedBy: a.email, reviewedAt: now() })
  s.audit(a, 'job-posting-reviewed', 'vacancy:' + v.id, { post: p.id, source })
  return record
}

export async function currentJobPosting(s: State, l: Listing) {
  const { v, post: p } = l
  if (!p) return null
  const r = s.find('job-posting-review', reviewId(v, p))
  if (!r?.enabled || r.source !== await jobPostingSource(s, v, p) || !await eligible(s, v, p)) return null
  const reviewer = currentHuman(s, r.reviewedBy)
  if (!reviewer || !mayReviewJobPosting(s, reviewer, v)) return null
  // Revalidate persisted metadata as well as sources; an incomplete old record never publishes.
  try { return metadata(s, v, p, r.metadata ?? {}) } catch { return null }
}

export async function jobPostingSettings(s: State, a: Actor, v: Data) {
  if (!mayReviewJobPosting(s, a, v)) return []
  return Promise.all((v.posts ?? []).map(async (p: Data) => {
    const review = s.find('job-posting-review', reviewId(v, p)), l = listingById(s, 'careers', p.id)
    return { post: p.id, source: await jobPostingSource(s, v, p), pay: publicPay(s, v, p).text, eligible: await eligible(s, v, p), review: review ?? null, published: !!l && !!await currentJobPosting(s, l) }
  }))
}

/** Only public content enters this object; authority and review provenance stay private. */
export function jobPostingData(s: State, l: Listing, m: Data, origin: string) {
  const shown = shownJob(s, l), range = publicPay(s, l.v, l.post).ranges[0]
  return {
    '@context': 'https://schema.org', '@type': 'JobPosting', title: shown.title, description: shown.description,
    identifier: { '@type': 'PropertyValue', name: m.employerName, value: l.id }, url: new URL('/jobs/' + l.slug, origin).href,
    datePosted: m.datePosted, validThrough: m.validThrough + 'T23:59:59Z', employmentType: EMPLOYMENT[m.employmentType],
    hiringOrganization: { '@type': 'Organization', name: m.employerName, sameAs: m.employerUrl },
    jobLocation: m.addresses.map((x: Data) => ({ '@type': 'Place', name: s.get('office', x.officeId).name, address: { '@type': 'PostalAddress', streetAddress: x.streetAddress, addressLocality: x.addressLocality, addressRegion: x.addressRegion, postalCode: x.postalCode, addressCountry: x.addressCountry } })),
    ...(l.v.workMode === 'remote' ? { jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: m.applicantCountries.map((name: string) => ({ '@type': 'Country', name })) } : {}),
    baseSalary: { '@type': 'MonetaryAmount', currency: range.currency, value: { '@type': 'QuantitativeValue', minValue: range.min / 100, maxValue: range.max / 100, unitText: UNIT[range.period] } },
    ...(l.v.benefits ? { jobBenefits: l.post?.language !== 'en' ? l.post?.translation?.benefits : l.v.benefits } : {}),
  }
}

export const safeStructuredJson = (value: unknown) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, x => '\\u' + x.charCodeAt(0).toString(16).padStart(4, '0'))
