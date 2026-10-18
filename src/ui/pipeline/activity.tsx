import { recent, weekday } from '../format'
import { Icon } from '../icons'
import { person, people, phrase, recordName } from '../names'
import type { D } from '../shared'
import { proposalApplication } from './facts'

const TONE: D = { 'proposal-created': 'red', 'proposal-applied': 'sky', 'stage-moved': 'sky', 'application-received': 'grey' }

/** Under the board: the job's recent history (owner and hiring admins) and the coordination facts to chase. */
export function Activity({ v, apps, w, open }: { v: D; apps: D[]; w: D; open: (id: string) => void }) {
  const ids = new Set(apps.map(a => a.id))
  const records = new Set<string>(['vacancy:' + v.id, ...apps.map(a => 'application:' + a.id),
    ...w.interviews.filter((i: D) => ids.has(i.application)).map((i: D) => 'interview:' + i.id),
    ...w.offers.filter((o: D) => ids.has(o.application)).map((o: D) => 'offer:' + o.id),
    ...w.messages.filter((m: D) => ids.has(m.application)).map((m: D) => 'message:' + m.id),
    ...w.proposals.filter((p: D) => ids.has(proposalApplication(p) ?? '')).map((p: D) => 'proposal:' + p.id)])
  const history = w.audit.filter((e: D) => records.has(e.record)).slice(0, 5)
  const name = (id: string) => apps.find(a => a.id === id)?.candidateName
  const missing = new Map<string, D[]>()
  for (const m of w.coordination.missingScorecards.filter((m: D) => ids.has(m.application))) missing.set(m.application, [...(missing.get(m.application) ?? []), m])
  const awaiting = w.coordination.awaitingTimes.filter((t: D) => ids.has(t.application))
  if (!history.length && !missing.size && !awaiting.length) return null
  return <section className="activity">
    {history.length > 0 && <div className="recent">
      <h2>Recent activity</h2>
      <ol className="timeline">{history.map((e: D) => <li key={e.id} className={TONE[e.action] ?? 'grey'}><time dateTime={e.at}>{recent(e.at)}</time>
        <p><span>{person(w, e.email) || 'Applicant'} · {phrase(e.action)}</span><span className="muted">{recordName(w, e.record)}</span></p></li>)}</ol>
    </div>}
    <div className="chase">
      <h2>Coordination</h2>
      {!missing.size && !awaiting.length ? <p className="empty">Nothing to chase for this job.</p> : <ul>
        {[...missing].map(([app, list]) => <li key={app}><Icon name="clock" /><p><strong>{name(app)}: {list.length === 1 ? '1 scorecard' : `${list.length} scorecards`} not submitted</strong><span>{people(w, list.map(m => m.interviewer))} · {list[0].title.split(':')[0]} on {weekday(list[0].since)}</span></p><button onClick={() => open(app)}>Open</button></li>)}
        {awaiting.map((t: D) => <li key={t.interview}><Icon name="calendar" /><p><strong>{name(t.application)}: times proposed</strong><span>{t.responded.length} of {t.best[0]?.of ?? t.responded.length} on the panel and the candidate have answered</span></p><button onClick={() => open(t.application)}>Open</button></li>)}
      </ul>}
    </div>
  </section>
}
