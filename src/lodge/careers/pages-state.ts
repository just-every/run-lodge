import { loadKinds } from '../core/store'

// What an applicant-facing careers page may read: the open roles and the employer's own words
// (jobs, offices, departments, pay and privacy notices, the reviewed posting and its approval,
// the screening questions, and the people who may review a posting), never an application,
// a candidate, mail or audit history. A page loads these kinds and nothing else, so its D1 cost
// follows the size of the company's setup, not of its hiring history. The state refuses a read
// of any other kind, so a page that starts to need one fails in test instead of rendering without it.
export const CAREERS_KINDS = ['business', 'vacancy', 'office', 'department', 'member', 'permission-level', 'approval', 'question', 'job-posting-review', 'careers-brand', 'cpra-notice', 'fair-chance'] as const

export const loadCareers = (db: D1Database) => loadKinds(db, CAREERS_KINDS)
/** An embedded careers page also reads the job board's settings (who may frame it) and the old links it still answers. */
export const loadEmbeddedCareers = (db: D1Database) => loadKinds(db, [...CAREERS_KINDS, 'job-board', 'legacy-link'])
/** The employer's logo, colours and name, for the frame around a careers page. */
export const loadCareersBrand = (db: D1Database) => loadKinds(db, ['careers-brand', 'business'])
