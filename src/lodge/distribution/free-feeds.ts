import type { State } from '../core/state'
import { requireAdmin, requireMember } from '../core/access'
import { canonical, email, list, now, oneOf, optionalText, requireThat, sha256, text, type Actor, type Data } from '../core/types'
import { approvedNow, terms } from '../records/approvals'
import { approvedOffices, listings, type Listing } from '../records/posts'
import { publicPay } from '../records/pay-transparency'

export const FREE_BOARDS = ['linkedin', 'indeed'] as const
export type FreeBoard = typeof FREE_BOARDS[number]
export const FEED_NAMES = { linkedin: 'LinkedIn Limited Listing', indeed: 'Indeed (organic)' }
export const feedPath = (board: FreeBoard) => '/careers/feeds/' + board + '.xml'
const last = (v: Data, post: string | null, board: FreeBoard) => (v.freeFeeds ?? []).find((x: Data) => x.post === post && x.board === board)?.versions.at(-1)
const postOf = (v: Data, id: string | null) => id ? (v.posts ?? []).find((p: Data) => p.id === id) : null
const cleanXml = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value) && !/[\uD800-\uDFFF]/u.test(value)

/** Exact source review excludes lifecycle flags, so pausing and closing remove entries without erasing earlier review. */
export async function feedSource(s: State, v: Data, post: Data | null) {
  const offices = post?.locations ?? approvedOffices(v)
  return sha256(canonical({ terms: terms(s, 'vacancy', v), post: post ? { id: post.id, title: post.title, description: post.description, locations: post.locations, language: post.language, translation: post.translation, destinations: post.destinations } : null,
    offices: offices.map((id: string) => ({ id, name: s.get('office', id).name })), pay: publicPay(s, v, post), rules: s.get('business', 'main').payRules ?? [] }))
}

/** Human administrators opt in each job or post. This records declared metadata, never provider authorization. */
export async function configureFreeFeed(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(!a.agent, 'A human administrator must review free feed configuration', 403)
  const v = s.get('vacancy', b.vacancy), postId = b.post ? text(b.post, 'Post', 64) : null
  requireThat(!v.imported && v.status !== 'closed', 'Choose a current native job', 409)
  const post = postOf(v, postId)
  requireThat(!postId || post && post.status !== 'closed', 'Choose a current post', 404)
  const board = oneOf(b.board, FREE_BOARDS, 'Free board'), current = last(v, postId, board)
  requireThat(Number(b.version ?? 0) === (current?.version ?? 0), 'The feed configuration changed; review its current version', 409)
  let fields: Data = {}
  if (b.enabled === true) {
    requireThat(!v.confidential && !v.internalOnly, 'Confidential and internal-only jobs cannot enter a free feed', 409)
    requireThat(b.reviewed === true && b.source === await feedSource(s, v, post), 'Review the exact current job content and metadata before enabling its feed', 409)
    const description = post?.description ?? v.description
    requireThat(description?.trim().length >= (board === 'linkedin' ? 100 : 1), board === 'linkedin' ? 'LinkedIn requires at least 100 characters of job description' : 'Add the approved job description')
    const offices: string[] = post?.locations ?? approvedOffices(v)
    requireThat(offices.length > 0 && (board !== 'linkedin' || offices.length <= 7), 'Choose approved offices; LinkedIn supports up to seven locations')
    const locations = list(b.locations, 'Feed locations', 21, (x: any) => ({ officeId: text(x?.officeId, 'Approved office', 64), city: text(x?.city, 'City', 120), state: text(x?.state, 'US state abbreviation', 2).toUpperCase(), country: text(x?.country, 'Country', 2).toUpperCase(), postalCode: optionalText(x?.postalCode, 'Postal code', 20), streetAddress: optionalText(x?.streetAddress, 'Street address', 200) }))
    requireThat(locations.length === offices.length && new Set(locations.map(x => x.officeId)).size === offices.length && offices.every(id => locations.some(x => x.officeId === id)), 'Supply one explicit location for every selected approved office')
    const states = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ')
    requireThat(locations.every(x => x.country === 'US' && states.includes(x.state)), 'This native feed supports explicitly supplied US locations')
    const rawUrl = text(b.companyUrl, 'Employer website', 500)
    requireThat(/^https:\/\/[^\s]+$/.test(rawUrl) && URL.canParse(rawUrl), 'Enter an absolute HTTPS employer website URL')
    const companyUrl = new URL(rawUrl)
    requireThat(companyUrl.protocol === 'https:' && !companyUrl.username && !companyUrl.password, 'Employer website must use HTTPS without credentials')
    const companyId = optionalText(b.companyId, 'LinkedIn Company ID', 40)
    requireThat(board !== 'linkedin' || /^[1-9][0-9]*$/.test(companyId), 'Supply the employer’s actual numeric LinkedIn Company ID; Lodge cannot invent or verify it')
    const credit = b.creditWho ? { kind: oneOf(b.creditKind, ['sourcer', 'recruiter'] as const, 'Credit kind'), who: requireMember(s, email(b.creditWho, 'Credited member')).email } : null
    fields = { source: b.source, companyName: text(b.companyName, 'Employer name', 200), companyUrl: companyUrl.href, companyId, posterEmail: email(b.posterEmail, 'Public feed contact'), locations, credit }
    requireThat(cleanXml(canonical(fields)) && cleanXml(description) && cleanXml(post?.title ?? v.title) && cleanXml(publicPay(s, v, post).text), 'Remove unsupported XML control characters from feed content')
  }
  const version = { ...current, ...fields, version: (current?.version ?? 0) + 1, enabled: b.enabled === true, reviewedBy: a.email, reviewedAt: now() }
  const all: Data[] = v.freeFeeds ?? []
  const entry = all.find(x => x.post === postId && x.board === board)
  const next = { board, post: postId, versions: [...(entry?.versions ?? []), version] }
  const record = s.put('vacancy', v.id, { ...v, freeFeeds: entry ? all.map(x => x === entry ? next : x) : [...all, next] })
  s.audit(a, 'free-feed-reviewed', 'vacancy:' + v.id, { board, post: postId, version: version.version, enabled: version.enabled })
  return record
}

export interface FeedEntry { listing: Listing; config: Data; source: string; id: string }
export async function feedEntries(s: State, board: FreeBoard): Promise<FeedEntry[]> {
  const out: FeedEntry[] = []
  for (const listing of listings(s, board)) {
    const v = s.get('vacancy', listing.v.id), post = listing.post
    const config = last(v, post?.id ?? null, board)
    if (!config?.enabled || v.confidential || v.internalOnly || !await approvedNow(s, 'vacancy', v)) continue
    if (post && !post.destinations.includes('careers')) continue
    const source = await feedSource(s, v, post)
    if (config.source !== source) continue
    if (config.credit && !s.find('member', config.credit.who)?.active) continue
    const id = await sha256(canonical({ vacancy: v.id, post: post?.id ?? null }))
    out.push({ listing, config, source, id: id.slice(0, 32) })
  }
  return out
}

/** A feed link is declared click-through provenance, never a verified provider referral. */
export async function feedListing(s: State, board: unknown, slug: string) {
  requireThat(FREE_BOARDS.includes(board as FreeBoard), 'Unknown feed link', 404)
  return (await feedEntries(s, board as FreeBoard)).find(x => x.listing.slug === slug) ?? null
}
export function feedDoor(entry: FeedEntry, board: FreeBoard) {
  return { source: FEED_NAMES[board], path: 'Careers page', entry: FEED_NAMES[board], entryType: 'job-board' as const,
    campaign: { utm_source: board === 'indeed' ? 'Indeed' : 'LinkedIn', attribution: 'declared-feed-link' },
    provenance: { kind: 'declared-feed-link', board, verifiedProviderReferral: false, configurationVersion: entry.config.version },
    credit: entry.config.credit ? { ...entry.config.credit, by: entry.config.reviewedBy, at: now(), automatic: true } : null }
}

export async function freeFeedView(s: State, v: Data, entries: Record<FreeBoard, FeedEntry[]>) {
  const receipts = s.get('business', 'main').freeFeedServed ?? {}
  const targets = [null, ...(v.posts ?? []).filter((p: Data) => p.status !== 'closed')]
  return Promise.all(targets.map(async (post: Data | null) => ({ post: post?.id ?? null, title: post?.title ?? v.title, source: await feedSource(s, v, post), content: { description: post?.description ?? v.description, pay: publicPay(s, v, post).text, employmentType: v.employmentType },
    boards: FREE_BOARDS.map(board => {
      const config = last(v, post?.id ?? null, board), entry = entries[board].find(e => e.listing.v.id === v.id && (e.listing.post?.id ?? null) === (post?.id ?? null))
      const served = entry && receipts[board]?.entries.some((e: Data) => e.id === entry.id && e.version === config.version && e.source === entry.source)
      return { board, config: config ?? null, status: !config?.enabled ? 'Off' : !entry ? 'Withheld; review current content, publication and destinations' : served ? 'Feed served, listing not confirmed' : 'Ready to serve; listing not confirmed', path: feedPath(board) }
    }) })))
}

export const xmlText = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const cdata = (value: unknown) => '<![CDATA[' + String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>') + ']]>'
const tag = (name: string, value: unknown) => `<${name}>${cdata(value)}</${name}>`
const paragraphs = (value: string) => value.split(/\n{2,}/).map(p => '<p>' + xmlText(p).replace(/\n/g, '<br>') + '</p>').join('')
const type = { 'full-time': 'FULL_TIME', 'part-time': 'PART_TIME', contract: 'CONTRACT' } as Record<string, string>
const period = { year: 'YEARLY', month: 'MONTHLY', week: 'WEEKLY', hour: 'HOURLY' } as Record<string, string>

/** Serialize only current public data. Indeed requires a stable instance per location; LinkedIn accepts alternate locations. */
export async function renderFreeFeed(s: State, board: FreeBoard, origin: string, entries: FeedEntry[]) {
  const jobs: string[] = []
  for (const e of entries) {
    const { listing: l, config: c } = e, v = l.v, pay = publicPay(s, v, l.post)
    const url = new URL('/jobs/' + l.slug, origin)
    url.searchParams.set('feed', board)
    url.searchParams.set('source', board === 'indeed' ? 'Indeed' : 'LinkedIn')
    const description = paragraphs(pay.text) + paragraphs(l.description) + paragraphs('Employment type: ' + v.employmentType)
    const common = tag('title', l.title) + tag('company', c.companyName) + tag('description', description)
    if (board === 'linkedin') {
      const ranges = pay.ranges, equal = ranges.length && ranges.every(r => r.min === ranges[0].min && r.max === ranges[0].max && r.period === ranges[0].period)
      const salary = equal && period[ranges[0].period] ? '<salaries><salary><lowEnd>' + tag('amount', ranges[0].min / 100) + tag('currencyCode', 'USD') + '</lowEnd><highEnd>' + tag('amount', ranges[0].max / 100) + tag('currencyCode', 'USD') + '</highEnd>' + tag('period', period[ranges[0].period]) + tag('type', 'BASE_SALARY') + '</salary></salaries>' : ''
      jobs.push('<job>' + tag('partnerJobId', e.id) + common + tag('applyUrl', url.href) + tag('companyId', c.companyId) + tag('posterEmail', c.posterEmail) + tag('location', c.locations.map((x: Data) => `${x.city}, ${x.state}, ${x.country}`).join('; ')) + '<alternateLocations>' + c.locations.map((x: Data) => tag('alternateLocation', `${x.city}, ${x.state}, ${x.country}`)).join('') + '</alternateLocations>' + (type[v.employmentType] ? tag('jobtype', type[v.employmentType]) : '') + tag('workplaceTypes', ({ onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' } as Data)[v.workMode]) + salary + '</job>')
    } else for (const loc of c.locations) {
      const id = (await sha256(e.id + ':' + loc.officeId)).slice(0, 32)
      const range = pay.ranges.find(r => r.location === s.get('office', loc.officeId).name)
      const salary = range ? `$${range.min / 100} - $${range.max / 100} per ${range.period}` : ''
      jobs.push('<job>' + common + tag('date', v.publishedAt) + tag('referencenumber', id) + tag('requisitionid', v.id) + tag('url', url.href) + tag('sourcename', c.companyName) + tag('city', loc.city) + tag('state', loc.state) + tag('country', loc.country) + (loc.postalCode ? tag('postalcode', loc.postalCode) : '') + (loc.streetAddress ? tag('streetaddress', loc.streetAddress) : '') + tag('email', c.posterEmail) + tag('salary', salary) + tag('jobtype', v.employmentType.replace('-', '')) + '</job>')
    }
  }
  const publisher = board === 'indeed' ? tag('publisher', 'Lodge') + tag('publisherurl', origin) : tag('publisher', 'Lodge') + tag('publisherUrl', origin) + tag('lastBuildDate', new Date().toUTCString()) + tag('expectedJobCount', jobs.length)
  return '<?xml version="1.0" encoding="UTF-8"?><source>' + publisher + jobs.join('') + '</source>'
}
