// A small, dependency-free PDF writer for OFFER-005: plain Helvetica text pages, uncompressed streams. The sealed
// offer is the approved document's text followed by a signature page; the completion certificate is its own PDF.

const WIN_ANSI: Record<string, number> = { '—': 0x97, '–': 0x96, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, ' ': 0x20 }
const LINE = 92, PAGE_LINES = 58

function encode(line: string): number[] {
  const out: number[] = []
  for (const ch of line) {
    const code = ch.codePointAt(0)!
    const mapped = WIN_ANSI[ch] ?? (code >= 0x20 && code <= 0xff ? code : 0x3f)
    if (mapped === 0x28 || mapped === 0x29 || mapped === 0x5c) out.push(0x5c)
    out.push(mapped)
  }
  return out
}

/** Hard-wrap at word boundaries, splitting unbroken runs (hashes, long user agents) at the line width. */
export function wrap(text: string, width = LINE): string[] {
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    let line = ''
    for (const word of raw.split(' ')) {
      let rest = word
      while (rest.length > width) { if (line) { lines.push(line); line = '' } lines.push(rest.slice(0, width)); rest = rest.slice(width) }
      if (!line) line = rest
      else if (line.length + 1 + rest.length <= width) line += ' ' + rest
      else { lines.push(line); line = rest }
    }
    lines.push(line)
  }
  return lines
}

export function pdf(sections: { title?: string; lines: string[] }[]): Uint8Array {
  const pages: string[][] = []
  for (const section of sections) {
    const all = [...(section.title ? [section.title, ''] : []), ...section.lines.flatMap(l => wrap(l))]
    for (let i = 0; i < Math.max(all.length, 1); i += PAGE_LINES) pages.push(all.slice(i, i + PAGE_LINES))
  }
  const chunks: number[][] = [], offsets: number[] = []
  let length = 0
  const push = (bytes: number[]) => { chunks.push(bytes); length += bytes.length }
  const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))
  const object = (n: number, body: number[]) => { offsets[n] = length; push([...ascii(`${n} 0 obj\n`), ...body, ...ascii('\nendobj\n')]) }
  push(ascii('%PDF-1.4\n'))
  object(1, ascii('<< /Type /Catalog /Pages 2 0 R >>'))
  object(2, ascii(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`))
  object(3, ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
  pages.forEach((lines, i) => {
    const content = [...ascii('BT /F1 10 Tf 12 TL 54 738 Td\n')]
    for (const line of lines) content.push(...ascii('('), ...encode(line), ...ascii(') Tj T*\n'))
    content.push(...ascii('ET'))
    object(4 + i * 2, ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`))
    object(5 + i * 2, [...ascii(`<< /Length ${content.length} >>\nstream\n`), ...content, ...ascii('\nendstream')])
  })
  const count = 4 + pages.length * 2, xref = length
  push(ascii(`xref\n0 ${count}\n0000000000 65535 f \n` + offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  return Uint8Array.from(chunks.flat())
}
