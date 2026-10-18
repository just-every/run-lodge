import type { PageProps } from './app'
import { when } from './format'
import { Icon, type IconName } from './icons'
import { person } from './names'
import type { D } from './shared'
import { BusinessForm } from './people'

export function Overview({ w, mutate, go }: PageProps) {
  const { actor } = w
  if (!w.business) {
    return actor.owner
      ? <div className="page narrow"><h1>Welcome to Lodge</h1><p className="lead">Start with your business, the privacy notice applicants will read and who to contact for adjustments. Then add your hiring team and your first vacancy.</p><BusinessForm w={w} mutate={mutate} /></div>
      : <div className="page narrow"><h1>Lodge is not set up yet</h1><p className="lead">The owner has not finished setting up this business.</p></div>
  }
  if (!actor.owner && !actor.roles.length) return <div className="page narrow"><h1>No Lodge role yet</h1><p className="lead">You are signed in as {actor.email}. Ask the owner or a hiring admin to add you under People with the role you need.</p></div>
  const mine = w.interviews.filter((i: D) => i.participants.includes(actor.email) && i.status !== 'cancelled')
  const toScore = w.applications.filter((a: D) => a.status === 'active' && (a.reviewers.includes(actor.email) || mine.some((i: D) => i.application === a.id)) && !w.scorecards.some((c: D) => c.application === a.id && c.author === actor.email && c.status === 'submitted'))
  const pending = w.approvals.filter((x: D) => x.status === 'pending' && x.approver === actor.email)
  const open = w.vacancies.filter((v: D) => v.status === 'open')
  const steps = [
    { done: w.members.length > 1, label: 'Add your hiring team', tab: 'People' },
    { done: w.vacancies.some((v: D) => !v.imported), label: 'Create a vacancy with its pay range and headcount', tab: 'Vacancies' },
    { done: w.vacancies.some((v: D) => v.rubrics?.length), label: 'Agree stages, rubric and interview plan', tab: 'Vacancies' },
    { done: open.length > 0, label: 'Get approval and publish the application page', tab: 'Vacancies' },
  ]
  const tiles: [string, number, IconName][] = [
    ['Open vacancies', open.length, 'vacancies'],
    ['Active applications', w.applications.filter((a: D) => a.status === 'active').length, 'applications'],
    ['Waiting for your approval', pending.length, 'approvals'],
    ['Waiting for your scorecard', toScore.length, 'clock'],
  ]
  return <div className="page">
    <h1>{w.business.name}</h1>
    {steps.some(s => !s.done) && (actor.owner || actor.roles.includes('admin')) && <section className="card"><h2>Getting started</h2><ol className="steps">{steps.map(s => <li key={s.label} className={s.done ? 'done' : ''}>{s.done && <span className="visually-hidden">Done: </span>}<button className="link" onClick={() => go(s.tab)}>{s.label}</button></li>)}</ol></section>}
    <section className="metrics">{tiles.map(([label, n, icon]) => <article key={label}><span className="metric-icon"><Icon name={icon} /></span><small>{label}</small><strong>{n}</strong></article>)}</section>
    {(open.length > 0 || toScore.length > 0) && <div className="pair">
      {open.length > 0 && <section className="card"><h2>Application pages</h2><ul className="list">{open.map((v: D) => <li key={v.id}><a href={`/jobs/${v.slug}`}><span>{v.title} <span className="meta">· {w.applications.filter((a: D) => a.vacancy === v.id).length} applications</span></span></a></li>)}</ul></section>}
      {toScore.length > 0 && <section className="card"><h2>Your scorecards to write</h2><ul className="list">{toScore.map((a: D) => <li key={a.id}><button onClick={() => go('Applications', { app: a.id, job: a.vacancy })}>{a.candidateName}</button></li>)}</ul></section>}
    </div>}
    {(pending.length > 0 || w.retention?.due.length > 0) && <p className="actions">
      {pending.length > 0 && <button className="primary" onClick={() => go('Approvals')}>Review {pending.length} approval{pending.length > 1 ? 's' : ''}</button>}
      {w.retention?.due.length > 0 && <button onClick={() => go('Retention')}>{w.retention.due.length} candidate record(s) are past their retention date</button>}
    </p>}
    {(w.coordination.missingScorecards.length > 0 || w.coordination.awaitingTimes.length > 0) && <section className="card">
      <h2>Coordination</h2>
      <ul className="list">{w.coordination.missingScorecards.map((m: D) => <li key={m.interview + m.interviewer}><button onClick={() => go('Applications', { app: m.application, job: undefined })}>{person(w, m.interviewer)} has not submitted a scorecard for {m.title} ({when(m.since)})</button></li>)}
        {w.coordination.awaitingTimes.map((t: D) => <li key={t.interview}><button onClick={() => go('Applications', { app: t.application, job: undefined })}>{t.title}: {t.responded.length} of the panel and candidate have answered</button></li>)}</ul>
    </section>}
  </div>
}
