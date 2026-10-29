/** Validate take-home relationships before an archive becomes live. Authority stays in current memberships. */
export function validateAssessments({ rows, get, reference, refuse }) {
  const taggedFiles = new Set();
  const file = (id, record, version, purpose) => {
    const doc = reference('document', id);
    refuse(doc.application === record.application && doc.candidate === record.candidate && doc.takeHome === record.id && doc.takeHomeVersion === version && doc.takeHomePurpose === purpose);
    refuse(!taggedFiles.has(id)); taggedFiles.add(id);
  };
  for (const row of rows.filter(r => r.kind === 'take-home')) {
    const record = get(row.kind, row.id), app = reference('application', record.application), job = reference('vacancy', app.vacancy);
    refuse(record.id === app.id && record.candidate === app.candidate && Array.isArray(record.versions) && record.versions.length > 0);
    for (const [i, v] of record.versions.entries()) {
      refuse(v.version === i + 1 && typeof v.instructions === 'string' && !!v.instructions.trim() && v.delivery === 'not-delivered');
      refuse(job.rubrics.some(r => r.version === v.rubricVersion) && v.rubricVersion === app.rubricVersion && job.stages.some(s => s.id === v.stage));
      refuse(typeof v.dueAt === 'string' && Number.isFinite(Date.parse(v.dueAt)) && typeof v.timeZone === 'string');
      try { new Intl.DateTimeFormat('en-US', { timeZone: v.timeZone }); } catch { refuse(false); }
      refuse(Array.isArray(v.graders) && v.graders.length === 2 && new Set(v.graders).size === 2 && v.graders.every(g => typeof g === 'string'));
      refuse(typeof v.released === 'boolean' && Array.isArray(v.extensions));
      for (const e of v.extensions) refuse(Number.isFinite(Date.parse(e.from)) && Date.parse(e.to) > Date.parse(e.from) && typeof e.reason === 'string' && !!e.reason.trim());
      if (v.attachment) file(v.attachment, record, v.version, 'instructions');
    }
  }
  for (const row of rows.filter(r => ['take-home-submission', 'take-home-grade'].includes(r.kind))) {
    const value = get(row.kind, row.id), record = reference('take-home', value.assessment), v = record.versions.find(v => v.version === value.version);
    refuse(v && value.application === record.application && value.candidate === record.candidate);
    const id = record.id + ':v' + v.version;
    if (row.kind === 'take-home-submission') {
      refuse(value.id === id && typeof value.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.fingerprint));
      refuse(Array.isArray(value.files) && value.files.length <= 5 && typeof value.link === 'string' && (value.files.length || value.link));
      refuse(Number.isFinite(Date.parse(value.receivedAt)));
      if (value.link) { try { const url = new URL(value.link); refuse(url.protocol === 'https:' && !url.username && !url.password); } catch { refuse(false); } }
      for (const id of value.files) file(id, record, v.version, 'submission');
    } else {
      refuse(value.submission === id && reference('take-home-submission', value.submission).assessment === record.id);
      refuse(value.id === id + ':' + value.author && v.graders.includes(value.author) && value.rubricVersion === v.rubricVersion);
    }
  }
  for (const row of rows.filter(r => r.kind === 'document')) if (get(row.kind, row.id).takeHome) refuse(taggedFiles.has(row.id));
}
