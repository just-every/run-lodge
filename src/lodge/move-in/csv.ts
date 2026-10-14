// RFC 4180 CSV with quoted fields and line breaks inside quotes. A row whose
// field count differs from the header is returned as malformed (quarantined by
// the caller), never silently padded or truncated.

export interface CsvRow { line: number; values: Record<string, string> }
export interface CsvResult { headers: string[]; rows: CsvRow[]; malformed: { line: number; reason: string }[]; error?: string }

export function parseCsv(text: string): CsvResult {
  const records: { line: number; fields: string[] }[] = []
  let fields: string[] = [], field = '', quoted = false, closed = false, line = 1, start = 1
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const endField = () => { fields.push(field); field = ''; closed = false }
  const endRecord = () => { endField(); if (fields.some(f => f !== '') || fields.length > 1) records.push({ line: start, fields }); fields = []; start = line }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else { if (c === '\n') line++; field += c }
      continue
    }
    if (c === '"' && field === '' && !closed) quoted = true
    else if (c === ',') endField()
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; line++; endRecord() }
    else if (closed) return { headers: [], rows: [], malformed: [], error: `Unexpected text after a closing quote on line ${line}` }
    else field += c
  }
  if (quoted) return { headers: [], rows: [], malformed: [], error: 'A quoted field is never closed' }
  if (field !== '' || fields.length) endRecord()
  const header = records.shift()
  if (!header) return { headers: [], rows: [], malformed: [], error: 'The file is empty' }
  const headers = header.fields.map(h => h.trim())
  const rows: CsvRow[] = [], malformed: { line: number; reason: string }[] = []
  for (const r of records) {
    if (r.fields.length !== headers.length) malformed.push({ line: r.line, reason: `has ${r.fields.length} fields; the header has ${headers.length}` })
    else rows.push({ line: r.line, values: Object.fromEntries(headers.map((h, i) => [h, r.fields[i]])) })
  }
  return { headers, rows, malformed }
}
