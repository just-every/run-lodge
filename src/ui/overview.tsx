import type { PageProps } from './app'
import { daysSince, recent, since, weekday } from './format'
import { Icon, type IconName } from './icons'
import { count, person } from './names'
import { Avatar, Status, type D } from './shared'
import { BusinessForm } from './people'
import { columns, openProposals, proposalApplication } from './pipeline/facts'
import { Tasks } from './tasks'

/** Each application waiting on the actor's scorecard: the interview it is for (or the screen), when, and how late. */
function scorecardsToWrite(w: D): { a: D; job?: string; what: string; at: string; late: number }[] {
  const me = w.actor.email
  const mine = w.interviews.filter((i: D) => i.participants.includes(me) && i.status !== 'cancelled')
  return w.applications.filter((a: D) => a.status === 'active' && (a.reviewers.includes(me) || mine.some((i: D) => i.application === a.id)) && !w.scorecards.some((c: D) => c.application === a.id && c.author === me && c.status === 'submitted'))
    .map((a: D) => {
      const iv = mine.filter((i: D) => i.application === a.id && i.status === 'scheduled' && Date.parse(i.start) < Date.now()).sort((x: D, y: D) => y.start.localeCompare(x.start))[0]
      const job = w.vacancies.find((v: D) => v.id === a.vacancy)?.title
      return { a, job, what: iv ? iv.title.split(':')[0] : 'Screen review', at: iv?.start ?? a.submittedAt, late: iv ? daysSince(iv.start) : 0 }
    })
    .sort((x: D, y: D) => y.late - x.late || y.at.localeCompare(x.at))
}

export function Overview({ w, mutate, go }: PageProps) {
  const { actor } = w
  if (!w.business) {
    return actor.owner
      ? <div className="page narrow"><h1>Welcome to Lodge</h1><p className="lead">Start with your business, the time zone it works in, the privacy notice applicants will read and who to contact for adjustments. Then add your hiring team and your first vacancy.</p><BusinessForm w={w} mutate={mutate} /></div>
      : <div className="page narrow"><h1>Lodge is not set up yet</h1><p className="lead">The owner has not finished setting up this business.</p></div>
  }
  if (!actor.owner && !actor.roles.length) return <div className="page narrow"><h1>No Lodge role yet</h1><p className="lead">You are signed in as {actor.email}. Ask the owner or a hiring admin to add you under People with the role you need.</p></div>
  const toScore = scorecardsToWrite(w)
  const pending = w.approvals.filter((x: D) => x.status === 'pending'), mine = pending.filter((x: D) => x.approver === actor.email)
  const open = w.vacancies.filter((v: D) => v.status === 'open')
  const decisions = [...new Set(openProposals(w).map(proposalApplication).filter(Boolean))] as string[]
  const steps = [
    { done: w.members.length > 1, label: 'Add your hiring team', tab: 'People' },
    { done: w.vacancies.some((v: D) => !v.imported), label: 'Create a vacancy with its pay range and headcount', tab: 'Vacancies' },
    { done: w.vacancies.some((v: D) => v.rubrics?.length), label: 'Agree stages, rubric and interview plan', tab: 'Vacancies' },
    { done: open.length > 0, label: 'Get approval and publish the application page', tab: 'Vacancies' },
  ]
  const others = [...new Set(pending.filter((x: D) => x.approver !== actor.email).map((x: D) => person(w, x.approver)))]
  const tiles: [string, number, IconName, string][] = [
    ['Open vacancies', open.length, 'vacancies', count(w.vacancies.filter((v: D) => v.status === 'draft' && !v.imported).length, 'draft')],
    ['Active applications', w.applications.filter((a: D) => a.status === 'active').length, 'applications', count(w.applications.filter((a: D) => a.status === 'active' && daysSince(a.submittedAt) < 7).length, 'new this week', 'new this week')],
    ['Approvals pending', pending.length, 'approvals', mine.length ? `${mine.length} with you` : others.length ? `with ${others.join(', ')}` : 'none waiting'],
    ['Scorecards to write', toScore.length, 'clock', count(toScore.filter(x => x.late > 0).length, 'overdue', 'overdue')],
  ]
  const retention = w.retention?.due.length ?? 0
  return <div className="page wide">
    <h1>{w.business.name}</h1>
    {steps.some(s => !s.done) && (actor.owner || actor.roles.includes('admin')) && <section className="card"><h2>Getting started</h2><ol className="steps">{steps.map(s => <li key={s.label} className={s.done ? 'done' : ''}>{s.done && <span className="visually-hidden">Done: </span>}<button className="link" onClick={() => go(s.tab)}>{s.label}</button></li>)}</ol></section>}
    <section className="metrics">{tiles.map(([label, n, icon, note]) => <article key={label}><span className="metric-icon"><Icon name={icon} /></span><small>{label}</small><strong>{n}</strong><span className="metric-note">{note}</span></article>)}</section>
    {(mine.length > 0 || retention > 0) && <p className="actions">
      {mine.length > 0 && <button className="primary" onClick={() => go('Approvals')}>Review {count(mine.length, 'approval')}</button>}
      {retention > 0 && <button onClick={() => go('Retention')}>{retention === 1 ? '1 candidate record is past its' : `${retention} candidate records are past their`} retention date</button>}
    </p>}
    <div className="pair">
      <div>
        {w.notifications.length > 0 && <section className="card"><h2>For your attention</h2><ul className="list rich">{w.notifications.map((n: D) => <li key={n.id}><button onClick={() => n.application ? go('Applications', { app: n.application, job: undefined }) : undefined}><Icon name="clock" /><span><strong>{n.kind === 'task-due' ? `${n.overdue ? 'Overdue' : 'Due today'}: ${n.reason}` : `${person(w, n.by)} corrected a released scorecard`}</strong><small>{[n.application ? w.applications.find((a: D) => a.id === n.application)?.candidateName : w.candidates.find((c: D) => c.id === n.candidate)?.name, n.kind === 'task-due' ? (n.by !== w.actor.email ? 'set by ' + person(w, n.by) : '') : n.reason, n.kind === 'task-due' ? n.at : recent(n.at)].filter(Boolean).join(' · ')}</small></span></button></li>)}</ul></section>}
        <Tasks w={w} mutate={mutate} go={go} />
        {decisions.length > 0 && <section className="card"><h2>Waiting for your decision</h2><ul className="list rich">{decisions.map(id => {
          const a = w.applications.find((x: D) => x.id === id), ps = openProposals(w).filter((p: D) => proposalApplication(p) === id)
          return a && <li key={id}><button onClick={() => go('Applications', { app: id, job: a.vacancy })}><Avatar name={a.candidateName} size="sm" /><span><strong>{a.candidateName}</strong><small>{count(ps.length, 'option')} from {person(w, ps[0].proposedBy)} · {recent(ps[0].proposedAt)}</small></span><Status tone="alert">your decision</Status></button></li>
        })}</ul></section>}
        {open.length > 0 && <section className="card"><h2>Open jobs</h2><ul className="list rich">{open.map((v: D) => {
          const apps = w.applications.filter((a: D) => a.vacancy === v.id && a.status !== 'spam'), split = columns(v, apps).filter(c => c.id !== 'closed').map(c => c.apps.length)
          return <li key={v.id}><button onClick={() => go('Applications', { job: v.id, app: null })}><span><strong>{v.title}</strong><small>{count(apps.length, 'application')} · by stage {split.join(' · ')}{v.publishedAt ? ` · open ${since(v.publishedAt)}` : ''}</small></span></button></li>
        })}</ul></section>}
        {(w.coordination.missingScorecards.length > 0 || w.coordination.awaitingTimes.length > 0) && <section className="card">
          <h2>Coordination</h2>
          <ul className="list rich">{w.coordination.missingScorecards.map((m: D) => <li key={m.interview + m.interviewer}><button onClick={() => go('Applications', { app: m.application, job: undefined })}><Icon name="clock" /><span><strong>{person(w, m.interviewer)}: scorecard not submitted</strong><small>{m.title.split(':')[0]} with {w.applications.find((a: D) => a.id === m.application)?.candidateName} · {weekday(m.since)} · {daysSince(m.since) ? `${count(daysSince(m.since), 'day')} ago` : 'today'}</small></span></button></li>)}
            {w.coordination.awaitingTimes.map((t: D) => <li key={t.interview}><button onClick={() => go('Applications', { app: t.application, job: undefined })}><Icon name="calendar" /><span><strong>{w.applications.find((a: D) => a.id === t.application)?.candidateName}: times proposed</strong><small>{t.title.split(':')[0]} · {t.responded.length} of {t.best[0]?.of ?? t.responded.length} on the panel and the candidate have answered</small></span></button></li>)}</ul>
        </section>}
      </div>
      {toScore.length > 0 && <section className="card"><h2>Your scorecards to write</h2><ul className="list rich">{toScore.map(({ a, job, what, at, late }) => <li key={a.id}><button onClick={() => go('Applications', { app: a.id, job: a.vacancy })}><Avatar name={a.candidateName} size="sm" /><span><strong>{a.candidateName}</strong><small>{job} · {what} · {weekday(at)}</small></span>{late > 0 ? <Status tone="warn">{count(late, 'day')} overdue</Status> : <Status>to review</Status>}</button></li>)}</ul></section>}
    </div>
  </div>
}
