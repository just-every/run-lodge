import type { PageProps } from './app'
import { Field, Form, fileFrom, readFile, type D } from './shared'
import { times, instantOf } from '../lodge/core/time'
import { person } from './names'

/** Assignment settings use the existing Settings surface; designation grants no access. */
export function TakeHomeSettings({ w, mutate, nav }: PageProps) {
  const app = w.applications.find((a: D) => a.id === nav.app)
  if (!app || !w.takeHomes.editable.includes(app.id)) return null
  const record = w.takeHomes.assignments.find((r: D) => r.application === app.id), v = record?.versions.at(-1)
  const graders = w.members.filter((m: D) => w.takeHomes.graderOptions[app.id]?.includes(m.email)).map((m: D) => ({ value: m.email, label: m.name }))
  return <section className="card" aria-label="Take-home settings"><h2>Take-home settings</h2><p>For {app.candidateName}. Choose two people who already have application and scorecard access. Lodge does not deliver these instructions or send reminders.</p>
    <Form key={app.id + ':' + (v?.version ?? 0)} label="Save take-home assignment" onSubmit={async (x, form) => {
      const file = fileFrom(form, 'attachment')
      return mutate('take-home-assign', { application: app.id, version: v?.version ?? 0, instructions: x.instructions, timeZone: x.zone, deadline: instantOf(x.deadline, x.zone), graders: [x.grader1, x.grader2], ...(file ? { attachment: await readFile(file) } : {}) })
    }}>
      <Field label="Take-home instructions" name="instructions" type="textarea" defaultValue={v?.instructions} wide />
      <Field label="Candidate time zone" name="zone" defaultValue={v?.timeZone ?? 'America/New_York'} />
      <Field label="Deadline in candidate time zone" name="deadline" type="datetime-local" />
      <Field label="First grader" name="grader1" options={graders} defaultValue={v?.graders[0]} />
      <Field label="Second grader" name="grader2" options={graders} defaultValue={v?.graders[1]} />
      <Field label="Optional instruction attachment" name="attachment" type="file" required={false} />
    </Form><p><a href={'/app?application=' + app.id}>Back to application</a></p>
  </section>
}

export function TakeHome({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  const view = w.takeHomes, record = view.assignments.find((r: D) => r.application === app.id), v = record?.versions.at(-1)
  const editable = view.editable.includes(app.id)
  if (!record && !editable) return null
  return <section className="card" aria-label="Take-home assignment"><h3>Take-home assignment</h3>
    {editable && <p><a href={'/app?settings=take-home&application=' + app.id}>Take-home settings</a></p>}
    {!v ? <p>No take-home assigned.</p> : <>
      <p>Version {v.version} · rubric version {v.rubricVersion} · Instructions not delivered</p>
      <p>Deadline: {times(v.timeZone).stamped(v.dueAt)} ({v.timeZone})</p><p className="pre">{v.instructions}</p>
      {v.attachment && w.documents.some((d: D) => d.id === v.attachment) && <p><a href={'/api/lodge/download/document/' + v.attachment}>Download instructions attachment</a></p>}
      {editable && record.receipt && <p><a href={'/candidate/receipts/' + record.receipt + '/take-home/' + record.id}>Private candidate submission page</a> · Requires the candidate's own sign-in.</p>}
      {v.extensions.map((e: D, i: number) => <p key={i}>Extension to {times(v.timeZone).stamped(e.to)}: {e.reason}</p>)}
      {editable && app.status === 'active' && <details><summary>Record an extension</summary><Form label="Extend take-home deadline" onSubmit={x => mutate('take-home-extend', { application: app.id, version: v.version, previousDeadline: v.dueAt, deadline: instantOf(x.deadline, v.timeZone), reason: x.reason })}><Field label="Extended deadline in candidate time zone" name="deadline" type="datetime-local" /><Field label="Extension reason" name="reason" /></Form></details>}
      {record.versions.length > 1 && <details><summary>Earlier assignment versions</summary>{record.versions.slice(0, -1).map((old: D) => <article key={old.version}><h4>Version {old.version}</h4><p className="pre">{old.instructions}</p><p>Deadline {times(old.timeZone).stamped(old.dueAt)}</p></article>)}</details>}
      <TakeHomeFeedback app={app} w={w} record={record} v={v} mutate={mutate} />
      <p><a href={'/api/lodge/download/take-home/' + app.id}>Export authorized take-home records</a></p>
    </>}
  </section>
}

function TakeHomeFeedback({ app, w, record, v, mutate }: D) {
  const submission = w.takeHomes.submissions.find((s: D) => s.assessment === record.id && s.version === v.version)
  const cards = w.takeHomes.grades.filter((g: D) => g.assessment === record.id && g.version === v.version)
  const mine = cards.find((g: D) => g.author === w.actor.email)
  const rubric = w.vacancies.find((j: D) => j.id === app.vacancy)?.rubrics.find((r: D) => r.version === v.rubricVersion)
  return <>
    <h4>{submission ? 'Submission received' : 'Awaiting submission'}</h4>
    {submission && <><p>Received {times(v.timeZone).stamped(submission.receivedAt)}</p>{submission.originalsWithheld && <p>Originals and links are withheld during name-blind review.</p>}{submission.files.map((id: string) => w.documents.some((d: D) => d.id === id) && <p key={id}><a href={'/api/lodge/download/document/' + id}>Download submission file</a></p>)}{submission.link && <p>Recorded link: {submission.link}. Lodge has not fetched this link.</p>}</>}
    <p>{v.released ? 'Take-home feedback released.' : 'Each grader’s scorecard stays private until manager release.'}</p>
    {cards.map((g: D) => <article key={g.id} className="card"><h4>{person(w, g.author)} · {g.recommendation}</h4><p>{g.takeaways}</p><ul>{rubric?.criteria.map((c: D) => <li key={c.id}>{c.name}: {g.ratings[c.id] ?? 'Not rated'} · {g.evidence[c.id]}</li>)}</ul></article>)}
    {submission && !mine && v.graders.includes(w.actor.email) && app.status === 'active' && rubric && <details><summary>Write your take-home scorecard</summary><Form label="Submit take-home scorecard" onSubmit={x => mutate('take-home-grade', { application: app.id, version: v.version, rubricVersion: v.rubricVersion, ratings: Object.fromEntries(rubric.criteria.map((c: D) => [c.id, x['rating-' + c.id] || null])), evidence: Object.fromEntries(rubric.criteria.map((c: D) => [c.id, x['evidence-' + c.id]])), recommendation: x.recommendation, takeaways: x.takeaways })}>
      {rubric.criteria.map((c: D) => <fieldset key={c.id} className="wide"><legend>{c.name}</legend><Field label={'Rating for ' + c.name} name={'rating-' + c.id} required={false} options={['1','2','3','4'].map(n => ({ value: n, label: n }))} /><Field label={'Evidence for ' + c.name} name={'evidence-' + c.id} type="textarea" required={false} /></fieldset>)}
      <Field label="Take-home recommendation" name="recommendation" options={['strong-no','no','yes','strong-yes'].map(value => ({ value, label: value }))} /><Field label="Take-home key take-aways" name="takeaways" type="textarea" />
    </Form></details>}
    {app.manages && !v.released && <Form label="Release take-home feedback" onSubmit={x => mutate('take-home-release', { application: app.id, version: v.version, reason: x.reason })}><Field label="Reason if releasing before both graders submit" name="reason" required={false} /></Form>}
  </>
}
