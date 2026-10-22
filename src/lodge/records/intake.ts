import { requireTranslation } from '../languages/posts'
import type { State } from '../core/state'
import { Fault, about, email, now, optionalText, requireThat, sha256, canonical, text, uid, type Data } from '../core/types'
import { candidateFields, retentionUntil, startApplication } from './candidates'
import { storeDocument } from './documents'
import { inCalifornia, requireCpraNotice } from './privacy'
import { answers, type Answer } from './questions'
import { evaluate } from './rules'
import { ensureSource } from './sources'

// Flow 3: the public application page. The applicant sees the privacy notice
// and accommodation contact; each submission records the notice version and
// returns a receipt. Accommodation and voluntary monitoring answers are kept as
// restricted records that reviewers, search and agent context never see.

export const MONITORING_OPTIONS = ['Prefer not to say', 'Woman', 'Man', 'Non-binary', 'Another description']

/**
 * The door an application came through: the source it records, the intake path
 * SCREEN-002 rules name, the CRM-008 entry the door keeps, and for the board API
 * (ATTR-009) its campaign and the rule that one email applies to a job once.
 */
export interface Door { source: string; path: string; entry: string; campaign?: Data; oncePerJob?: boolean }
export const APPLICATION_PAGE: Door = { source: 'Application page', path: 'Careers page', entry: 'Application page' }

export interface Submission { name: unknown; email: unknown; phone?: unknown; location?: unknown; coverNote?: unknown; noticeVersion: unknown; cpraNoticeVersion?: unknown; consent: unknown; talentPool?: unknown; accommodation?: unknown; monitoring?: unknown; customValues?: Data; resume?: { name: string; mediaType: string; base64: string } | null; answers?: Record<string, Answer> }

/** What the careers page shows of a job: a confidential one appears only under its neutral title, without its department; an internal-only one (ATTR-005) never. */
export function publicPosting(v: Data): Data | null {
  if (v.internalOnly) return null
  if (!v.confidential) return v
  return v.publicTitle ? { ...v, title: v.publicTitle, department: '' } : null
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

/** Take one application; `post` is the ATTR-012 post it came through, recorded on the application. */
export async function submit(s: State, vacancy: Data, input: Submission, door: Door = APPLICATION_PAGE, post: Data | null = null) {
  requireTranslation(s, vacancy, post)
  const business = s.get('business', 'main')
  const notice = business.notices.at(-1)
  // The applicant must have been shown the current notice; a stale page is refused, not silently upgraded.
  about('noticeVersion', () => requireThat(String(input.noticeVersion) === String(notice.version), 'The privacy notice changed while this page was open; reload the page and review it again', 409))
  // PRIV-001: a California job also shows the CPRA notice; its version is checked and recorded the same way.
  const cpra = inCalifornia(s, vacancy, post) ? requireCpraNotice(s) : null
  if (cpra) about('cpraNoticeVersion', () => requireThat(String(input.cpraNoticeVersion) === String(cpra.version), 'The California privacy notice changed while this page was open; reload the page and review it again', 409))
  about('consent', () => requireThat(input.consent === 'yes', 'Confirm you have read the privacy notice'))
  const address = about('email', () => email(input.email, 'Email'))
  const fields = candidateFields({ name: about('name', () => text(input.name, 'Full name', 160)), email: address, phone: about('phone', () => optionalText(input.phone, 'Phone', 40)), location: about('location', () => optionalText(input.location, 'Location', 160)) })
  // SCREEN-001: each answer keeps the question version the applicant was shown.
  const answered = answers(s, vacancy, input.answers ?? {}, post)
  const talentPool = input.talentPool === 'yes'
  ensureSource(s, door.entry, 'careers-site')
  // ATTR-009: one email applies to a job once through the board API. A repeat adds
  // no application; it gets its own receipt and is recorded on the earlier one, so
  // the answer never tells a caller whether that email applied before.
  const earlier = door.oncePerJob && s.scan('application').find(x => x.vacancy === vacancy.id && x.status === 'active' && s.find('candidate', x.candidate)?.email === address)
  if (earlier) return { receipt: await repeat(s, vacancy, earlier, door, notice.version, post, cpra?.version), accommodationContact: business.accommodationContact }
  const candidate = s.put('candidate', uid(), {
    ...fields, language: post?.language ?? 'en', ...(post?.translation?.ui ? { languageUi: post.translation.ui } : {}), source: door.source, createdAt: now(), retainUntil: retentionUntil(s),
    consent: { basis: 'application', noticeVersion: notice.version, ...(cpra ? { cpraNoticeVersion: cpra.version } : {}), talentPool, at: now(), recordedBy: 'applicant' },
  })
  const coverNote = optionalText(input.coverNote, 'Cover note', 8000)
  const fingerprint = await sha256(canonical({ name: fields.name.toLowerCase().replace(/\s+/g, ' '), phone: fields.phone.replace(/\D/g, ''), coverNote, resume: input.resume?.base64 ?? null }))
  const likelySpam = likelySpamReasons(s, vacancy, fields.email, fingerprint)
  const application = startApplication(s, null, candidate, vacancy, door.source, { language: post?.language ?? 'en', ...(post?.translation?.ui ? { languageUi: post.translation.ui } : {}), coverNote, fingerprint, customValues: input.customValues ?? {}, ...(cpra ? { cpraNoticeVersion: cpra.version } : {}), ...(post ? { post: post.id, postTitle: post.title } : {}), ...(door.campaign ? { campaign: door.campaign } : {}), ...(likelySpam.length ? { likelySpam: { reasons: likelySpam, at: now() } } : {}) })
  if (input.resume) await stored('resume', () => storeDocument(s, { candidate: candidate.id, application: application.id, name: input.resume!.name, mediaType: input.resume!.mediaType, base64: input.resume!.base64, kind: 'resume', source: door.source }))
  if (answered.length) {
    for (const x of answered) if (x.type === 'file') {
      const file = x.value as { name: string; mediaType: string; base64: string }
      const doc = await stored('answers.' + x.question, () => storeDocument(s, { candidate: candidate.id, application: application.id, name: file.name, mediaType: file.mediaType, base64: file.base64, kind: 'other', source: door.source + ': ' + x.text }))
      x.value = { document: doc.id, name: doc.name }
    }
    s.put('application', application.id, { ...s.get('application', application.id), answers: answered })
    // SCREEN-002: the job's rules run on the objective answers, as on every intake path.
    evaluate(s, s.get('application', application.id), door.path)
  }
  const accommodation = optionalText(input.accommodation, 'Accommodation request', 4000)
  const monitoring = typeof input.monitoring === 'string' && MONITORING_OPTIONS.includes(input.monitoring) && input.monitoring !== 'Prefer not to say' ? input.monitoring : ''
  if (accommodation) s.put('monitoring', uid(), { application: application.id, type: 'accommodation', answer: accommodation, at: now() })
  if (monitoring) s.put('monitoring', uid(), { application: application.id, type: 'voluntary-monitoring', answer: monitoring, at: now() })
  const code = 'LDG-' + uid().slice(0, 8).toUpperCase()
  const receipt = s.put('receipt', code, {
    language: post?.language ?? 'en', application: application.id, vacancy: vacancy.id, vacancyTitle: post?.title ?? publicPosting(vacancy)!.title, noticeVersion: notice.version, ...(cpra ? { cpraNoticeVersion: cpra.version } : {}), submittedAt: application.submittedAt,
    digest: await sha256(canonical({ ...fields, coverNote: application.coverNote, resume: input.resume?.base64 ?? null, talentPool })),
  })
  s.audit(null, 'application-received', 'application:' + application.id, { receipt: code })
  return { receipt, accommodationContact: business.accommodationContact }
}

async function stored<T>(field: string, store: () => Promise<T>) {
  try { return await store() } catch (e) { if (e instanceof Fault) e.field ??= field; throw e }
}

async function repeat(s: State, vacancy: Data, earlier: Data, door: Door, noticeVersion: unknown, post: Data | null, cpraNoticeVersion?: number) {
  const code = 'LDG-' + uid().slice(0, 8).toUpperCase()
  const at = now()
  s.put('application', earlier.id, { ...s.get('application', earlier.id), repeatSubmissions: [...(earlier.repeatSubmissions ?? []), { at, receipt: code, door: door.source, ...(post ? { post: post.id } : {}) }] })
  const receipt = s.put('receipt', code, { language: post?.language ?? 'en', application: earlier.id, vacancy: vacancy.id, vacancyTitle: post?.title ?? publicPosting(vacancy)!.title, noticeVersion, ...(cpraNoticeVersion ? { cpraNoticeVersion } : {}), submittedAt: at, repeat: true })
  s.audit(null, 'application-repeat', 'application:' + earlier.id, { receipt: code })
  return receipt
}

export function interviewByToken(s: State, token: string) {
  requireThat(typeof token === 'string' && /^[a-f0-9]{48}$/.test(token), 'Not found', 404)
  const found = s.all('interview').find(i => i.candidateToken === token && i.status !== 'cancelled')
  requireThat(found, 'Not found', 404)
  return s.get('interview', found.id)
}

export const publicNoticeText = (business: Data) => text(business.notices.at(-1).text, 'Notice', 20000)
