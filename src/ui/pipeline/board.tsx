import { useState } from 'react'
import { amount, day, since, slot, weekday } from '../format'
import { Icon } from '../icons'
import { person } from '../names'
import { Avatar, type D } from '../shared'
import { board, type BoardView } from '../../lodge/views/board'
import { closedLabel, isNew, openProposals, stageName } from './facts'

const SHOWN = 4

/** One application as a compact card, each fact on one line: who, where from and how long in this stage, its last
 *  activity, the next interview (the column already names the stage), and its panel's scorecards. */
function Card({ card, app, w, v, selected, waiting, list, open }: { card: D; app: D; w: D; v: D; selected: boolean; waiting: boolean; list: boolean; open: (id: string) => void }) {
  const iv = card.nextInterview
  const offer = w.offers.find((o: D) => o.application === app.id && o.status === 'draft')
  const days = card.daysInStage === 1 ? '1 day' : `${card.daysInStage} days`
  return <button className={selected ? 'cand selected' : 'cand'} aria-label={'Open ' + app.candidateName} aria-pressed={selected} onClick={() => open(app.id)}>
    <span className="cand-who"><Avatar name={app.candidateName} size="sm" /><strong title={app.candidateName}>{app.candidateName}</strong></span>
    <small className="cand-meta">{card.source && <>{card.source} · </>}{app.status === 'active' ? `${days} in ${list ? stageName(v, app.stage) : 'stage'}` : `closed ${since(card.enteredStage)} ago`}</small>
    <small className="cand-meta">Last activity {since(card.lastActivity) === 'today' ? 'today' : since(card.lastActivity) + ' ago'}</small>
    {app.status !== 'active' && <span className="cand-line muted" title={app.history.at(-1)?.reason}>{[app.status === 'rejected' ? '' : closedLabel(app), app.history.at(-1)?.reason].filter(Boolean).join(' · ') || closedLabel(app)}</span>}
    {offer && <span className="cand-facts"><span><Icon name="dollar" size={15} />{amount(offer.salary.amount, offer.salary.currency)}</span><span><Icon name="calendar" size={15} />Starts {day(offer.startDate).replace(/, \d{4}$/, '')}</span>
      <span><Icon name="clock" size={15} />{offer.approvedNow ? 'Approved' : offer.approval?.status === 'pending' ? `Awaiting ${person(w, offer.approval.approver)}’s approval` : 'Draft'}</span></span>}
    {iv && !offer && <span className="cand-line"><Icon name="calendar" size={15} /><span>{iv.status === 'scheduled' ? slot(iv.start) : `Proposed: ${weekday(iv.firstSlot)}`}</span></span>}
    {waiting && <span className="cand-flag">Needs your decision</span>}
    {card.needsDecision && <span className="cand-flag">All scorecards in · needs decision</span>}
    {app.likelySpam && <span className="cand-flag">Likely spam: review</span>}
    {card.scorecards?.panel > 0 && <span className="bar" title={card.scorecards.outstanding.length ? 'Waiting on ' + card.scorecards.outstanding.map((p: string) => person(w, p)).join(', ') : undefined}><span className="track"><i style={{ width: `${card.scorecards.submitted / card.scorecards.panel * 100}%` }} /></span>{card.scorecards.submitted} of {card.scorecards.panel}<span className="visually-hidden"> scorecards</span></span>}
  </button>
}

const SORTS = [['activity', 'Last activity'], ['days', 'Days in stage'], ['name', 'Name'], ['submitted', 'Applied first']]

/** The reader's filters, sort and layout for this job, saved for them on every change. */
function ViewBar({ b, w, save }: { b: D; w: D; save: (view: BoardView) => void }) {
  const f = b.view.filters
  const filter = (key: string, label: string, options: { value: string; label: string }[]) => options.length > 0 && <span className="board-pick">
    <label htmlFor={'board-' + key}>{label}</label>
    <select id={'board-' + key} value={f[key] ?? ''} onChange={e => save({ ...b.view, filters: { ...f, [key]: e.target.value || undefined } })}>
      <option value="">All</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select></span>
  return <div className="board-view" role="group" aria-label="Board view">
    {filter('source', 'Source', b.options.source.map((x: string) => ({ value: x, label: x })))}
    {filter('reviewer', 'Reviewer', b.options.reviewer.map((x: string) => ({ value: x, label: person(w, x) })))}
    {filter('tag', 'Tag', b.options.tag.map((x: string) => ({ value: x, label: x })))}
    {filter('rule', 'Rule match', b.options.rule.map((r: D) => ({ value: r.id, label: r.name })))}
    <span className="board-pick"><label htmlFor="board-sort">Sort by</label>
      <select id="board-sort" value={b.view.sort} onChange={e => save({ ...b.view, sort: e.target.value as BoardView['sort'] })}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span>
    <span className="board-pick"><label htmlFor="board-layout">Show as</label>
      <select id="board-layout" value={b.view.layout} onChange={e => save({ ...b.view, layout: e.target.value as BoardView['layout'] })}><option value="columns">Stage columns</option><option value="list">List</option></select></span>
    {b.filtered && <button className="link" onClick={() => save({ ...b.view, filters: {} })}>Clear filters</button>}
  </div>
}

/** PIPE-001: the job's pipeline as stage columns or one list, read through the same board view the API serves. */
export function Board({ v, w, selected, open, mutate }: { v: D; w: D; selected?: string; open: (id: string) => void; mutate: (op: string, body: D) => Promise<D> }) {
  const [expanded, setExpanded] = useState<string[]>([])
  const b = board(w, v.id)
  if (!b) return null
  const waiting = new Set(openProposals(w).flatMap((p: D) => p.changes.map((c: D) => c.input?.application)))
  const appOf = (c: D) => w.applications.find((a: D) => a.id === c.application)
  const card = (c: D, list: boolean) => <Card card={c} app={appOf(c)} w={w} v={v} selected={c.application === selected} waiting={waiting.has(c.application)} list={list} open={open} />
  const save = (view: BoardView) => { mutate('board-view', { vacancy: v.id, ...view }).catch(() => {}) }
  const count = (col: D) => <>{col.cards.length}{b.filtered && <span className="of-total">of {col.total}</span>}</>
  return <>
    <ViewBar b={b} w={w} save={save} />
    {b.view.layout === 'list'
      ? <section className="board-list" aria-label="Pipeline list">
        <p className="col-count">{b.columns.map((col: D) => <span key={col.id} className="list-count">{col.name} {count(col)}</span>)}</p>
        {b.columns.some((col: D) => col.cards.length) ? <ul>{b.columns.flatMap((col: D) => col.cards).map((c: D) => <li key={c.application}>{card(c, true)}</li>)}</ul> : <p className="muted">No candidates match these filters.</p>}
      </section>
      : <div className="board" style={{ ['--cols' as string]: b.columns.length }}>
        {b.columns.map((col: D, i: number) => {
          const all = expanded.includes(col.id), shown = all ? col.cards : col.cards.slice(0, SHOWN), fresh = i === 0 ? col.cards.filter((c: D) => isNew(c)).length : 0
          return <section key={col.id} className={col.id === 'closed' ? 'column closed' : 'column'} aria-labelledby={'col-' + col.id}>
            <header><h2 id={'col-' + col.id}>{col.name}</h2><p className="col-count">{count(col)}{fresh > 0 && <span className="fresh">{fresh} new</span>}</p></header>
            {col.cards.length ? <ul>{shown.map((c: D) => <li key={c.application}>{card(c, false)}</li>)}</ul>
              : <div className="col-empty"><Icon name="folder" size={28} /><strong>No candidates {b.filtered ? 'match' : 'yet'}</strong><p>{b.filtered ? 'Nobody here matches these filters.' : col.id === 'closed' ? 'Candidates you hire or close appear here.' : `Candidates you move to ${col.name} appear here.`}</p></div>}
            {col.cards.length > SHOWN && <button className="col-more" onClick={() => setExpanded(e => all ? e.filter(x => x !== col.id) : [...e, col.id])}>{all ? 'Show fewer' : `+ ${col.cards.length - SHOWN} more candidates`}</button>}
          </section>
        })}
      </div>}
  </>
}
