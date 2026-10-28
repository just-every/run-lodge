import { validateAssessments } from './assessment-policy.mjs';
import { validateReferralRecords } from './referral-policy.mjs';
import { createHash } from 'node:crypto';
import { PortabilityError } from '@runeditrun/rer/modules/portability';
import { validateCandidateLineage } from './candidate-lineage.mjs';
import { validateAgencyRecords } from './agency-policy.mjs';

const refuse = condition => { if (!condition) throw new PortabilityError('lodge_staged_validation', 409); };

/** Validate the staged copy before Base publishes any installation records. */
export async function validateStaged({ read }) {
 const rows = await read('l_records');
 const records = new Map();
 for (const row of rows) {
  let value;
  try { value = JSON.parse(row.value); } catch { refuse(false); }
  refuse(value && typeof value === 'object' && !Array.isArray(value));
  // Imported blobs predate State.put's embedded id; the table key is authoritative.
  refuse(value.id === row.id || row.kind === 'blob' && value.id === undefined);
  records.set(row.kind + ':' + row.id, value);
 }
 const get = (kind, id) => records.get(kind + ':' + id);
 const reference = (kind, id) => { refuse(typeof id === 'string' && !!get(kind, id)); return get(kind, id); };
 const original = value => {
  const blob = reference('blob', value.id);
  refuse(typeof value.mediaType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(value.mediaType) && blob.mediaType === value.mediaType);
  refuse(typeof blob.base64 === 'string' && blob.base64.length > 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(blob.base64));
  const bytes = Buffer.from(blob.base64, 'base64');
  refuse(bytes.toString('base64') === blob.base64 && Number.isSafeInteger(value.size) && value.size > 0 && bytes.length === value.size);
  refuse(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && createHash('sha256').update(bytes).digest('hex') === value.sha256);
 };
 validateAssessments({ rows, get, reference, refuse });
 validateCandidateLineage(rows.filter(row => row.kind === 'candidate').map(row => get(row.kind, row.id)), refuse);
 const referralFiles = validateReferralRecords({ rows, get, reference, refuse, original });
 const agencyFiles = validateAgencyRecords({ rows, get, reference, refuse, original });
 const captureFiles = new Set();
 for (const row of rows.filter(row => row.kind === 'capture-mail')) {
  const mail = get(row.kind, row.id);
  reference('member', mail.member);
  refuse(typeof mail.operator === 'string' && Array.isArray(mail.contactAddresses) && mail.contactAddresses.every(address => typeof address === 'string'));
  refuse(Array.isArray(mail.contactDigests) && mail.contactDigests.every(digest => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)));
  if (mail.candidate) refuse(!reference('candidate', mail.candidate).deleted);
  refuse(Array.isArray(mail.attachments) && mail.attachments.length <= 10);
  for (const file of mail.attachments) {
   refuse(!captureFiles.has(file.id));
   original(file);
   captureFiles.add(file.id);
  }
 }

 for (const row of rows) {
  const value = get(row.kind, row.id);
  if (row.kind === 'weekly-report') refuse(value.enabled === false && value.status === 'withheld');
  if (row.kind === 'weekly-report-attempt') reference('weekly-report', value.schedule);
  if (row.kind === 'analysis-schedule') reference('analysis-chart', value.chart);
  if (row.kind === 'application') { reference('candidate', value.candidate); reference('vacancy', value.vacancy); }
  if (['interview-day', 'crm-reply', 'crm-enrollment', 'hiring-reminder', 'interview', 'scorecard', 'interview-note', 'stage-event', 'application-email', 'application-submission', 'message', 'offer', 'receipt', 'monitoring'].includes(row.kind)) reference('application', value.application);
  if (row.kind === 'interviewer-pool') reference('vacancy', value.vacancy);
  if (row.kind === 'application-email') {
   const app = reference('application', value.application);
   refuse(value.candidate === app.candidate && value.vacancy === app.vacancy);
   refuse(['pending', 'sending', 'handed', 'delivered', 'failed', 'withheld', 'uncertain', 'canceled', 'suppressed', 'bounced'].includes(value.status));
  }
  if (row.kind === 'application-submission') refuse(reference('receipt', value.receipt).application === value.application);
  if (row.kind === 'application-email-policy' || row.kind === 'application-email-template') reference('vacancy', value.vacancy);
  if (['imported-note', 'imported-rating', 'imported-message'].includes(row.kind)) { reference('candidate', value.candidate); if (value.application) reference('application', value.application); }
  if (row.kind === 'resume-extraction') {
   reference('candidate', value.candidate);
   refuse(reference('document', value.document).candidate === value.candidate);
   if (value.application) refuse(reference('application', value.application).candidate === value.candidate);
  }
  if (row.kind === 'resume-intake-settings') refuse(Number.isSafeInteger(value.retentionDays) && value.retentionDays > 0 && Number.isFinite(new Date(Date.now() + value.retentionDays * 86400000).getTime()));
  if (row.kind === 'resume-intake') {
   if (value.status !== 'committed') {
    refuse(typeof value.uploadedAt === 'string' && Number.isFinite(Date.parse(value.uploadedAt)));
    if (value.expiresAt !== undefined) refuse(typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)) && Date.parse(value.expiresAt) > Date.parse(value.uploadedAt));
    else refuse(Number.isFinite(new Date(Date.parse(value.uploadedAt) + 30 * 86400000).getTime()));
   }
   if (value.vacancy) reference('vacancy', value.vacancy);
   if (value.status === 'committed') { reference('candidate', value.candidate); const document = reference('document', row.id); refuse(document.candidate === value.candidate && document.application === value.application); if (value.application) reference('application', value.application); }
  }
  if (row.kind === 'blob') {
   const staged = get('resume-intake', row.id);
   refuse(!!get('document', row.id) || !!staged && staged.status !== 'committed' || agencyFiles.has(row.id) || referralFiles.has(row.id) || captureFiles.has(row.id));
  }
  const stagedOriginal = row.kind === 'resume-intake' && value.status !== 'committed';
  if (row.kind !== 'document' && !stagedOriginal) continue;
  if (!stagedOriginal) {
   reference('candidate', value.candidate);
   if (value.application) refuse(reference('application', value.application).candidate === value.candidate);
  }
  original({ ...value, id: row.id });
  refuse(value.kind !== 'right-to-work' || value.restricted === true);
 }
 return true;
}

export const policy = {
 product: 'just-every/hiring-lodge',
 exportRow(table, row) {
  if (table === 'l_records' && row.kind === 'proposal') {
   const value = JSON.parse(row.value);
   if (value.delayTrial) return { ...row, value: JSON.stringify({ ...value, delayTrial: { ...value.delayTrial, status: 'withheld', token: null } }) };
  }
  if (table === 'l_records' && row.kind === 'interview-day') {
   const value = JSON.parse(row.value);
   return { ...row, value: JSON.stringify({ ...value, status: 'draft', review: null, fingerprint: 'restored-review-required' }) };
  }
  if (table === 'l_records' && row.kind === 'weekly-report') {
   const value = JSON.parse(row.value);
   return { ...row, value: JSON.stringify({ ...value, enabled: false, status: 'withheld' }) };
  }
  if (table === 'l_records' && row.kind === 'analysis-schedule') {
   const value = JSON.parse(row.value);
   return { ...row, value: JSON.stringify({ ...value, status: 'withheld', enabled: false, reason: 'Restored chart delivery requires fresh human review', finishedAt: value.finishedAt ?? value.createdAt }) };
  }
  if (table === 'l_records' && row.kind === 'crm-reply-route') return { ...row, value: JSON.stringify({ ...JSON.parse(row.value), status: 'withheld', digest: null, epoch: null }) };
  if (table === 'l_records' && ['hiring-reminder', 'crm-enrollment'].includes(row.kind)) {
   const value = JSON.parse(row.value);
   return { ...row, value: JSON.stringify({ ...value, status: 'withheld', reason: 'Restored archive requires fresh reminder review' }) };
  }
  if (table === 'l_records' && ['application-email-policy', 'application-email-transport', 'application-email'].includes(row.kind)) {
   const value = JSON.parse(row.value);
   if (row.kind === 'application-email-policy') {
    return { ...row, value: JSON.stringify({ ...value, acknowledgment: false, stages: [] }) };
   }
   if (row.kind === 'application-email-transport') {
    return { ...row, value: JSON.stringify({ ...value, enabled: false }) };
   }
   if (value.status === 'pending') {
    return { ...row, value: JSON.stringify({ ...value, status: 'withheld', reason: 'Restored archive requires review' }) };
   }
  }
  if (table === 'l_records' && row.kind === 'candidate-email-change') {
   const value = JSON.parse(row.value);
   return { ...row, value: JSON.stringify({ id: row.id, candidate: value.candidate, application: value.application, expiresAt: 0 }) };
  }
  if (table === 'l_records' && row.kind === 'receipt') {
   const value = JSON.parse(row.value);
   delete value.recoveryHash; delete value.recoveryExpires; delete value.recoveryCopy;
   return { ...row, value: JSON.stringify(value) };
  }
  return row;
 },
 // Base's operator identities travel with the archive so restored memberships keep their people;
 // sessions, tokens, dependency keys and pending links stay behind (Base's default exclusions).
 includeTables: ['oa_operators', 'oa_bootstrap', 'oa_external_identities', 'oa_invitation_cancellations', 'oa_tokens', 'oa_auth_settings', 'oa_auth_audit', 'oa_domain_rules', 'oa_logout_events', 'oc_owner_claims', 'oc_idp_grants'],
 excludeTables: ['l_application_email_activation', 'l_app_credentials'],
 requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
 validateStaged,
};
export default policy;
