/** Archives keep local evidence, never permission for a provider operation. */
export function validateBackgroundAuthorizations({ rows, get, reference, refuse }) {
  const string = x => typeof x === 'string' && !!x.trim();
  const stamp = x => string(x) && Number.isFinite(Date.parse(x));
  for (const row of rows.filter(r => r.kind === 'background-authorization')) {
    const r = get(row.kind, row.id), app = reference('application', r.application);
    refuse(r.id === app.id && r.candidate === app.candidate && !reference('candidate', r.candidate).deleted);
    refuse(r.historical === true && Array.isArray(r.versions) && r.versions.length > 0 && Array.isArray(r.history));
    for (const [i, v] of r.versions.entries()) {
      refuse(v.version === i + 1 && v.disclosureVersion === v.version && v.authorizationVersion === v.version);
      for (const key of ['disclosure', 'authorization', 'purpose', 'checkScope', 'language', 'legalReview', 'retentionReview', 'reviewedBy']) refuse(string(v[key]));
      refuse(stamp(v.reviewedAt) && v.candidateIdentity && string(v.candidateIdentity.candidate) && string(v.candidateIdentity.email) && string(v.candidateIdentity.name));
      const person = reference('candidate', v.candidateIdentity.candidate), seen = new Set();
      let at = person;
      while (at.mergedInto && !seen.has(at.id)) { seen.add(at.id); at = reference('candidate', at.mergedInto); }
      refuse(at.id === r.candidate);
    }
    const keys = new Set(), states = new Map();
    for (const e of r.history) {
      const v = r.versions.find(v => v.version === e.version);
      refuse(v && e.disclosureVersion === v.disclosureVersion && e.authorizationVersion === v.authorizationVersion);
      refuse(string(e.responseId) && !keys.has(e.responseId) && /^[a-f0-9]{64}$/.test(e.fingerprint)); keys.add(e.responseId);
      refuse(stamp(e.at) && e.identity && ['operator', 'session', 'email', 'name'].every(k => string(e.identity[k])));
      const person = reference('candidate', e.identity.candidate), seen = new Set();
      let at = person;
      while (at.mergedInto && !seen.has(at.id)) { seen.add(at.id); at = reference('candidate', at.mergedInto); }
      refuse(at.id === r.candidate);
      const previous = states.get(e.version) ?? 'unanswered';
      refuse(e.action === 'withdrawn' ? previous === 'agreed' : ['agreed', 'refused'].includes(e.action) && previous === 'unanswered');
      states.set(e.version, e.action);
    }
  }
}
