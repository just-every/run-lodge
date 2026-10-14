// How a vacancy's stored keys read to people, in the workspace and on the application pages.
export const WORK_MODES: Record<string, string> = { onsite: 'On site', hybrid: 'Hybrid', remote: 'Remote' }
export const EMPLOYMENT_TYPES: Record<string, string> = { 'full-time': 'Full-time', 'part-time': 'Part-time', contract: 'Contract', temporary: 'Temporary' }
export const vacancyFacts = (v: { department?: string; location?: string; workMode?: string; employmentType?: string }, withDepartment = true) =>
  [withDepartment ? v.department : '', v.location, v.workMode && (WORK_MODES[v.workMode] ?? v.workMode), v.employmentType && (EMPLOYMENT_TYPES[v.employmentType] ?? v.employmentType)].filter(Boolean) as string[]
