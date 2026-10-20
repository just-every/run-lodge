/** Literal source extraction. No model, demographic classification, ranking or inferred qualifications. */
export interface ResumeFact { value: string; passage: string; uncertain: boolean; reason: string }
export interface ResumeExtraction { name: ResumeFact; email: ResumeFact; phone: ResumeFact; employment: ResumeFact[]; education: ResumeFact[]; skills: ResumeFact[] }
const fact = (value: string, passage: string, uncertain = false, reason = ''): ResumeFact => ({ value, passage, uncertain, reason })
const missing = (label: string) => fact('', '', true, `No ${label} found; review the original`)
const sections: Record<string, 'employment' | 'education' | 'skills' | 'ignore'> = {
 experience: 'employment', 'work experience': 'employment', employment: 'employment', 'employment history': 'employment', 'professional experience': 'employment', 'work history': 'employment',
 education: 'education', qualifications: 'education', 'education and qualifications': 'education',
 skills: 'skills', 'technical skills': 'skills', 'core skills': 'skills', competencies: 'skills',
 interests: 'ignore', hobbies: 'ignore', references: 'ignore', 'personal details': 'ignore', 'personal information': 'ignore', summary: 'ignore', profile: 'ignore', languages: 'ignore', certifications: 'education',
}

export function extractResume(source: string): ResumeExtraction {
 const lines = source.split(/\r?\n/).map(x => x.trim()).filter(Boolean)
 const result: ResumeExtraction = { name: missing('name'), email: missing('email'), phone: missing('phone'), employment: [], education: [], skills: [] }
 const emails = [...source.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
 const phones = [...source.matchAll(/(?:\+?\d[\d ().-]{6,}\d)/g)].filter(m => m[0].replace(/\D/g, '').length >= 7 && !/^\d{4}\s*[-–]\s*\d{4}$/.test(m[0]))
 const contact = (matches: RegExpMatchArray[], label: string) => matches.length ? fact(matches[0][0].trim(), lines.find(x => x.includes(matches[0][0].trim())) ?? matches[0][0], matches.length > 1, matches.length > 1 ? `Multiple ${label} values; confirm which to keep` : '') : missing(label)
 result.email = contact(emails, 'email'); result.email.value = result.email.value.toLowerCase()
 result.phone = contact(phones, 'phone')
 const named = lines.find(x => /^(?:full name|name)\s*:/i.test(x))
 if (named) result.name = fact(named.replace(/^(?:full name|name)\s*:\s*/i, ''), named)
 else if (lines[0] && /^[\p{L}][\p{L}\p{M} .'-]{1,159}$/u.test(lines[0]) && !sections[lines[0].toLowerCase()] && !/^(resume|curriculum vitae|cv)$/i.test(lines[0])) result.name = fact(lines[0], lines[0], true, 'First line may be a name; confirm it')
 let section: keyof Pick<ResumeExtraction, 'employment' | 'education' | 'skills'> | 'ignore' = 'ignore'
 for (const line of lines) {
  const match = line.match(/^([^:]{2,60}):(?:\s*(.*))?$/)
  const heading = (match?.[1] ?? line).toLowerCase().replace(/[：:]$/, '').trim()
  if (sections[heading]) {
   section = sections[heading]
   if (section !== 'ignore' && match?.[2]) result[section].push(fact(match[2], line, true, 'Literal section text; verify its meaning and dates'))
  } else if (section !== 'ignore') {
   // A new unrecognised heading ends the section rather than classifying unrelated personal data.
   if (/^[\p{L} ][\p{L} &/ -]{1,55}:$/u.test(line)) { section = 'ignore'; continue }
   result[section].push(fact(line, line, true, 'Literal section text; verify its meaning and dates'))
  }
 }
 return result
}

export const extractedValues = (e: ResumeExtraction) => ({ name: e.name.value, email: e.email.value, phone: e.phone.value, employment: e.employment.map(f => f.value).join('\n'), education: e.education.map(f => f.value).join('\n'), skills: e.skills.map(f => f.value).join('\n') })
