import { readDocument } from '../document-rendering'
import type { D, Mutate } from '../shared'

/** Decode the durable original, so the passages reviewed belong to the uploaded bytes. */
export async function decodeResume(row: D, mutate: Mutate) {
 const response = await fetch('/api/lodge/download/resume-intake/' + row.id)
 if (!response.ok) throw new Error('The original cannot be read with your current access')
 const bytes = await response.arrayBuffer()
 let source = '', failure = ''
 try {
  if (!(row.mediaType === 'application/pdf' || /\.(pdf|docx|txt)$/i.test(row.name) || row.mediaType.startsWith('text/') || row.mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) throw new Error('Choose a PDF, DOCX or UTF-8 text resume')
  const reading = await readDocument(bytes, row.name, row.mediaType)
  try { source = reading.pages.map(p => p.text).join('\n\n'); if (source.length > 100000) { failure = 'The extracted text exceeds the 100,000-character review limit; enter details manually'; source = '' } } finally { reading.dispose() }
 } catch (error) { failure = 'Could not read ' + row.name + ': ' + (error as Error).message }
 return mutate('resume-parsed', { id: row.id, text: source, failure })
}
