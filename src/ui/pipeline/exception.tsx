import { useState, type FormEvent } from 'react'
import type { PageProps } from '../app'
import { recent, slot, when } from '../format'
import { Icon } from '../icons'
import { count, firstNames, person } from '../names'
import { Avatar, call, type D } from '../shared'
import { planPlace } from './facts'

const change = (p: D, op: string) => p.changes.find((c: D) => c.op === op)?.input

/**
 * Agent proposals that wait on this application, shown as the choice they are: each proposal is one option.
 * Apply change approves the chosen one (which re-checks every record it read) and declines the rest;
 * Keep as is declines them all. Both keep the reason with the decision.
 */
export function Exception({ proposals, app, v, w, mutate }: { proposals: D[]; app: D; v?: D; w: D; mutate: PageProps['mutate'] }) {
  const [chosen, setChosen] = useState(proposals[0].id), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pick = proposals.find(p => p.id === chosen) ?? proposals[0]
  const replaced = w.interviews.find((i: D) => i.id === (change(pick, 'cancel-interview') ?? change(pick, 'schedule'))?.interview)
  const planned = change(pick, 'interview'), email = change(pick, 'message')
  const before: string[] = replaced?.participants ?? [], after: string[] = planned?.participants ?? before
  const seats = [...before, ...after.filter(p => !before.includes(p))]
  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const keep = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'keep'
    const reason = (event.currentTarget.elements.namedItem('reason') as HTMLInputElement).value
    setBusy(true); setError('')
    try {
      const others = keep ? proposals : proposals.filter(p => p.id !== pick.id)
      if (!keep) await call('command/decide-proposal', { id: pick.id, decision: 'approved', reason })
      for (const p of others.slice(0, -1)) await call('command/decide-proposal', { id: p.id, decision: 'rejected', reason: keep ? reason : `Chose “${pick.summary}”` })
      const last = others.at(-1)
      if (last) await mutate('decide-proposal', { id: last.id, decision: 'rejected', reason: keep ? reason : `Chose “${pick.summary}”` })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <section className="exception" aria-label="Waiting for your decision">
    <div className="alert"><Icon name="alert" size={22} /><p><strong>Waiting for your decision</strong><span>{pick.rationale || pick.summary}</span></p></div>
    {replaced && <div className="replaced">
      <h3>{replaced.title.split(':')[0]} <span>· {planPlace(v, replaced)}</span></h3>
      <p className="muted">{replaced.status === 'scheduled' ? when(replaced.start) : 'Times not confirmed'}{replaced.location ? ` · ${replaced.location.split(' · ')[0]}` : ''}</p>
      <ul className="panelists">{seats.map(p => {
        const out = !after.includes(p), joins = !before.includes(p)
        return <li key={p} className={out ? 'out' : joins ? 'joins' : undefined}><Avatar name={person(w, p)} out={out} /><strong>{person(w, p)}</strong><small>{out ? 'Off panel' : joins ? 'Joins' : 'On panel'}</small></li>
      })}</ul>
    </div>}
    <form onSubmit={decide} className="bare">
      <fieldset className="choices"><legend className="visually-hidden">Options from {person(w, pick.proposedBy)}</legend>
        {proposals.map(p => { const iv = change(p, 'interview'); return <label key={p.id} className="choice">
          <input type="radio" name="option" value={p.id} checked={p.id === pick.id} onChange={() => setChosen(p.id)} />
          <span><strong>{p.summary}</strong>{iv && <small title={iv.participants.map((e: string) => person(w, e)).join(', ')}>{slot(iv.slots[0])} · {firstNames(w, iv.participants)}</small>}</span>
        </label> })}
      </fieldset>
      <p className="hint">From {person(w, pick.proposedBy)} · {recent(pick.proposedAt)} · read {count(pick.sources.length, 'record')}. Nothing changes until you choose.</p>
      <label>Reason (kept with the decision)<input name="reason" required /></label>
      <div className="form-end split-actions"><button className="primary" value="apply" disabled={busy}>Apply change</button><button className="secondary" value="keep" disabled={busy}>Keep as is</button></div>
      {error && <p role="alert">{error}</p>}
    </form>
    {email && <article className="draft">
      <header><h3>Draft email to {app.candidateName}</h3><span className="status warn">awaiting your approval</span></header>
      <p className="draft-subject">{email.subject}</p>
      <p className="pre">{email.body}</p>
      <p className="hint">Apply change saves this as a message draft to approve and download as an email file; Lodge sends nothing.</p>
    </article>}
  </section>
}
