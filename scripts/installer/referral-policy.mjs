/** Pending referrals own originals before the employer reconciles a canonical identity. */
export function validateReferralRecords({ rows, get, reference, refuse, original }) {
  const files = new Set()
  const string = (v, max, required = false) => typeof v === 'string' && v.length <= max && (!required || v.trim().length > 0)
  const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v))
  for (const row of rows.filter(r => r.kind === 'referral')) {
    const r = get(row.kind, row.id), employee = reference('member', r.employee)
    reference('vacancy', r.vacancy)
    refuse(!employee.agent && !employee.roles?.includes('agency'))
    refuse(string(r.name, 160, true) && string(r.email, 254, true) && string(r.consentNote, 1000, true) && r.confirmed === true && date(r.submittedAt))
    refuse(['Under review', 'accepted', 'duplicate', 'declined'].includes(r.outcome))
    refuse(r.progress === null || ['received', 'in progress', 'closed', 'hired'].includes(r.progress))
    refuse(Array.isArray(r.files) && r.files.length > 0 && Array.isArray(r.answers) && Array.isArray(r.milestones) && Array.isArray(r.decisions))
    if (r.outcome === 'accepted' || r.outcome === 'duplicate') {
      let c = reference('candidate', r.candidate)
      while (c.mergedInto) c = reference('candidate', c.mergedInto)
      const app = reference('application', r.application)
      refuse(!c.deleted && app.candidate === c.id && app.vacancy === r.vacancy)
    } else refuse(r.candidate == null && r.application == null)
    for (const file of r.files) {
      refuse(file && string(file.id, 200, true) && !files.has(file.id) && string(file.name, 200, true))
      files.add(file.id); original(file)
    }
    for (const m of r.milestones) refuse(m && string(m.label, 200, true) && Number.isSafeInteger(m.amountCents) && m.amountCents >= 0 && ['approved', 'due', 'paid'].includes(m.status) && m.approved === true && m.employee === r.employee && date(m.at))
  }
  return files
}
