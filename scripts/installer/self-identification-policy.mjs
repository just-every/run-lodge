/** Restricted answer custody must retain the exact reviewed source and original application. */
export function validateSelfIdentification({ rows, get, reference, refuse }) {
  const forms = new Map();
  for (const row of rows.filter(r => r.kind === 'self-id-questionnaire')) {
    const q = get(row.kind, row.id);
    reference('vacancy', q.vacancy);
    refuse(['eeo', 'disability', 'veteran'].includes(q.kind) && typeof q.language === 'string' && q.id === q.vacancy + ':' + q.kind + ':' + q.language && typeof q.enabled === 'boolean');
    refuse(Array.isArray(q.versions) && q.versions.length > 0);
    for (const [i, v] of q.versions.entries()) {
      refuse(v.version === i + 1 && v.noticeVersion === v.version && typeof v.notice === 'string' && !!v.notice.trim());
      refuse(Number.isInteger(v.retentionDays) && v.retentionDays > 0 && v.retentionDays <= 36500);
      refuse(['legal', 'applicability', 'notice', 'language', 'retention'].every(key => typeof v.review?.[key] === 'string' && !!v.review[key].trim()));
      refuse(Array.isArray(v.questions) && v.questions.length > 0 && v.questions.length <= 8 && new Set(v.questions.map(q => q.id)).size === v.questions.length);
      for (const question of v.questions) refuse(typeof question.text === 'string' && Array.isArray(question.options) && question.options.length > 0 && question.options.every(o => typeof o === 'string'));
      forms.set(q.id + ':' + v.version, v);
    }
  }
  for (const row of rows.filter(r => r.kind === 'self-id-response')) {
    const r = get(row.kind, row.id), app = reference('application', r.application), q = reference('self-id-questionnaire', r.questionnaire);
    refuse(r.vacancy === app.vacancy && q.vacancy === app.vacancy && r.id === app.id + ':' + q.id && Array.isArray(r.versions) && r.versions.length > 0);
    refuse(!reference('candidate', app.candidate).deleted);
    refuse(typeof r.originalIntakePath === 'string' && !!r.originalIntakePath && (!app.intakePath || r.originalIntakePath === app.intakePath));
    for (const v of r.versions) {
      const form = forms.get(q.id + ':' + v.formVersion);
      refuse(!!form && v.questionnaire === q.id && v.language === q.language && v.language === (app.language ?? 'en') && v.noticeVersion === form.noticeVersion);
      refuse(v.form?.id === q.id && Object.entries(form).filter(([key]) => !['reviewedBy', 'reviewedAt'].includes(key)).every(([key, value]) => JSON.stringify(value) === JSON.stringify(v.form[key])));
      refuse(typeof v.intakePath === 'string' && !!v.intakePath && typeof v.consent === 'boolean' && Number.isFinite(Date.parse(v.at)) && Number.isFinite(Date.parse(v.retainUntil)));
      refuse(Array.isArray(v.answers) && v.answers.length === form.questions.length);
      for (const [i, answer] of v.answers.entries()) {
        refuse(answer.question === form.questions[i].id && ['answered', 'declined', 'unanswered'].includes(answer.state));
        refuse(answer.state === 'answered' ? form.questions[i].options.includes(answer.answer) : answer.answer === undefined);
      }
      const state = v.answers.some(a => a.state === 'answered') ? 'answered' : v.answers.some(a => a.state === 'declined') ? 'declined' : 'unanswered';
      refuse(v.state === state && (state === 'unanswered' || v.consent));
    }
  }
}
