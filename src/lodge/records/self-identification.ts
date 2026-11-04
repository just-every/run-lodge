import type { State } from '../core/state'
import { can, managesVacancy, canSeeCompliance, isAdmin, requireAdmin } from '../core/access'
import { canonical, list, now, oneOf, requireThat, sha256, text, type Actor, type Data } from '../core/types'
import { languageTag } from '../languages/posts'

export const SELF_ID_KINDS = ['eeo', 'disability', 'veteran'] as const
const REVIEW_FIELDS = ['legal', 'applicability', 'notice', 'language', 'retention'] as const
export const DECLINED = '__declined__'

/** Employer-authored collection only. Review is an attestation, never legal approval by Lodge. */
export function selfIdentificationQuestionnaire(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(!a.agent, 'Only a human administrator can review voluntary questionnaires', 403)
  const job = s.get('vacancy', b.vacancy)
  requireThat(managesVacancy(a, job) && can(s, a, job, 'settings'), 'Job not found', 404)
  requireThat(!job.imported && job.status !== 'closed', 'Choose a current native job', 409)
  const kind = oneOf(b.kind, SELF_ID_KINDS, 'Questionnaire kind'), language = languageTag(b.language)
  const id = job.id + ':' + kind + ':' + language, current = s.find('self-id-questionnaire', id)
  requireThat(Number(b.version ?? 0) === (current?.versions.length ?? 0), 'This questionnaire changed; reload before reviewing', 409)
  if (b.enabled === false) {
    requireThat(current, 'Questionnaire not found', 404)
    const record = s.put('self-id-questionnaire', id, { ...current, enabled: false })
    s.audit(a, 'self-identification-disabled', 'vacancy:' + job.id, { questionnaire: id })
    return record
  }
  const review = Object.fromEntries(REVIEW_FIELDS.map(key => [key, text(b.review?.[key], key + ' review evidence', 2000)]))
  requireThat(b.reviewed === true, 'Confirm the exact questionnaire, notice, language, applicability and retention review')
  const questions = list(b.questions, 'Questions', 8, (value, i) => {
    requireThat(!!value && typeof value === 'object' && !Array.isArray(value), 'Provide a question object')
    const q = value as Data
    return ({
    id: 'q' + (i + 1), text: text(q.text, 'Question', 1000),
    options: list(q.options, 'Answer choices', 20, v => text(v, 'Answer choice', 300)),
  }) })
  requireThat(questions.length > 0 && questions.every(q => q.options.length > 0 && new Set(q.options).size === q.options.length && !q.options.includes(DECLINED)), 'Provide questions with distinct answer choices')
  const retentionDays = Number(b.retentionDays)
  requireThat(Number.isInteger(retentionDays) && retentionDays > 0 && retentionDays <= 36500, 'Provide a reviewed retention period in days')
  const version = {
    version: (current?.versions.length ?? 0) + 1, noticeVersion: (current?.versions.length ?? 0) + 1,
    title: text(b.title, 'Questionnaire title', 200), notice: text(b.notice, 'Questionnaire notice', 20000),
    answerLabel: text(b.answerLabel, 'Answer label', 200), unansweredLabel: text(b.unansweredLabel, 'Unanswered label', 200),
    declineLabel: text(b.declineLabel, 'Decline label', 200), consentLabel: text(b.consentLabel, 'Consent label', 1000),
    questions, review, retentionDays, reviewedBy: a.email, reviewedAt: now(),
  }
  const record = s.put('self-id-questionnaire', id, { vacancy: job.id, kind, language, enabled: true, versions: [...(current?.versions ?? []), version] })
  s.audit(a, 'self-identification-reviewed', 'vacancy:' + job.id, { questionnaire: id, version: version.version, language })
  return record
}

/** No fallback language and no dependency of ordinary application validity on optional review. */
export function publicSelfIdentification(s: State, job: Data, post: Data | null = null) {
  return SELF_ID_KINDS.flatMap(kind => {
    const q = s.find('self-id-questionnaire', job.id + ':' + kind + ':' + (post?.language ?? 'en'))
    if (!q?.enabled) return []
    const v = q.versions.at(-1)
    return [{ id: q.id, kind, language: q.language, ...v, review: undefined, reviewedBy: undefined, reviewedAt: undefined }]
  })
}

/** Parse only optional questionnaire controls; the enclosing fieldset is excluded from resumable drafts. */
export function selfIdentificationInput(values: Data, forms: Data[]) {
  return Object.fromEntries(forms.filter(q => values['sid-' + q.id + '-version'] !== undefined).map(q => [q.id, {
    version: values['sid-' + q.id + '-version'], consent: values['sid-' + q.id + '-consent'] === 'yes',
    answers: Object.fromEntries(q.questions.map((question: Data) => [question.id, values['sid-' + q.id + '-' + question.id] ?? ''])),
  }]))
}

export function validateSelfIdentification(s: State, job: Data, input: unknown, post: Data | null) {
  const forms = publicSelfIdentification(s, job, post)
  requireThat(input === undefined || !!input && typeof input === 'object' && !Array.isArray(input), 'Send voluntary responses as an object')
  const given = (input ?? {}) as Data
  for (const id of Object.keys(given)) requireThat(forms.some(q => q.id === id), 'This optional questionnaire is no longer available in this language; omit it or reload', 409)
  return forms.map(form => {
    const submitted = given[form.id]
    if (submitted) requireThat(Number(submitted.version) === form.version, 'This optional questionnaire changed; omit it or reload and review', 409)
    requireThat(!submitted || submitted.answers && typeof submitted.answers === 'object' && !Array.isArray(submitted.answers), 'Send voluntary answers as an object')
    const answers = form.questions.map((q: Data) => {
      const value = submitted?.answers[q.id] ?? ''
      requireThat(value === '' || value === DECLINED || q.options.includes(value), 'Choose a current voluntary answer')
      return { question: q.id, state: value === '' ? 'unanswered' : value === DECLINED ? 'declined' : 'answered', ...(value && value !== DECLINED ? { answer: value } : {}) }
    })
    const hasResponse = answers.some((answer: Data) => answer.state !== 'unanswered')
    requireThat(!hasResponse || submitted?.consent === true, 'Confirm the voluntary questionnaire notice before submitting answers')
    return { questionnaire: form.id, formVersion: form.version, noticeVersion: form.noticeVersion, language: form.language,
      consent: submitted?.consent === true, state: answers.some((x: Data) => x.state === 'answered') ? 'answered' : hasResponse ? 'declined' : 'unanswered', answers,
      form: { ...form, review: s.get('self-id-questionnaire', form.id).versions.at(-1).review },
    }
  })
}

/** Responses never become selection fields. Captures retain their reviewed source despite later form edits. */
export async function recordSelfIdentification(s: State, app: Data, responses: Data[], intakePath: string) {
  for (const response of responses) {
    const id = app.id + ':' + response.questionnaire, previous = s.find('self-id-response', id)
    const digest = await sha256(canonical({ response, intakePath }))
    if (previous && response.state === 'unanswered' && !response.consent) continue
    if (previous?.versions.some((v: Data) => v.digest === digest)) continue
    const at = now()
    s.put('self-id-response', id, { application: app.id, vacancy: app.vacancy, questionnaire: response.questionnaire,
      originalIntakePath: previous?.originalIntakePath ?? app.intakePath ?? 'Original intake path not recorded',
      versions: [...(previous?.versions ?? []), { ...response, intakePath, digest, at, retainUntil: new Date(Date.parse(at) + response.form.retentionDays * 86400000).toISOString() }],
    })
  }
}

export function selfIdentificationView(s: State, a: Actor) {
  return {
    configurations: !a.agent && isAdmin(a) ? s.all('self-id-questionnaire').filter(q => { const job = s.find('vacancy', q.vacancy); return job && (managesVacancy(a, job) && can(s, a, job, 'settings')) }) : [],
    responses: s.all('self-id-response').filter(r => { const app = s.find('application', r.application); return app && canSeeCompliance(s, a, app) }),
  }
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export function selfIdentificationFields(forms: Data[]) {
  return forms.map(q => `<fieldset data-draft-private aria-label="${esc(q.title)}"><legend>${esc(q.title)}</legend><p class="pre">${esc(q.notice)}</p><input type="hidden" name="sid-${esc(q.id)}-version" value="${q.version}">${q.questions.map((question: Data) => `<label>${esc(question.text)}<select name="sid-${esc(q.id)}-${esc(question.id)}"><option value="">${esc(q.unansweredLabel)}</option><option value="${DECLINED}">${esc(q.declineLabel)}</option>${question.options.map((option: string) => `<option>${esc(option)}</option>`).join('')}</select></label>`).join('')}<label><input type="checkbox" name="sid-${esc(q.id)}-consent" value="yes"> ${esc(q.consentLabel)}</label></fieldset>`).join('')
}
