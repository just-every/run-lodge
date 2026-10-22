import type { Data } from '../core/types'

const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** The employer's form as a draft saw it: each question with its version and required flag. A new version or an added or removed question refuses older drafts. */
export const formVersion = (questions: Data[]) => questions.map(q => `${q.question}.${q.version}.${q.required ? 1 : 0}`).join(',')

/** Explicit, device-local saving of answers and chosen files; consent, accommodation, monitoring and restricted answers never persist. */
export function draftTools(copy: Data, questions: Data[]) {
  return `<section data-careers-draft data-version="${esc(formVersion(questions))}" hidden aria-label="${esc(copy.draftTitle)}"><h3>${esc(copy.draftTitle)}</h3><p>${esc(copy.draftHelp)}</p><p><button type="button" data-draft-save>${esc(copy.draftSave)}</button></p><p><button type="button" data-draft-resume>${esc(copy.draftResume)}</button></p><p><button type="button" data-draft-clear>${esc(copy.draftClear)}</button></p><p role="status" data-draft-status data-saved="${esc(copy.draftSaved)}" data-resumed="${esc(copy.draftResumed)}" data-cleared="${esc(copy.draftCleared)}" data-unavailable="${esc(copy.draftUnavailable)}"></p></section>`
}
