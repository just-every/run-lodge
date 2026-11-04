/** Channel evidence may travel as history; it never restores live permission. */
export function validateChannelConsent({ rows, get, reference, refuse }) {
 const root = id => {
  const visited = new Set();
  let person = reference('candidate', id);
  while (person.mergedInto) {
   refuse(!visited.has(person.id)); visited.add(person.id);
   person = reference('candidate', person.mergedInto);
  }
  refuse(!person.deleted);
  return person.id;
 };
 const channels = ['sms', 'whatsapp'];
 const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
 for (const row of rows.filter(row => ['channel-number', 'channel-notice', 'channel-consent'].includes(row.kind))) {
  const value = get(row.kind, row.id);
  refuse(value.restored === true);
  if (row.kind === 'channel-number') {
   root(value.candidate);
   refuse(channels.includes(value.channel) && row.id === value.candidate + ':' + value.channel && Array.isArray(value.versions) && value.versions.length > 0);
   for (const [i, v] of value.versions.entries()) refuse(v.version === i + 1 && /^\+[1-9]\d{7,14}$/.test(v.number) && v.ownership === 'unverified' && typeof v.by === 'string' && stamp(v.at));
   continue;
  }
  const app = reference('application', value.application);
  refuse(channels.includes(value.channel) && row.id === value.application + ':' + value.channel);
  if (row.kind === 'channel-notice') {
   refuse(Array.isArray(value.versions) && value.versions.length > 0);
   for (const [i, v] of value.versions.entries()) refuse(v.version === i + 1 && typeof v.language === 'string' && v.language.length > 0 && typeof v.text === 'string' && v.text.length > 0 && typeof v.purpose === 'string' && v.purpose.length > 0 && typeof v.reviewedBy === 'string' && stamp(v.reviewedAt));
   continue;
  }
  refuse(Array.isArray(value.history) && value.history.length > 0);
  const requests = new Set();
  for (const [i, h] of value.history.entries()) {
   refuse(h.revision === i + 1 && ['consent', 'refuse', 'withdraw'].includes(h.decision) && root(h.candidate) === app.candidate && typeof h.request === 'string' && !requests.has(h.request) && typeof h.by === 'string' && /^[a-f0-9]{64}$/.test(h.sessionDigest) && stamp(h.at));
   requests.add(h.request);
   if (h.decision === 'withdraw') continue;
   const notice = reference('channel-notice', row.id), profile = reference('channel-number', h.candidate + ':' + value.channel);
   refuse(Array.isArray(notice.versions) && Array.isArray(profile.versions));
   const v = notice.versions.find(v => v.version === h.noticeVersion), n = profile.versions.find(v => v.version === h.numberVersion);
   refuse(!!v && !!n && h.number === n.number && h.ownership === 'unverified' && h.noticeText === v.text && h.language === v.language && h.purpose === v.purpose);
   refuse(typeof h.zone === 'string');
   try { new Intl.DateTimeFormat('en', { timeZone: h.zone }).format(); } catch { refuse(false); }
   refuse(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(h.start) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(h.end) && h.start < h.end);
  }
 }
}
