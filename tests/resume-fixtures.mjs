import { zip } from './zip.mjs'

export const resumeSource = (name = 'Robin Carter', email = 'robin.intake@example.test', phone = '+1 (212) 555-0147') => `${name}\n${email}\n${phone}\nEmployment\nWarehouse lead at Cedar Supply, 2021-2026\nEducation\nAssociate degree in logistics, North College, 2020\nSkills\nInventory planning, forklift inspections\nPersonal details\nGender: woman\nAge: 32`

export function resumeFiles(name = 'Robin Carter', email = 'robin.intake@example.test', prefix = 'robin', phone) {
 const source = resumeSource(name, email, phone)
 const lines = source.split('\n')
 const content = 'BT /F1 12 Tf 48 750 Td ' + lines.map((line, i) => (i ? '0 -22 Td ' : '') + '(' + line.replace(/[\\()]/g, '\\$&') + ') Tj').join(' ') + ' ET'
 const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`]
 let pdf = '%PDF-1.4\n', offsets = []
 for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n` }
 const xref = Buffer.byteLength(pdf)
 pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 const xmlEscape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
 const docx = zip(Object.entries({
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + lines.map(line => '<w:p><w:r><w:t>' + xmlEscape(line) + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>',
 }).map(([name, text]) => ({ name, bytes: Buffer.from(text) })))
 return [
  { name: prefix + '.pdf', mediaType: 'application/pdf', bytes: Buffer.from(pdf), source },
  { name: prefix + '.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx, source },
  { name: prefix + '.txt', mediaType: 'text/plain', bytes: Buffer.from(source), source },
 ]
}
export const unreadableResume = { name: 'unreadable.pdf', mediaType: 'application/pdf', bytes: Buffer.from('%PDF-1.4\nnot a readable PDF'), source: '' }
