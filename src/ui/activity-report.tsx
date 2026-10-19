import type { PageProps } from './app'
import { person } from './names'
import { when } from './format'
import { Status, Table, type D } from './shared'

const CALLS = ['strong-yes', 'yes', 'no', 'strong-no'], SHORT: D = { 'strong-yes': 'SY', yes: 'Y', no: 'N', 'strong-no': 'SN' }

/** For admins and hiring managers: who interviewed, how promptly they scored, and what still waits; never a candidate score. */
export function InterviewerActivity({ w, go }: Pick<PageProps, 'w' | 'go'>) {
  const report = w.interviewerActivity
  if (!report?.rows.length) return null
  const waiting = report.rows.flatMap((r: D) => r.items.filter((i: D) => i.status === 'missing').map((i: D) => ({ ...i, interviewer: r.interviewer })))
  return <section className="card"><h2>Interviewer activity</h2><p className="hint">Scorecards fall due {report.dueHours} hours after an interview ends. Recommendations count only released feedback.</p>
    <Table heads={['Interviewer', 'Job', 'Held', 'On time', 'Late', 'Missing', 'Avg hours', 'Upcoming', 'Released calls']}>{report.rows.map((r: D) => <tr key={r.interviewer + r.vacancy}>
      <td>{person(w, r.interviewer)}</td><td>{r.title}</td><td>{r.conducted}</td><td>{r.onTime}</td><td>{r.late}</td><td>{r.missing ? <Status tone="warn">{r.missing}</Status> : 0}</td>
      <td>{r.averageHoursToSubmit ?? '—'}</td><td>{r.upcoming}</td><td>{CALLS.map(c => `${SHORT[c]} ${r.releasedRecommendations[c]}`).join(' · ')}</td></tr>)}</Table>
    {waiting.length > 0 && <><h3>Missing scorecards</h3><ul className="list rich">{waiting.map((i: D) => <li key={i.interview + i.interviewer}><button onClick={() => go('Applications', { app: i.application, job: undefined })}><span><strong>{person(w, i.interviewer)} · {i.title.split(':')[0]}</strong><small>{i.candidateName} · held {when(i.start)} · due {when(i.dueAt)}</small></span></button></li>)}</ul></>}
  </section>
}
