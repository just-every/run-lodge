import type { State } from '../core/state'
import { email, now, optionalText, requireThat, sha256, canonical, text, uid, type Data } from '../core/types'
import { candidateFields, retentionUntil, startApplication } from './candidates'
import { storeDocument } from './documents'

// Flow 3: the public application page. The applicant sees the privacy notice
// and accommodation contact; each submission records the notice version and
// returns a receipt. Accommodation and voluntary monitoring answers are kept as
// restricted records that reviewers, search and agent context never see.

export const MONITORING_OPTIONS = ['Prefer not to say', 'Woman', 'Man', 'Non-binary', 'Another description']

export interface Submission { name: unknown; email: unknown; phone?: unknown; location?: unknown; coverNote?: unknown; noticeVersion: unknown; consent: unknown; talentPool?: unknown; accommodation?: unknown; monitoring?: unknown; resume?: { name: string; mediaType: string; base64: string } | null }

export function openVacancy(s: State, slug: string) {
  const vacancy = s.all('vacancy').find(v => v.slug === slug && v.status === 'open')
  return vacancy ? s.get('vacancy', vacancy.id) : null
}

export async function submit(s: State, vacancy: Data, input: Submission) {
  const business = s.get('business', 'main')
  const notice = business.notices.at(-1)
  // The applicant must have been shown the current notice; a stale page is refused, not silently upgraded.
  requireThat(String(input.noticeVersion) === String(notice.version), 'The privacy notice changed while this page was open; reload the page and review it again', 409)
  requireThat(input.consent === 'yes', 'Confirm you have read the privacy notice')
  const fields = candidateFields({ name: input.name, email: email(input.email, 'Email'), phone: input.phone, location: input.location })
  const talentPool = input.talentPool === 'yes'
  const candidate = s.put('candidate', uid(), {
    ...fields, source: 'Application page', createdAt: now(), retainUntil: retentionUntil(s),
    consent: { basis: 'application', noticeVersion: notice.version, talentPool, at: now(), recordedBy: 'applicant' },
  })
  const application = startApplication(s, null, candidate, vacancy, 'Application page', { coverNote: optionalText(input.coverNote, 'Cover note', 8000) })
  if (input.resume) await storeDocument(s, { candidate: candidate.id, application: application.id, name: input.resume.name, mediaType: input.resume.mediaType, base64: input.resume.base64, kind: 'resume', source: 'Application page' })
  const accommodation = optionalText(input.accommodation, 'Accommodation request', 4000)
  const monitoring = typeof input.monitoring === 'string' && MONITORING_OPTIONS.includes(input.monitoring) && input.monitoring !== 'Prefer not to say' ? input.monitoring : ''
  if (accommodation) s.put('monitoring', uid(), { application: application.id, type: 'accommodation', answer: accommodation, at: now() })
  if (monitoring) s.put('monitoring', uid(), { application: application.id, type: 'voluntary-monitoring', answer: monitoring, at: now() })
  const code = 'LDG-' + uid().slice(0, 8).toUpperCase()
  const receipt = s.put('receipt', code, {
    application: application.id, vacancy: vacancy.id, vacancyTitle: vacancy.title, noticeVersion: notice.version, submittedAt: application.submittedAt,
    digest: await sha256(canonical({ ...fields, coverNote: application.coverNote, resume: input.resume?.base64 ?? null, talentPool })),
  })
  s.audit(null, 'application-received', 'application:' + application.id, { receipt: code })
  return { receipt, accommodationContact: business.accommodationContact }
}

export function interviewByToken(s: State, token: string) {
  requireThat(typeof token === 'string' && /^[a-f0-9]{48}$/.test(token), 'Not found', 404)
  const found = s.all('interview').find(i => i.candidateToken === token && i.status !== 'cancelled')
  requireThat(found, 'Not found', 404)
  return s.get('interview', found.id)
}

export const publicNoticeText = (business: Data) => text(business.notices.at(-1).text, 'Notice', 20000)
