import type { State } from '../core/state'
import { isAdmin, managesVacancy, requireApplication } from '../core/access'
import { base64ToBytes, bytesToBase64, now, oneOf, requireThat, sha256, text, uid, type Actor, type Data } from '../core/types'

// Candidate documents keep their original bytes. The bytes live in a separate
// 'blob' record that only scoped downloads read; restricted kinds never reach
// reviewers, searches, agent context or non-admin exports.

export const DOCUMENT_KINDS = ['resume', 'cover-letter', 'portfolio', 'work-sample', 'right-to-work', 'offer', 'other'] as const
export const MAX_DOCUMENT_BYTES = 1_000_000
const ALWAYS_RESTRICTED = new Set(['right-to-work'])

export interface DocumentInput { candidate: string; application?: string | null; name: unknown; mediaType: unknown; base64: unknown; kind: unknown; restricted?: unknown; source: string }

export async function storeDocument(s: State, input: DocumentInput) {
  requireThat(typeof input.base64 === 'string' && input.base64.length > 0, 'File bytes are required')
  let bytes: Uint8Array
  try { bytes = base64ToBytes(input.base64) } catch { requireThat(false, 'File bytes must be base64') }
  requireThat(bytes!.length > 0, 'The file is empty')
  requireThat(bytes!.length <= MAX_DOCUMENT_BYTES, 'Files may be at most 1 MB in this release', 413)
  const kind = oneOf(input.kind ?? 'other', DOCUMENT_KINDS, 'Document kind')
  const mediaType = typeof input.mediaType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(input.mediaType) ? input.mediaType : 'application/octet-stream'
  const id = uid()
  s.put('blob', id, { base64: bytesToBase64(bytes!), mediaType })
  return s.put('document', id, {
    candidate: input.candidate, application: input.application ?? null, name: text(input.name, 'File name', 200).replace(/[\\/]/g, '_'),
    mediaType, size: bytes!.length, sha256: await sha256(bytes!), kind, restricted: ALWAYS_RESTRICTED.has(kind) || input.restricted === true, source: input.source, addedAt: now(),
  })
}

/** Staff add a document to an application they run, or to a candidate as an admin. */
export async function addDocument(s: State, a: Actor, b: Data) {
  let candidate: string, application: string | null = null
  if (b.application) {
    const app = requireApplication(s, a, b.application)
    requireThat(managesVacancy(a, s.get('vacancy', app.vacancy)), 'Only the hiring team can add documents', 403)
    candidate = app.candidate; application = app.id
  } else {
    requireThat(isAdmin(a), 'Only the owner or a hiring admin can add candidate-level documents', 403)
    candidate = s.get('candidate', b.candidate).id
  }
  const doc = await storeDocument(s, { candidate, application, name: b.name, mediaType: b.mediaType, base64: b.base64, kind: b.kind, restricted: b.restricted, source: 'uploaded by ' + a.email })
  s.audit(a, 'document-added', 'document:' + doc.id, { kind: doc.kind, restricted: doc.restricted })
  return doc
}

export function removeDocument(s: State, id: string) {
  s.remove('document', id)
  s.drop('blob', id)
}
