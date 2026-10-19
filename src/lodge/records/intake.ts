import type { State } from '../core/state'
import { email, now, optionalText, requireThat, sha256, canonical, text, uid, type Data } from '../core/types'
import { candidateFields, retentionUntil, startApplication } from './candidates'
import { storeDocument } from './documents'
import { answers, type Answer } from './questions'

// Flow 3: the public application page. The applicant sees the privacy notice
// and accommodation contact; each submission records the notice version and
// returns a receipt. Accommodation and voluntary monitoring answers are kept as
// restricted records that reviewers, search and agent context never see.

export const MONITORING_OPTIONS = ['Prefer not to say', 'Woman', 'Man', 'Non-binary', 'Another description']

export interface Submission { name: unknown; email: unknown; phone?: unknown; location?: unknown; coverNote?: unknown; noticeVersion: unknown; consent: unknown; talentPool?: unknown; accommodation?: unknown; monitoring?: unknown; resume?: { name: string; mediaType: string; base64: string } | null; answers?: Record<string, Answer> }

/** What the careers page shows of a job: a confidential one appears only under its neutral title, without its department. */
export function publicPosting(v: Data): Data | null {
  if (!v.confidential) return v
  return v.publicTitle ? { ...v, title: v.publicTitle, department: '' } : null
}

export function openVacancy(s: State, slug: string) {
  const vacancy = s.all('vacancy').find(v => v.slug === slug && v.status === 'open' && publicPosting(v))
  return vacancy ? s.get('vacancy', vacancy.id) : null
}

/**
 * A repeat submission is flagged for a person to review, never removed: the same
 * email or the same submission (name, phone, cover note and resume) already
 * applied to this job, or was once marked as spam anywhere.
 */
function likelySpamReasons(s: State, vacancy: Data, address: string, fingerprint: string) {
  const reasons = new Set<string>()
  for (const app of s.scan('application')) {
    const person = s.find('candidate', app.candidate)
    const sameEmail = !!person?.email && person.email === address, sameSubmission = app.fingerprint === fingerprint
    if (!sameEmail && !sameSubmission) continue
    const what = sameEmail ? 'the same email' : 'an identical submission'
    if (app.status === 'spam' || app.unmarkedSpam?.length) reasons.add(`${what} was marked as spam before`)
    if (app.vacancy === vacancy.id) reasons.add(`${what} already applied to this job`)
  }
  return [...reasons]
}

export async function submit(s: State, vacancy: Data, input: Submission) {
  const business = s.get('business', 'main')
  const notice = business.notices.at(-1)
  // The applicant must have been shown the current notice; a stale page is refused, not silently upgraded.
  requireThat(String(input.noticeVersion) === String(notice.version), 'The privacy notice changed while this page was open; reload the page and review it again', 409)
  requireThat(input.consent === 'yes', 'Confirm you have read the privacy notice')
  const fields = candidateFields({ name: input.name, email: email(input.email, 'Email'), phone: input.phone, location: input.location })
  // SCREEN-001: each answer keeps the question version the applicant was shown.
  const answered = answers(s, vacancy, input.answers ?? {})
  const talentPool = input.talentPool === 'yes'
  const candidate = s.put('candidate', uid(), {
    ...fields, source: 'Application page', createdAt: now(), retainUntil: retentionUntil(s),
    consent: { basis: 'application', noticeVersion: notice.version, talentPool, at: now(), recordedBy: 'applicant' },
  })
  const coverNote = optionalText(input.coverNote, 'Cover note', 8000)
  const fingerprint = await sha256(canonical({ name: fields.name.toLowerCase().replace(/\s+/g, ' '), phone: fields.phone.replace(/\D/g, ''), coverNote, resume: input.resume?.base64 ?? null }))
  const likelySpam = likelySpamReasons(s, vacancy, fields.email, fingerprint)
  const application = startApplication(s, null, candidate, vacancy, 'Application page', { coverNote, fingerprint, ...(likelySpam.length ? { likelySpam: { reasons: likelySpam, at: now() } } : {}) })
  if (input.resume) await storeDocument(s, { candidate: candidate.id, application: application.id, name: input.resume.name, mediaType: input.resume.mediaType, base64: input.resume.base64, kind: 'resume', source: 'Application page' })
  if (answered.length) {
    for (const x of answered) if (x.type === 'file') {
      const file = x.value as { name: string; mediaType: string; base64: string }
      const doc = await storeDocument(s, { candidate: candidate.id, application: application.id, name: file.name, mediaType: file.mediaType, base64: file.base64, kind: 'other', source: 'Application page: ' + x.text })
      x.value = { document: doc.id, name: doc.name }
    }
    s.put('application', application.id, { ...s.get('application', application.id), answers: answered })
  }
  const accommodation = optionalText(input.accommodation, 'Accommodation request', 4000)
  const monitoring = typeof input.monitoring === 'string' && MONITORING_OPTIONS.includes(input.monitoring) && input.monitoring !== 'Prefer not to say' ? input.monitoring : ''
  if (accommodation) s.put('monitoring', uid(), { application: application.id, type: 'accommodation', answer: accommodation, at: now() })
  if (monitoring) s.put('monitoring', uid(), { application: application.id, type: 'voluntary-monitoring', answer: monitoring, at: now() })
  const code = 'LDG-' + uid().slice(0, 8).toUpperCase()
  const receipt = s.put('receipt', code, {
    application: application.id, vacancy: vacancy.id, vacancyTitle: publicPosting(vacancy)!.title, noticeVersion: notice.version, submittedAt: application.submittedAt,
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
