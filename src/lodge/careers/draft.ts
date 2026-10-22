import type { Data } from '../core/types'

const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Explicit, device-local saving; private answers, files and consent never persist. */
export function draftTools(copy: Data) {
  return `<section data-careers-draft hidden aria-label="${esc(copy.draftTitle)}"><h3>${esc(copy.draftTitle)}</h3><p>${esc(copy.draftHelp)}</p><p><button type="button" data-draft-save>${esc(copy.draftSave)}</button></p><p><button type="button" data-draft-resume>${esc(copy.draftResume)}</button></p><p><button type="button" data-draft-clear>${esc(copy.draftClear)}</button></p><p role="status" data-draft-status data-saved="${esc(copy.draftSaved)}" data-resumed="${esc(copy.draftResumed)}" data-cleared="${esc(copy.draftCleared)}" data-unavailable="${esc(copy.draftUnavailable)}"></p></section>`
}
