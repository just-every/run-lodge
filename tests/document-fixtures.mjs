import { zip } from './zip.mjs'

// Actual readable files, shared by the HTTP and browser DATA-006 journeys.
export const resumeText = 'Avery Brooks\nSite safety: managed loader traffic and forklift inspections.\nExperience: Warehouse lead, 2022-2026.'
export function resumePdf() {
 const content = 'BT /F1 14 Tf 48 740 Td (Avery Brooks) Tj 0 -26 Td (Site safety: forklift inspections and loader traffic.) Tj ET'
 const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`]
 let data = '%PDF-1.4\n', offsets = [0]
 for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(data)); data += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
 const xref = Buffer.byteLength(data)
 data += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return Buffer.from(data)
}
export function resumeDocx() {
 return zip(Object.entries({
  '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Avery Brooks</w:t></w:r></w:p><w:p><w:r><w:t>Site safety: forklift inspections and loader traffic.</w:t></w:r></w:p></w:body></w:document>'
 }).map(([name, text]) => ({ name, bytes: Buffer.from(text) })))
}
export const readerFiles = () => [
 { name: 'avery-resume.pdf', mediaType: 'application/pdf', bytes: resumePdf(), kind: 'resume' },
 { name: 'avery-resume.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: resumeDocx(), kind: 'resume' },
 { name: 'avery-cover.txt', mediaType: 'text/plain', bytes: Buffer.from(resumeText), kind: 'cover-letter' },
 { name: 'avery-work-sample.png', mediaType: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1kAAAAASUVORK5CYII=', 'base64'), kind: 'work-sample' },
]
