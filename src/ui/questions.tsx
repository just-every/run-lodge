import type { PageProps } from './app'
import { Check, Field, Form, Status, type D } from './shared'

const TYPES: D = { 'yes-no': 'Yes or no', 'single-choice': 'One choice', 'multiple-choice': 'Several choices', number: 'Number', date: 'Date', file: 'File', 'short-text': 'Short text', 'long-text': 'Long text' }
const current = (q: D) => q.versions.at(-1)

/** SCREEN-001 on a job: the attached screening questions, and for admins the library they come from. */
export function JobQuestions({ v, w, mutate }: { v: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const library: D[] = w.questions ?? []
  if (!library.length && !(w.actor.owner || w.actor.roles.includes('admin'))) return null
  const attached: D[] = v.questions ?? []
  const admin = w.actor.owner || w.actor.roles.includes('admin')
  const live = v.status !== 'closed' && !v.imported
  return <section className="screening" aria-label="Screening questions">
    <h3>Screening questions</h3>
    {attached.length ? <ul>{attached.map(x => { const q = library.find(l => l.id === x.question); return q && <li key={x.question}>{current(q).text} · {TYPES[current(q).type]} · {x.required ? 'required' : 'optional'} · version {q.versions.length}</li> })}</ul> : <p className="empty">Applicants answer no screening questions on this job.</p>}
    {live && library.length > 0 && <details><summary>Choose this job’s questions</summary>
      <Form label="Save screening questions" onSubmit={x => mutate('job-questions', { id: v.id, questions: library.filter(q => x['use-' + q.id]).map(q => ({ question: q.id, required: x['must-' + q.id] === true })) })}>
        {library.map(q => <fieldset key={q.id} className="wide"><legend>{current(q).text}</legend>
          <Check label="Ask on this job" name={'use-' + q.id} defaultChecked={attached.some(a => a.question === q.id)} />
          <Check label="Applicants must answer" name={'must-' + q.id} defaultChecked={attached.find(a => a.question === q.id)?.required ?? current(q).required} />
        </fieldset>)}
      </Form></details>}
    {admin && <details><summary>Question library ({library.length})</summary>
      <p className="hint">Each edit saves a new version; applications keep the version they answered. Lodge refuses questions about protected traits and salary history.</p>
      {library.map(q => <details key={q.id}><summary>{current(q).text} <Status>{`version ${q.versions.length}`}</Status></summary><QuestionForm q={q} mutate={mutate} /></details>)}
      <h4>New question</h4><QuestionForm mutate={mutate} />
    </details>}
  </section>
}

function QuestionForm({ q, mutate }: { q?: D; mutate: PageProps['mutate'] }) {
  const now = q && current(q)
  return <Form label={q ? 'Save a new version' : 'Add to the library'} reset={!q} onSubmit={x => mutate('question', { id: q?.id, text: x.text, type: x.type, required: x.required === true, help: x.help, options: String(x.options ?? '').split('\n').map(o => o.trim()).filter(Boolean) })}>
    <Field label="Question text" name="text" wide defaultValue={now?.text} />
    <Field label="Answer type" name="type" defaultValue={now?.type ?? 'yes-no'} options={Object.entries(TYPES).map(([value, label]) => ({ value, label: label as string }))} />
    <Field label="Choices, each on its own line (choice types only)" name="options" type="textarea" required={false} defaultValue={(now?.options ?? []).join('\n')} />
    <Field label="Help for applicants" name="help" required={false} defaultValue={now?.help} />
    <Check label="Required by default" name="required" defaultChecked={now?.required ?? true} />
  </Form>
}

/** The applicant's answers, each on the question version they answered. */
export function Answers({ app }: { app: D }) {
  if (!app.answers?.length) return null
  const shown = (x: D) => x.type === 'yes-no' ? (x.value === 'yes' ? 'Yes' : 'No') : x.type === 'file' ? <a href={`/api/lodge/download/document/${x.value.document}`}>{x.value.name}</a> : Array.isArray(x.value) ? x.value.join(', ') : String(x.value)
  return <details open><summary>Screening answers</summary><dl className="terms">{app.answers.map((x: D) => <div key={x.question}><dt>{x.language ? <span lang={x.language}>{x.text}</span> : x.text}{x.sourceText && <><br /><small lang="en">Source: {x.sourceText}</small></>} <span className="muted">(version {x.version})</span></dt><dd>{shown(x)}</dd></div>)}</dl></details>
}
