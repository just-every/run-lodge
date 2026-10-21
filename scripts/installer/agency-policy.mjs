/** Frozen agency submissions keep originals before any canonical person exists. */
export function validateAgencyRecords({ rows, get, reference, refuse, original }) {
 const of = kind => rows.filter(row => row.kind === kind).map(row => get(kind, row.id));
 const string = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
 const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
 const address = value => typeof value === 'string' && value === value.trim().toLowerCase() && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(value);
 const agencies = new Map(), names = new Set(), files = new Set();
 for (const agency of of('agency')) {
  refuse(string(agency.name, 120, true) && address(agency.email) && typeof agency.active === 'boolean');
  refuse(!agencies.has(agency.email) && !names.has(agency.name.toLowerCase()));
  agencies.set(agency.email, agency); names.add(agency.name.toLowerCase());
  const member = reference('member', agency.email);
  refuse(member.email === agency.email && member.active === agency.active);
  refuse(Array.isArray(member.roles) && member.roles.length === 1 && member.roles[0] === 'agency');
  refuse(member.owner === false && member.agent === false && member.seePrivate === false && !member.actsFor);
  refuse(!member.grants && !(member.grantDepartments?.length) && !(member.grantOffices?.length) && !Object.keys(member.grantLevels ?? {}).length);
 }
 for (const member of of('member')) {
  if (Array.isArray(member.roles) && member.roles.includes('agency')) refuse(agencies.has(member.email));
  if (member.agent) refuse(!agencies.has(member.actsFor));
 }
 for (const grant of of('agency-job')) {
  reference('agency', grant.agency); reference('vacancy', grant.vacancy);
  refuse(grant.id === grant.agency + ':' + grant.vacancy && typeof grant.active === 'boolean' && string(grant.feeTerms, 2000));
 }
 for (const sub of of('agency-submission')) {
  reference('agency', sub.agency); reference('vacancy', sub.vacancy);
  const grant = reference('agency-job', sub.agency + ':' + sub.vacancy);
  refuse(grant.agency === sub.agency && grant.vacancy === sub.vacancy);
  refuse(string(sub.name, 200, true) && address(sub.email) && string(sub.phone, 100) && string(sub.summary, 4000));
  refuse(string(sub.consentNote, 1000, true) && date(sub.submittedAt) && string(sub.feeTerms, 2000));
  refuse(['Under review', 'Accepted-credited', 'Not accepted: duplicate', 'Not accepted'].includes(sub.outcome));
  refuse(['Submitted', 'In review', 'Interviewing', 'Offer', 'Hired', 'Not progressing', 'Withdrawn'].includes(sub.progress));
  refuse(string(sub.feedback, 4000) && Array.isArray(sub.interviews) && Array.isArray(sub.fees) && Array.isArray(sub.files));
  for (const interview of sub.interviews) {
   refuse(interview && date(interview.start) && date(interview.end) && interview.end > interview.start && ['phone', 'video', 'in-person'].includes(interview.format));
  }
  for (const fee of sub.fees) {
   refuse(fee && string(fee.id, 200, true) && string(fee.label, 200, true) && Number.isSafeInteger(fee.amountCents) && fee.amountCents >= 0);
   refuse(['agreed', 'due', 'paid'].includes(fee.status) && address(fee.by) && date(fee.at));
  }
  if (sub.candidate != null) refuse(!reference('candidate', sub.candidate).deleted);
  if (sub.application != null) reference('application', sub.application);
  if (sub.outcome === 'Accepted-credited') {
   let person = reference('candidate', sub.candidate);
   // Candidate merges move applications/documents, retaining the frozen ancestor id.
   while (person.mergedInto) person = reference('candidate', person.mergedInto);
   const app = reference('application', sub.application);
   refuse(!person.deleted && app.candidate === person.id && app.vacancy === sub.vacancy && app.agencySubmission === sub.id);
  } else refuse(sub.candidate == null && sub.application == null);
  if (sub.outcome !== 'Under review') refuse(address(sub.decidedBy) && date(sub.decidedAt) && string(sub.decisionReason, 1000, true));
  for (const file of sub.files) {
   refuse(file && string(file.id, 200, true) && !files.has(file.id) && string(file.name, 200, true) && date(file.addedAt));
   files.add(file.id); original(file);
   if (sub.outcome === 'Accepted-credited') refuse(reference('document', file.id).application === sub.application);
  }
 }
 for (const app of of('application')) if (app.agencySubmission != null) {
  const sub = reference('agency-submission', app.agencySubmission);
  refuse(sub.outcome === 'Accepted-credited' && sub.application === app.id);
 }
 return files;
}
