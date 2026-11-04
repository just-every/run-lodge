import { useState } from 'react'
import type { PageProps } from './app'
import { Check, Field, Form, type D } from './shared'

/** Configuration uses existing Settings controls; restricted response reading stays in the compliance door. */
export function SelfIdentificationSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const jobs = w.vacancies.filter((v: D) => v.manages && v.permissions.includes('settings') && !v.imported && v.status !== 'closed')
  const [selected, select] = useState(''), [kind, setKind] = useState('eeo'), [language, setLanguage] = useState('en')
  if (w.actor.agent || !(w.actor.owner || w.actor.roles.includes('admin'))) return null
  const job = jobs.find((v: D) => v.id === selected) ?? jobs[0]
  const configuration = w.selfIdentification.configurations.find((q: D) => q.vacancy === job?.id && q.kind === kind && q.language === language)
  const current = configuration?.versions.at(-1)
  return <section className="card" aria-label="Voluntary self-identification settings"><h2>Voluntary self-identification</h2>
    <p>Optional employer-authored US questionnaires, kept separately from selection. Your legal adviser reviews applicability, content, language and retention. Lodge does not certify compliance or file reports.</p>
    <p><a href="/enterprise/compliance">Open restricted compliance records</a></p>
    {job ? <>
      <label>Questionnaire job<select value={job.id} onChange={e => select(e.target.value)}>{jobs.map((j: D) => <option key={j.id} value={j.id}>{j.title}</option>)}</select></label>
      <label>Questionnaire kind<select value={kind} onChange={e => setKind(e.target.value)}><option value="eeo">US EEO</option><option value="disability">OFCCP disability</option><option value="veteran">OFCCP veteran</option></select></label>
      <label>Questionnaire language<input value={language} onChange={e => setLanguage(e.target.value)} /></label>
      <p>{current ? `Version ${current.version} · ${configuration.enabled ? 'Available' : 'Disabled'}` : 'No reviewed questionnaire in this language. Applications remain available without it.'}</p>
      <Form key={job.id + kind + language + (current?.version ?? 0)} label="Save reviewed questionnaire" onSubmit={x => mutate('self-identification-questionnaire', {
        vacancy: job.id, kind, language, version: current?.version ?? 0, ...x,
        retentionDays: Number(x.retentionDays),
        questions: x.questions.split('\n').filter((line: string) => line.trim()).map((line: string) => { const [text, ...options] = line.split('|').map((part: string) => part.trim()); return { text, options } }),
        review: Object.fromEntries(['legal', 'applicability', 'notice', 'language', 'retention'].map(key => [key, x['review-' + key]])),
      })}>
        <Field label="Questionnaire title" name="title" defaultValue={current?.title} />
        <Field label="Voluntary notice" name="notice" type="textarea" defaultValue={current?.notice} />
        <Field label="Questions: one per line, choices separated by |" name="questions" type="textarea" defaultValue={current?.questions.map((q: D) => [q.text, ...q.options].join(' | ')).join('\n')} />
        <Field label="Answer label" name="answerLabel" defaultValue={current?.answerLabel} />
        <Field label="Unanswered choice label" name="unansweredLabel" defaultValue={current?.unansweredLabel} />
        <Field label="Explicit decline label" name="declineLabel" defaultValue={current?.declineLabel} />
        <Field label="Voluntary consent label" name="consentLabel" defaultValue={current?.consentLabel} />
        <Field label="Reviewed retention days" name="retentionDays" type="number" defaultValue={current?.retentionDays} />
        {['legal', 'applicability', 'notice', 'language', 'retention'].map(key => <Field key={key} label={key[0].toUpperCase() + key.slice(1) + ' review evidence'} name={'review-' + key} type="textarea" />)}
        <Check label="I confirm review of this exact questionnaire and notice" name="reviewed" />
      </Form>
      {configuration?.enabled && <button type="button" onClick={() => mutate('self-identification-questionnaire', { vacancy: job.id, kind, language, version: current.version, enabled: false })}>Disable questionnaire</button>}
      {configuration && <details><summary>Review history</summary>{configuration.versions.map((v: D) => <article key={v.version}><h3>Version {v.version} · notice {v.noticeVersion}</h3><p>{v.title} · {v.reviewedAt} · retention {v.retentionDays} days</p><p className="pre">{v.notice}</p><dl>{Object.entries(v.review).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></article>)}</details>}
    </> : <p>Create a native job before reviewing a questionnaire.</p>}
  </section>
}
