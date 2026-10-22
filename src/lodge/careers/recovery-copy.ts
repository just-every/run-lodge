import type { State } from '../core/state'
import { requireThat } from '../core/types'
import { SOURCE_UI, SPANISH, uiCopy } from '../languages/copy'
import { listingBySlug, type Destination } from '../records/posts'

/** Recovery's unauthenticated form uses public reviewed text, never a receipt lookup. */
export function recoveryUi(s: State, language: unknown, slug: unknown, destination: Destination) {
  if (!language || language === 'en') return { language: 'en', copy: SOURCE_UI }
  if (language === 'es') return { language: 'es', copy: SPANISH }
  const listing = typeof slug === 'string' && listingBySlug(s, destination, slug)
  requireThat(listing && listing.post?.language === language, 'This recovery interface is not available in that language', 404)
  return { language: listing.post.language as string, copy: uiCopy(listing.post) }
}
