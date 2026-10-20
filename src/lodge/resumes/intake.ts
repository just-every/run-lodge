import type { State } from '../core/state'
import { canSeeContact } from '../core/access'
import { base64ToBytes, now, optionalText, requireThat, type Actor, type Data } from '../core/types'
import { storeOriginal } from '../records/documents'
import { extractResume } from './extraction'
import { requireIntakeScope } from './scope'
import { intakeDeadline, intakeExpired, newIntakeDeadline } from './lifecycle'

export function canReadIntake(s: State, a: Actor, row: Data) {
 if (a.agent || row.by !== a.email || intakeExpired(row)) return false
 try {
  requireIntakeScope(s, a, row.vacancy)
  return !row.candidate || canSeeContact(s, a, s.get('candidate', row.candidate))
 } catch { return false }
}
export function requireIntake(s: State, a: Actor, id: unknown) {
 const row = s.find('resume-intake', id)
 requireThat(row && canReadIntake(s, a, row), 'Resume intake not found', 404)
 return row
}
export const intakeView = (s: State, a: Actor) => s.all('resume-intake').filter(r => canReadIntake(s, a, r)).map(row => row.status === 'committed' ? row : { ...row, expiresAt: intakeDeadline(row) })

/** Save the original before attempting decoding. A corrupt file is still a durable, downloadable original. */
export async function uploadResume(s: State, a: Actor, b: Data) {
 requireIntakeScope(s, a, b.vacancy)
 requireThat(b.file && typeof b.file === 'object', 'Choose a resume')
 const original = await storeOriginal(s, b.file)
 const uploadedAt = now()
 const row = s.put('resume-intake', original.id, { ...original, by: a.email, vacancy: b.vacancy || null, status: 'uploaded', extraction: null, sourceText: '', parseError: '', uploadedAt, expiresAt: newIntakeDeadline(s, uploadedAt) })
 // Text is decoded from the saved upload input itself; binary formats use the app's PDF.js/Word decoder next.
 if (/^text\//.test(original.mediaType) || /\.txt$/i.test(original.name)) {
  try {
   const source = new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(b.file.base64))
   return parsedResume(s, a, { id: row.id, text: source }, true)
  } catch { return parsedResume(s, a, { id: row.id, failure: 'The text file is not readable UTF-8' }) }
 }
 s.audit(a, 'resume-uploaded', 'resume-intake:' + row.id, { vacancy: row.vacancy })
 return row
}

/** Browser decoding is explicit recruiter-supplied source text, not a claim of server OCR or AI. */
export function parsedResume(s: State, a: Actor, b: Data, originalText = false) {
 const row = requireIntake(s, a, b.id)
 requireThat(row.status !== 'committed', 'This resume has already been committed', 409)
 const sourceText = optionalText(b.text, 'Decoded resume text', 100000)
 const suppliedFailure = optionalText(b.failure, 'Parse failure', 1000)
 const failure = suppliedFailure || (!sourceText || !/[\p{L}]/u.test(sourceText) || /\u0000/.test(sourceText) ? 'No readable text was extracted; download the original and enter details manually' : '')
 const record = s.put('resume-intake', row.id, { ...row, sourceText: failure ? '' : sourceText, extraction: failure ? null : extractResume(sourceText), decodedBy: originalText ? 'original-utf8' : 'recruiter-local', status: failure ? 'failed' : 'review', parseError: failure, review: null, parsedAt: now() })
 s.audit(a, failure ? 'resume-parse-failed' : 'resume-parsed', 'resume-intake:' + row.id, { vacancy: row.vacancy })
 return record
}

/** Exact factual duplicate suggestions, restricted to existing contact access. The scan fences additions too. */
export function resumeDuplicates(s: State, a: Actor, fields: Data) {
 const digits = (x: string) => (x || '').replace(/\D/g, '')
 const name = (x: string) => (x || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
 return s.scan('candidate').filter(c => !c.deleted && !c.mergedInto && canSeeContact(s, a, c)).flatMap(c => {
  const reasons: string[] = []
  if (fields.email && fields.email === c.email?.toLowerCase()) reasons.push('same email')
  if (digits(fields.phone).length >= 7 && digits(fields.phone) === digits(c.phone)) reasons.push('same phone')
  if (name(fields.name) && name(fields.name) === name(c.name)) reasons.push('same name')
  return reasons.length ? [{ candidate: c.id, name: c.name, reasons, revision: s.revisionOf('candidate', c.id) }] : []
 }).sort((x, y) => x.candidate.localeCompare(y.candidate))
}
