import type { State } from '../core/state'
import { requireThat, type Data } from '../core/types'
import { SOURCE_UI, SPANISH, uiCopy } from '../languages/copy'

/** Publish only generic form labels, never job or applicant data. The labels
 * remain usable after a job closes, independently of whether anyone applied. */
export function publishRecoveryUi(s: State, post: Data) {
  if (post.language === 'en' || post.language === 'es') return
  const copy = uiCopy(post)
  s.put('recovery-ui', post.language, { language: post.language, recoverTitle: copy.recoverTitle, recoverCode: copy.recoverCode, recoverSubmit: copy.recoverSubmit, recoverUnavailable: copy.recoverUnavailable })
}

/** Recovery's unauthenticated form never looks up a receipt or applicant. */
export function recoveryUi(s: State, language: unknown) {
  if (!language || language === 'en') return { language: 'en', copy: SOURCE_UI }
  if (language === 'es') return { language: 'es', copy: SPANISH }
  const published = s.find('recovery-ui', language)
  requireThat(published && published.language === language, 'This recovery interface is not available in that language', 404)
  return { language: published.language as string, copy: published }
}
