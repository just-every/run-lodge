import type { State } from '../core/state'
import { can, canSeeApplication, managesVacancy, requireApplication, requireCan } from '../core/access'
import { canonical, integer, now, oneOf, requireThat, sha256, text, type Actor, type Data } from '../core/types'
import { mergedCandidates } from '../records/candidate-lineage'

export const CHANNELS = ['sms', 'whatsapp'] as const
export const channelId = (application: string, channel: string) => application + ':' + channel

/** Native human contact authority only; this record never authorizes a provider operation. */
export function canReviewChannels(s: State, a: Actor, app: Data) {
  const job = s.find('vacancy', app.vacancy)
  return !a.agent && !!job && canSeeApplication(s, a, app) && managesVacancy(a, job) && can(s, a, job, 'contact')
}

export function reviewChannelNotice(s: State, a: Actor, b: Data) {
  requireThat(!a.agent, 'Only a person can review channel wording', 403)
  const app = requireApplication(s, a, b.application), job = s.get('vacancy', app.vacancy)
  requireThat(canReviewChannels(s, a, app), 'Channel review is not available', 403)
  requireCan(s, a, job, 'settings')
  const channel = oneOf(b.channel, CHANNELS, 'Channel'), id = channelId(app.id, channel)
  const record = s.find('channel-notice', id), versions = record?.versions ?? []
  requireThat(Number(b.version) === versions.length, 'The channel notice changed; review it again', 409)
  requireThat(b.reviewed === true, 'Confirm employer notice and language review')
  const language = text(b.language, 'Application language', 40)
  requireThat(language === (app.language ?? 'en'), 'Review the application’s exact language', 409)
  const version = { version: versions.length + 1, language, purpose: text(b.purpose, 'Named purpose', 500), text: text(b.text, 'Channel notice', 5000), reviewedBy: a.id, reviewedAt: now() }
  s.audit(a, 'channel-notice-reviewed', 'application:' + app.id, { channel, version: version.version })
  return s.put('channel-notice', id, { application: app.id, channel, versions: [...versions, version], restored: false })
}

export function changeChannelNumber(s: State, a: Actor, candidate: Data, b: Data) {
  const record = s.find('channel-number', candidate.id), versions = record?.versions ?? []
  requireThat(Number(b.version) === versions.length, 'Your channel number changed; reload before saving', 409)
  const number = text(b.number, 'Number with country code', 16)
  requireThat(/^\+[1-9]\d{7,14}$/.test(number), 'Use + followed by the country code and number')
  if (versions.at(-1)?.number === number && !record?.restored) return record
  const version = { version: versions.length + 1, number, by: a.id, at: now(), ownership: 'unverified' }
  s.audit(a, 'channel-number-changed', 'candidate:' + candidate.id)
  return s.put('channel-number', candidate.id, { candidate: candidate.id, versions: [...versions, version], restored: false })
}

function timeZone(value: unknown) {
  const zone = text(value, 'Time zone', 100)
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format() } catch { requireThat(false, 'Use a valid IANA time zone') }
  return zone
}
function clock(value: unknown, label: string) {
  const result = text(value, label, 5)
  requireThat(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result), 'Use a contact-window time from 00:00 to 23:59')
  return result
}

/** Every choice appends history, and fences the prior revision, number, notice and native session. */
export async function chooseChannel(s: State, a: Actor, candidate: Data, app: Data, b: Data) {
  const channel = oneOf(b.channel, CHANNELS, 'Channel'), id = channelId(app.id, channel)
  const record = s.find('channel-consent', id), history = record?.history ?? []
  const request = text(b.request, 'Choice reference', 100)
  const decision = oneOf(b.decision, ['consent', 'refuse', 'withdraw'] as const, 'Your choice')
  const input = { channel, decision, revision: Number(b.revision), noticeVersion: Number(b.noticeVersion), numberVersion: Number(b.numberVersion), zone: b.zone ?? '', start: b.start ?? '', end: b.end ?? '' }
  const fingerprint = canonical(input), prior = history.find((h: Data) => h.request === request)
  if (prior) {
    requireThat(prior.candidate === candidate.id && prior.fingerprint === fingerprint, 'That choice reference was already used', 409)
    return record
  }
  requireThat(integer(b.revision, 'Choice revision', 0, 1_000_000) === history.length, 'Your channel choice changed; reload before saving', 409)
  let snapshot: Data = {}
  if (decision !== 'withdraw') {
    requireThat(app.status === 'active' && !app.candidateWithdrawnAt, 'This application is closed', 409)
    const notice = s.find('channel-notice', id), current = notice?.versions.at(-1)
    requireThat(current && !notice?.restored && current.language === (app.language ?? 'en') && Number(b.noticeVersion) === current.version, 'The reviewed channel wording changed or is unavailable; reload', 409)
    const profile = s.find('channel-number', candidate.id), number = profile?.versions.at(-1)
    requireThat(number && !profile?.restored && Number(b.numberVersion) === number.version, 'Your channel number changed or is unavailable; enter it and choose again', 409)
    if (decision === 'consent') requireThat(candidate.contactPreference?.preference !== 'none', 'Your global no-contact preference takes priority', 409)
    const zone = timeZone(b.zone), start = clock(b.start, 'Window start'), end = clock(b.end, 'Window end')
    requireThat(start < end, 'Choose a same-day window with the end after the start')
    snapshot = { number: number.number, numberVersion: number.version, ownership: 'unverified', noticeVersion: current.version, language: current.language, purpose: current.purpose, noticeText: current.text, zone, start, end }
  }
  const event = { ...snapshot, revision: history.length + 1, candidate: candidate.id, decision, request, fingerprint, at: now(), by: a.id, sessionDigest: await sha256(a.session) }
  s.audit(a, 'channel-choice-recorded', 'application:' + app.id, { channel, decision, revision: event.revision })
  return s.put('channel-consent', id, { application: app.id, channel, history: [...history, event], restored: false })
}

export function channelStatus(s: State, app: Data, channel: string) {
  const record = s.find('channel-consent', channelId(app.id, channel)), last = record?.history.at(-1)
  const candidate = s.find('candidate', app.candidate), profile = s.find('channel-number', app.candidate)
  const number = profile?.versions.at(-1), notice = s.find('channel-notice', channelId(app.id, channel)), wording = notice?.versions.at(-1)
  let reason = 'No explicit channel permission'
  if (last) reason = last.decision === 'withdraw' ? 'Channel permission withdrawn' : last.decision === 'refuse' ? 'Channel permission refused' : 'Fresh permission required'
  const eligible = last?.decision === 'consent' && !record?.restored && !profile?.restored && !notice?.restored && last.candidate === app.candidate && last.numberVersion === number?.version && last.number === number?.number && last.noticeVersion === wording?.version && last.language === (app.language ?? 'en')
  if (eligible) reason = 'Current local permission recorded; number ownership unverified'
  if (record?.restored || profile?.restored || notice?.restored) reason = 'Restored history; fresh review and permission required'
  if (app.status !== 'active' || app.candidateWithdrawnAt) reason = 'Application closed or withdrawn'
  if (candidate?.contactPreference?.preference === 'none') reason = 'Global no-contact preference takes priority'
  const currentPermission = !!eligible && !!candidate && !candidate.deleted && !candidate.mergedInto && app.status === 'active' && !app.candidateWithdrawnAt && candidate.contactPreference?.preference !== 'none'
  return { channel, currentPermission, reason, messagingAuthorized: false }
}

export function channelView(s: State, a: Actor) {
  const apps = s.all('application').filter(app => canReviewChannels(s, a, app)), ids = new Set(apps.map(app => app.id))
  const candidates = new Set(apps.flatMap(app => [app.candidate, ...mergedCandidates(s.all('candidate'), app.candidate).map(c => c.id)]))
  return {
    notices: s.all('channel-notice').filter(n => ids.has(n.application)),
    numbers: s.all('channel-number').filter(n => candidates.has(n.candidate)),
    choices: s.all('channel-consent').filter(r => ids.has(r.application)).map(r => ({ ...r, ...channelStatus(s, s.get('application', r.application), r.channel) })),
  }
}
