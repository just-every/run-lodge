import { clock, dayLabel, slot, weekday } from '../format'
import { Icon } from '../icons'
import { count, person, people, phrase, recordName } from '../names'
import type { D } from '../shared'
import { openProposals, proposalApplication } from './facts'

const SHOWN = 5

/** One line of the job's history: what happened, the words or record behind it, and its dot. Red is only for what waits on you. */
interface Entry { id: string; at: string; tone: 'red' | 'amber' | 'sky' | 'grey'; title: string; detail?: string; offer?: { by: string; app?: string; ps: D[] } }

// What applying a proposal writes in the same moment; it reads as part of that one entry.
const EFFECTS = ['message-drafted', 'interview-proposed', 'interview-scheduled', 'interview-cancelled', 'stage-moved', 'proposal-rejected']
const together = (x: D, y: D) => x.email === y.email && Math.abs(Date.parse(x.at) - Date.parse(y.at)) < 120000

/**
 * The job's audit rows as a story: a panellist's reply in their own words, an agent's options for one candidate
 * as one entry (red while they wait on you), a person applying one with what it wrote, and every other change by name.
 */
function story(w: D, rows: D[]): Entry[] {
  const waiting = new Set(openProposals(w).map((p: D) => p.id))
  const proposal = (e: D) => w.proposals.find((x: D) => 'proposal:' + x.id === e.record)
  const applied = rows.filter(e => e.action === 'proposal-applied')
  const entries: Entry[] = []
  for (const e of rows) {
    const id = e.record.slice(e.record.indexOf(':') + 1)
    if (EFFECTS.includes(e.action) && applied.some(x => together(x, e))) continue
    if (e.action === 'proposal-created') {
      const p = proposal(e), app = p && proposalApplication(p), last = entries.at(-1)
      // Options an agent offered for one candidate within a few minutes read as one entry.
      if (p && last?.offer && last.offer.app === app && last.offer.by === e.email && Math.abs(Date.parse(last.at) - Date.parse(e.at)) < 600000) { last.offer.ps.push(p); continue }
      entries.push({ id: e.id, at: e.at, tone: 'grey', title: '', offer: { by: e.email, app, ps: p ? [p] : [] } })
      continue
    }
    if (e.action === 'proposal-applied') {
      const p = proposal(e), declined = rows.filter(x => x.action === 'proposal-rejected' && together(x, e)).length
      entries.push({ id: e.id, at: e.at, tone: 'sky', title: `${person(w, e.email)} applied: ${p?.summary ?? 'an agent’s proposal'}`, detail: declined ? `Declined the other ${count(declined, 'option')}` : undefined })
      continue
    }
    if (e.action === 'interview-reply') {
      const iv = w.interviews.find((x: D) => x.id === id), what = iv ? `${iv.title.split(':')[0]} on ${weekday(iv.start ?? iv.slots[0])}` : 'an interview'
      entries.push(e.answer === 'cannot-attend'
        ? { id: e.id, at: e.at, tone: 'amber', title: `${person(w, e.email)} cannot attend ${what}`, detail: e.note && `“${e.note}”` }
        : { id: e.id, at: e.at, tone: 'sky', title: `${person(w, e.email)} can cover ${e.freeAt ? `${iv?.title.split(':')[0] ?? 'it'}, free ${slot(e.freeAt)}` : what}`, detail: e.note && `“${e.note}”` })
      continue
    }
    entries.push({ id: e.id, at: e.at, tone: ['stage-moved', 'interview-scheduled'].includes(e.action) ? 'sky' : 'grey', title: `${person(w, e.email) || 'Applicant'} · ${phrase(e.action)}`, detail: recordName(w, e.record) })
  }
  // Word each agent entry once its options are gathered: what it offered, and where they stand now.
  for (const entry of entries) {
    if (!entry.offer) continue
    const { by, app, ps } = entry.offer, open = ps.filter(p => waiting.has(p.id)), chosen = ps.find(p => p.status === 'applied')
    const name = w.applications.find((a: D) => a.id === app)?.candidateName
    entry.title = ps.length > 1 ? `${person(w, by)} proposed ${count(ps.length, 'option')} for ${name}` : `${person(w, by)} proposed: ${ps[0]?.summary ?? 'a change'}`
    entry.detail = open.length ? 'Waiting for your decision' : chosen ? `${person(w, chosen.decidedBy)} chose ${ps.length > 1 ? chosen.summary : 'it'}` : 'Declined'
    entry.tone = open.length ? 'red' : 'grey'
  }
  return entries
}

/** Under the board: the job's recent history (owner and hiring admins) by day, and the coordination facts to chase. */
export function Activity({ v, apps, w, open }: { v: D; apps: D[]; w: D; open: (id: string) => void }) {
  const ids = new Set(apps.map(a => a.id))
  const records = new Set<string>(['vacancy:' + v.id, ...apps.map(a => 'application:' + a.id),
    ...w.interviews.filter((i: D) => ids.has(i.application)).map((i: D) => 'interview:' + i.id),
    ...w.offers.filter((o: D) => ids.has(o.application)).map((o: D) => 'offer:' + o.id),
    ...w.messages.filter((m: D) => ids.has(m.application)).map((m: D) => 'message:' + m.id),
    ...w.proposals.filter((p: D) => ids.has(proposalApplication(p) ?? '')).map((p: D) => 'proposal:' + p.id)])
  const history = story(w, w.audit.filter((e: D) => records.has(e.record))).slice(0, SHOWN)
  const days = [...new Set(history.map(e => dayLabel(e.at)))]
  const name = (id: string) => apps.find(a => a.id === id)?.candidateName
  const missing = new Map<string, D[]>()
  for (const m of w.coordination.missingScorecards.filter((m: D) => ids.has(m.application))) missing.set(m.application, [...(missing.get(m.application) ?? []), m])
  const awaiting = w.coordination.awaitingTimes.filter((t: D) => ids.has(t.application))
  if (!history.length && !missing.size && !awaiting.length) return null
  return <section className="activity">
    {history.length > 0 && <div className="recent">
      <h2>Recent activity{days.length === 1 && <small>{days[0]}</small>}</h2>
      {days.map(d => <div key={d} className="day">
        {days.length > 1 && <h3>{d}</h3>}
        <ol className="timeline">{history.filter(e => dayLabel(e.at) === d).map(e => <li key={e.id} className={e.tone}><time dateTime={e.at}>{clock(e.at)}</time>
          <p><span>{e.title}</span>{e.detail && <span className="muted">{e.detail}</span>}</p></li>)}</ol>
      </div>)}
    </div>}
    <div className="chase">
      <h2>Coordination</h2>
      {!missing.size && !awaiting.length ? <p className="empty">Nothing to chase for this job.</p> : <ul>
        {[...missing].map(([app, list]) => <li key={app}><Icon name="clock" /><p><strong>{name(app)}: {count(list.length, 'scorecard')} not submitted</strong><span>{people(w, list.map(m => m.interviewer))} · {list[0].title.split(':')[0]} on {weekday(list[0].since)}</span></p><button onClick={() => open(app)}>Open</button></li>)}
        {awaiting.map((t: D) => <li key={t.interview}><Icon name="calendar" /><p><strong>{name(t.application)}: times proposed</strong><span>{t.responded.length} of {t.best[0]?.of ?? t.responded.length} on the panel and the candidate have answered</span></p><button onClick={() => open(t.application)}>Open</button></li>)}
      </ul>}
    </div>
  </section>
}
