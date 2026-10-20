import { createHash } from 'node:crypto';
import { PortabilityError } from '@runeditrun/rer/modules/portability';
import { validateCandidateLineage } from './candidate-lineage.mjs';

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
 validateCandidateLineage(rows.filter(row => row.kind === 'candidate').map(row => get(row.kind, row.id)), refuse);
 for (const row of rows) {
  const value = get(row.kind, row.id);
  if (row.kind === 'application') { reference('candidate', value.candidate); reference('vacancy', value.vacancy); }
  if (['interview', 'scorecard', 'interview-note', 'stage-event', 'message', 'offer', 'receipt', 'monitoring'].includes(row.kind)) reference('application', value.application);
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
   refuse(!!get('document', row.id) || !!staged && staged.status !== 'committed');
  }
  const stagedOriginal = row.kind === 'resume-intake' && value.status !== 'committed';
  if (row.kind !== 'document' && !stagedOriginal) continue;
  if (!stagedOriginal) {
   reference('candidate', value.candidate);
   if (value.application) refuse(reference('application', value.application).candidate === value.candidate);
  }
  const blob = reference('blob', row.id);
  refuse(typeof value.mediaType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(value.mediaType) && blob.mediaType === value.mediaType);
  refuse(typeof blob.base64 === 'string' && blob.base64.length > 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(blob.base64));
  const bytes = Buffer.from(blob.base64, 'base64');
  refuse(bytes.toString('base64') === blob.base64 && Number.isSafeInteger(value.size) && value.size > 0 && bytes.length === value.size);
  refuse(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && createHash('sha256').update(bytes).digest('hex') === value.sha256);
  refuse(value.kind !== 'right-to-work' || value.restricted === true);
 }
 return true;
}

export const policy = {
 product: 'just-every/hiring-lodge',
 // Base's operator identities travel with the archive so restored memberships keep their people;
 // sessions, tokens, dependency keys and pending links stay behind (Base's default exclusions).
 includeTables: ['oa_operators', 'oa_bootstrap', 'oa_external_identities', 'oa_invitation_cancellations', 'oa_tokens', 'oa_auth_settings', 'oa_auth_audit', 'oa_domain_rules', 'oa_logout_events', 'oc_owner_claims', 'oc_idp_grants'],
 requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
 validateStaged,
};
export default policy;
