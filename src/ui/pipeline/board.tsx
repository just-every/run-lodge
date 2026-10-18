import { useState } from 'react'
import { amount, day, since, slot, weekday } from '../format'
import { Icon } from '../icons'
import { person } from '../names'
import { Avatar, type D } from '../shared'
import { closedLabel, columns, isNew, lastMove, nextInterview, openProposals } from './facts'

const SHOWN = 4

/** One application as a compact card, each fact on one line: who, where from and how long in this stage, the next
 *  interview (the column already names the stage), and its panel's scorecards. */
function Card({ app, w, selected, waiting, open }: { app: D; w: D; selected: boolean; waiting: boolean; open: (id: string) => void }) {
  const iv = app.status === 'active' ? nextInterview(w, app) : undefined
  const offer = w.offers.find((o: D) => o.application === app.id && o.status === 'draft')
  const done = app.panel?.filter((p: D) => p.submitted).length ?? 0
  return <button className={selected ? 'cand selected' : 'cand'} aria-label={'Open ' + app.candidateName} aria-pressed={selected} onClick={() => open(app.id)}>
    <span className="cand-who"><Avatar name={app.candidateName} size="sm" /><strong title={app.candidateName}>{app.candidateName}</strong></span>
    <small className="cand-meta">{app.source && <>{app.source} · </>}{since(lastMove(app))}</small>
    {app.status !== 'active' && <span className="cand-line muted" title={app.history.at(-1)?.reason}>{[app.status === 'rejected' ? '' : closedLabel(app), app.history.at(-1)?.reason].filter(Boolean).join(' · ') || closedLabel(app)}</span>}
    {offer && <span className="cand-facts"><span><Icon name="dollar" size={15} />{amount(offer.salary.amount, offer.salary.currency)}</span><span><Icon name="calendar" size={15} />Starts {day(offer.startDate).replace(/, \d{4}$/, '')}</span>
      <span><Icon name="clock" size={15} />{offer.approvedNow ? 'Approved' : offer.approval?.status === 'pending' ? `Awaiting ${person(w, offer.approval.approver)}’s approval` : 'Draft'}</span></span>}
    {iv && !offer && <span className="cand-line"><Icon name="calendar" size={15} /><span>{iv.status === 'scheduled' ? slot(iv.start) : `Proposed: ${weekday(iv.slots[0])}`}</span></span>}
    {waiting && <span className="cand-flag">Needs your decision</span>}
    {app.likelySpam && <span className="cand-flag">Likely spam: review</span>}
    {app.panel?.length > 0 && <span className="bar"><span className="track"><i style={{ width: `${done / app.panel.length * 100}%` }} /></span>{done} of {app.panel.length}<span className="visually-hidden"> scorecards</span></span>}
  </button>
}

export function Board({ v, apps, w, selected, open }: { v: D; apps: D[]; w: D; selected?: string; open: (id: string) => void }) {
  const [expanded, setExpanded] = useState<string[]>([])
  const waiting = new Set(openProposals(w).flatMap((p: D) => p.changes.map((c: D) => c.input?.application)))
  const cols = columns(v, apps)
  return <div className="board" style={{ ['--cols' as string]: cols.length }}>
    {cols.map((col, i) => {
      const all = expanded.includes(col.id), shown = all ? col.apps : col.apps.slice(0, SHOWN), fresh = i === 0 ? col.apps.filter(isNew).length : 0
      return <section key={col.id} className={col.id === 'closed' ? 'column closed' : 'column'} aria-labelledby={'col-' + col.id}>
        <header><h2 id={'col-' + col.id}>{col.name}</h2><p className="col-count">{col.apps.length}{fresh > 0 && <span className="fresh">{fresh} new</span>}</p></header>
        {col.apps.length ? <ul>{shown.map(app => <li key={app.id}><Card app={app} w={w} selected={app.id === selected} waiting={waiting.has(app.id)} open={open} /></li>)}</ul>
          : <div className="col-empty"><Icon name="folder" size={28} /><strong>No candidates yet</strong><p>{col.id === 'closed' ? 'Candidates you hire or close appear here.' : `Candidates you move to ${col.name} appear here.`}</p></div>}
        {col.apps.length > SHOWN && <button className="col-more" onClick={() => setExpanded(e => all ? e.filter(x => x !== col.id) : [...e, col.id])}>{all ? 'Show fewer' : `+ ${col.apps.length - SHOWN} more candidates`}</button>}
      </section>
    })}
  </div>
}
