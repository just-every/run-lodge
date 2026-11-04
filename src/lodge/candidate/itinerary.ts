import type { State } from '../core/state'
import { canSeeApplication, canSeeContact, isAdmin, managesVacancy, requireAdmin, requireApplication, requireManages } from '../core/access'
import { canonical, list, now, requireThat, sha256, text, type Actor, type Data } from '../core/types'

/** Every word in the candidate projection is reviewed separately from booking permission. */
export const itineraryCopy: Record<string, Record<string, string>> = {
  en: { heading: 'Your interview itinerary', zone: 'Time zone', applyZone: 'Show times', download: 'Download calendar', scheduled: 'Scheduled', rescheduled: 'Rescheduled', cancelled: 'Canceled', minutes: 'minutes', back: 'Your application', boundary: 'Native schedule only. No confirmation, update, cancellation or reminder has been delivered by this page. Connected calendars and video meetings are not verified.' },
  es: { heading: 'Tu itinerario de entrevistas', zone: 'Zona horaria', applyZone: 'Mostrar horarios', download: 'Descargar calendario', scheduled: 'Programada', rescheduled: 'Reprogramada', cancelled: 'Cancelada', minutes: 'minutos', back: 'Tu solicitud', boundary: 'Solo horario local. Esta página no ha enviado confirmaciones, actualizaciones, cancelaciones ni recordatorios. Los calendarios y las reuniones de vídeo conectados no están verificados.' },
}
export const itineraryWords = Object.keys(itineraryCopy.en)

function candidate(s: State, app: Data): Data {
  let c = s.get('candidate', app.candidate)
  const seen = new Set<string>()
  while (c.mergedInto && !seen.has(c.id)) { seen.add(c.id); c = s.get('candidate', c.mergedInto) }
  requireThat(!c.deleted && !c.mergedInto, 'This page is not available', 404)
  return c
}

function sessions(s: State, app: Data) {
  return s.scan('interview').filter(iv => iv.application === app.id).sort((a, b) => a.id.localeCompare(b.id))
}

/** Hash source revisions, never send source identities or staff fields to a candidate. */
async function source(s: State, app: Data) {
  const c = candidate(s, app)
  const interviews = sessions(s, app).map(iv => ({ id: iv.id, revision: s.revisionOf('interview', iv.id), members: iv.participants.map((id: string) => {
    s.find('member', id)
    return { id, revision: s.revisionOf('member', id) }
  }) }))
  return sha256(canonical({ application: app.id, candidate: app.candidate, identity: { id: c.id, email: c.email, name: c.name, revision: s.revisionOf('candidate', c.id) }, status: app.status, language: app.language ?? 'en', interviews }))
}

const eligible = (iv: Data) => !!iv.start && ['scheduled', 'cancelled'].includes(iv.status) && !iv.imported
function safe(value: unknown, label: string, max = 500) {
  const result = text(value, label, max)
  requireThat(!/@|\/app\b|\/api\/lodge\b|\/availability\//i.test(result), 'Candidate fields cannot contain email addresses or internal links')
  return result
}

/** Owner and hiring admins review a complete exact projection, with current application scope. */
export async function reviewItinerary(s: State, a: Actor, b: Data) {
  requireThat(!a.agent, 'Only a person can review candidate sharing', 403)
  requireAdmin(a)
  const app = requireApplication(s, a, b.application)
  const vacancy = s.get('vacancy', app.vacancy), c = candidate(s, app)
  requireManages(a, vacancy)
  requireThat(canSeeContact(s, a, c), 'Candidate not found', 404)
  const previous = app.candidateItinerary
  requireThat(b.version === (previous?.version ?? 0), 'Sharing changed; reload before reviewing', 409)
  if (b.enabled !== true) {
    s.put('application', app.id, { ...app, candidateItinerary: { enabled: false, version: (previous?.version ?? 0) + 1 } })
    s.audit(a, 'candidate-itinerary-disabled', 'application:' + app.id)
    return { enabled: false }
  }
  requireThat(app.status === 'active' && !app.imported && c.email, 'This application cannot share an itinerary', 409)
  requireThat(b.reviewed === true && b.language === (app.language ?? 'en'), 'Review all candidate fields in the application language')
  const fingerprint = await source(s, app)
  requireThat(b.source === fingerprint, 'Interview sources changed; reload and review again', 409)
  const copy = Object.fromEntries(itineraryWords.map(key => [key, safe(b.copy?.[key], key, 1000)]))
  const disclosed = list(b.sessions, 'Shared sessions', 24, raw => {
    requireThat(raw && typeof raw === 'object', 'Choose a scheduled session')
    const input = raw as Data
    const iv = s.get('interview', input.interview)
    requireThat(iv.application === app.id && eligible(iv), 'Share only scheduled native sessions on this application', 409)
    requireThat(iv.participants.every((id: string) => { const m = s.get('member', id); return m.active && !m.agent }), 'The panel changed; review its current membership', 409)
    const panel = list(input.panel ?? [], 'Approved interviewer names', 8, raw => {
      requireThat(raw && typeof raw === 'object', 'Choose an interviewer')
      const p = raw as Data
      requireThat(iv.participants.includes(p.member), 'Approve only this session’s interviewers')
      return { member: p.member, name: safe(p.name, 'Interviewer display name', 160), title: safe(p.title, 'Interviewer title', 160) }
    })
    requireThat(new Set(panel.map(p => p.member)).size === panel.length, 'Choose each interviewer once')
    return { interview: iv.id, title: safe(input.title, 'Candidate session title', 200), location: safe(input.location, 'Candidate location', 500), panel }
  })
  requireThat(disclosed.length > 0 && new Set(disclosed.map(iv => iv.interview)).size === disclosed.length, 'Choose distinct scheduled sessions')
  const review = { enabled: true, version: (previous?.version ?? 0) + 1, source: fingerprint, language: b.language, copy, sessions: disclosed, by: a.email, at: now() }
  s.put('application', app.id, { ...app, candidateItinerary: review })
  s.audit(a, 'candidate-itinerary-reviewed', 'application:' + app.id, { version: review.version, language: review.language })
  return { enabled: true, version: review.version }
}

export async function itinerarySettings(s: State, a: Actor, app: Data) {
  const v = s.get('vacancy', app.vacancy), c = candidate(s, app)
  if (a.agent || !isAdmin(a) || !managesVacancy(a, v) || !canSeeContact(s, a, c)) return null
  const fingerprint = await source(s, app), review = app.candidateItinerary
  return { application: app.id, source: fingerprint, version: review?.version ?? 0, enabled: !!review?.enabled, current: !!review?.enabled && review.source === fingerprint, language: app.language ?? 'en', copy: review?.language === (app.language ?? 'en') ? review.copy : itineraryCopy[app.language ?? 'en'], sessions: sessions(s, app).filter(eligible).map(iv => ({ id: iv.id, title: iv.title, location: iv.location, start: iv.start, durationMinutes: iv.durationMinutes, status: iv.status, reviewed: review?.sessions?.find((x: Data) => x.interview === iv.id), panel: iv.participants.map((id: string) => { const m = s.get('member', id); return { member: id, name: m.name, active: m.active && !m.agent } }) })) }
}

/** A positive allowlist is the sole source for both page and calendar bytes. */
export async function ownItinerary(s: State, app: Data) {
  const review = app.candidateItinerary
  requireThat(app.status === 'active' && !app.imported && review?.enabled && review.language === (app.language ?? 'en'), 'This page is not available', 404)
  const author = s.find('member', review.by), v = s.get('vacancy', app.vacancy)
  requireThat(author?.active && !author.agent && isAdmin(author as Actor) && managesVacancy(author as Actor, v) && canSeeApplication(s, author as Actor, app) && canSeeContact(s, author as Actor, candidate(s, app)), 'This page is not available', 404)
  requireThat(review.source === await source(s, app), 'This page is not available', 404)
  const shared = review.sessions.map((item: Data) => {
    const iv = s.get('interview', item.interview)
    requireThat(iv.application === app.id && eligible(iv), 'This page is not available', 404)
    const state = iv.status === 'cancelled' ? 'cancelled' : iv.candidateBookings?.at(-1)?.from ? 'rescheduled' : 'scheduled'
    return { id: iv.id, title: item.title, location: item.location, panel: item.panel.map((p: Data) => ({ name: p.name, title: p.title })), start: iv.start, durationMinutes: iv.durationMinutes, state }
  }).sort((a: Data, b: Data) => a.start.localeCompare(b.start))
  return { version: review.version, language: review.language, copy: review.copy, sessions: shared }
}

const icsText = (v: string) => v.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[;,]/g, c => '\\' + c)
const icsTime = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
function fold(line: string) {
  const result: string[] = []; let part = '', bytes = 0
  for (const char of line) { const n = new TextEncoder().encode(char).length; if (bytes + n > 75) { result.push(part); part = ' '; bytes = 1 }; part += char; bytes += n }
  return [...result, part].join('\r\n')
}

/** No staff calendar reuse: no attendee, organizer, internal URL or feedback. */
export function candidateCalendar(view: Data, zone: string) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lodge//Candidate itinerary//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-TIMEZONE:${zone}`]
  for (const iv of view.sessions) lines.push('BEGIN:VEVENT', `UID:${iv.id}.candidate-itinerary`, `SEQUENCE:${view.version}`, `DTSTAMP:${icsTime(now())}`, `DTSTART:${icsTime(iv.start)}`, `DTEND:${icsTime(new Date(Date.parse(iv.start) + iv.durationMinutes * 60000).toISOString())}`, `STATUS:${iv.state === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, `SUMMARY:${icsText(iv.title)}`, `LOCATION:${icsText(iv.location)}`, `DESCRIPTION:${icsText([view.copy[iv.state], `${iv.durationMinutes} ${view.copy.minutes}`, ...iv.panel.map((p: Data) => `${p.name} — ${p.title}`)].join('\n'))}`, 'END:VEVENT')
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
