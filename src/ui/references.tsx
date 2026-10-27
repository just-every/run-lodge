import type { PageProps } from './app'
import { Check, Field, Form, memberOptions, type D } from './shared'

/** Phone reference recording stays beside the application and never advances it. */
export function References({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  const view = w.references
  const editable = view?.editable.includes(app.id)
  const questionnaire = view?.questionnaires.find((q: D) => q.application === app.id)
  const config = questionnaire ?? view?.configurations.find((q: D) => q.application === app.id)
  const current = config?.versions.at(-1)
  const tasks = (view?.tasks ?? []).filter((t: D) => t.application === app.id)
  if (!editable && !questionnaire) return null
  return <section aria-label="Phone references">
    <h3>Phone references</h3>
    <p>Manually recorded calls. Lodge does not contact referees or verify consent. References never change the application stage.</p>
    {editable && app.status === 'active' && <>
      <details><summary>Questionnaire and readers</summary>
        <Form key={current?.version ?? 0} label="Save reference questionnaire" onSubmit={x => mutate('reference-questionnaire', { application: app.id, version: current?.version ?? 0, questions: x.questions.split('\n').map((q: string) => q.trim()).filter(Boolean), roles: ['owner', 'admin', 'manager', 'interviewer'].filter(role => x[role]) })}>
          <Field label="Reference questions, one per line" name="questions" type="textarea" defaultValue={current?.questions.map((q: D) => q.text).join('\n') ?? ''} />
          <p>Readers also need current application access and contact permission.</p>
          {['owner', 'admin', 'manager', 'interviewer'].map(role => <Check key={role} label={'Allow ' + role + ' readers'} name={role} defaultChecked={current ? current.roles.includes(role) : role !== 'interviewer'} />)}
        </Form>
      </details>
      {questionnaire && <details><summary>New call task</summary><Form label="Create call-references task" reset onSubmit={x => mutate('task', { application: app.id, kind: 'task', purpose: 'call-references', note: x.note, due: x.due, owner: x.owner })}>
        <Field label="Call task note" name="note" />
        <Field label="Call due date" name="due" type="date" />
        <Field label="Assigned caller" name="owner" options={memberOptions(w.members)} defaultValue={w.actor.email} />
      </Form></details>}
    </>}
    {questionnaire && <>
      <p>Questionnaire version {current.version}</p>
      {tasks.map((task: D) => {
        const record = view.records.find((r: D) => r.task === task.id), latest = record?.versions.at(-1)
        return <section key={task.id} aria-label={'Reference call: ' + task.note}>
          <h4>{task.note}</h4><p>{task.status} · {task.owner}</p>
          {task.owner === w.actor.email && task.status !== 'cancelled' && app.status === 'active' && <details><summary>{latest ? 'Record corrected answers' : 'Record call answers'}</summary>
            <Form key={(record?.versions.length ?? 0) + ':' + current.version} label="Save manually recorded answers" onSubmit={x => mutate('reference-record', { task: task.id, version: record?.versions.length ?? 0, questionnaireVersion: current.version, refereeName: x.refereeName, relationship: x.relationship, source: x.source, consent: x.consent, consentConfirmed: x.consentConfirmed, answers: Object.fromEntries(current.questions.map((q: D) => [q.id, x[q.id]])) })}>
              <Field label="Referee name" name="refereeName" defaultValue={latest?.referee.name} />
              <Field label="Referee relationship" name="relationship" defaultValue={latest?.referee.relationship} />
              <Field label="Call source evidence" name="source" type="textarea" defaultValue={latest?.source} />
              <Field label="Recorded consent evidence" name="consent" type="textarea" defaultValue={latest?.consent} />
              <Check label="I recorded the referee's consent to this reference" name="consentConfirmed" />
              {current.questions.map((q: D) => <Field key={q.id} label={q.text} name={q.id} type="textarea" />)}
            </Form>
          </details>}
          {record?.versions.map((version: D) => <details key={version.version} open={version.version === record.versions.length}><summary>Manually recorded · answer version {version.version}</summary>
            <p>{version.referee.name} · {version.referee.relationship}</p><p>Questionnaire version {version.questionnaireVersion} · {version.by} · {version.at}</p>
            <p>Source: {version.source}</p><p>Consent recorded: {version.consent}</p>
            <dl>{version.answers.map((answer: D) => <div key={answer.question}><dt>{answer.text}</dt><dd>{answer.answer}</dd></div>)}</dl>
          </details>)}
        </section>
      })}
      <details><summary>Earlier questionnaires</summary>{questionnaire.versions.map((q: D) => <section key={q.version}><h4>Version {q.version}</h4><p>{q.by} · {q.at} · readers: {q.roles.join(', ')}</p><ul>{q.questions.map((question: D) => <li key={question.id}>{question.text}</li>)}</ul></section>)}</details>
      {w.vacancies.find((v: D) => v.id === app.vacancy)?.permissions.includes('export') && <p><a href={'/api/lodge/download/references/' + app.id}>Export authorized references</a></p>}
    </>}
  </section>
}
