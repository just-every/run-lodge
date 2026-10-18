import { useEffect, useRef, useState } from 'react'
import { call, type D } from './shared'
import { Overview } from './overview'
import { Vacancies } from './vacancies'
import { Applications } from './applications'
import { Candidates } from './candidates'
import { Approvals } from './approvals'
import { Proposals } from './proposals'
import { Retention } from './retention'
import { MoveIn } from './move-in'
import { People } from './people'
import { Audit } from './audit'

export function App() {
  const [w, setW] = useState<D>(), [error, setError] = useState(''), [tab, setTab] = useState('Overview'), [notice, setNotice] = useState('')
  const [openApp, setOpenApp] = useState<string | null>(null)
  const tabsRef = useRef<HTMLElement>(null), [more, setMore] = useState(false)
  // On a narrow screen the tab row scrolls sideways: keep the current tab in view, and fade the
  // right edge while more tabs lie beyond it.
  const edge = () => { const n = tabsRef.current, last = n?.lastElementChild; setMore(!!n && !!last && last.getBoundingClientRect().right > n.getBoundingClientRect().right - parseFloat(getComputedStyle(n).paddingRight) + 1) }
  useEffect(() => { tabsRef.current?.querySelector('[aria-current=page]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); edge() }, [tab, w])
  useEffect(() => { addEventListener('resize', edge); return () => removeEventListener('resize', edge) }, [])
  async function reload() { setW(await call('state')) }
  useEffect(() => { reload().catch(e => setError(e.message)) }, [])
  async function mutate(op: string, body: D) {
    const result = await call('command/' + op, body)
    setNotice('Saved.')
    await reload()
    return result
  }
  if (!w) return <main className="loading"><h1>Lodge</h1>{error ? <p role="alert">{error} · <a href="/signin?returnTo=%2Fapp">Sign in</a></p> : <p>Opening your hiring workspace…</p>}</main>
  const { actor } = w
  const admin = actor.owner || actor.roles.includes('admin'), manager = admin || actor.roles.includes('manager')
  const tabs = [
    'Overview', ...(manager ? ['Vacancies'] : []), ...(w.applications.length || manager ? ['Applications'] : []), ...(manager ? ['Candidates'] : []),
    ...(w.approvals.length || actor.roles.includes('approver') ? ['Approvals'] : []), 'Proposals', ...(admin ? ['Retention'] : []), ...(actor.owner ? ['Move in'] : []),
    ...(admin ? ['People', 'Audit'] : []),
  ]
  const go = (t: string, app?: string) => { setTab(t); setNotice(''); if (app !== undefined) setOpenApp(app) }
  const props = { w, mutate, reload, go, setNotice }
  return <>
    <header className="shell-head"><a className="brand" href="/app"><img src="/brand/mark.svg" alt="" width="52" height="34" /><span><strong data-rer-name>{w.business?.name ?? 'Lodge'}</strong> <small>Hiring with every decision on record</small></span></a><span className="who">{actor.name} · {actor.owner ? 'owner' : actor.roles.join(', ') || 'no Lodge role yet'}</span></header>
    <nav aria-label="Workspace" ref={tabsRef} data-more={more || undefined} onScroll={edge}>{tabs.map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>{t}</button>)}</nav>
    <main>
      <p aria-live="polite" className="notice">{notice}</p>
      {tab === 'Overview' && <Overview {...props} />}
      {tab === 'Vacancies' && <Vacancies {...props} />}
      {tab === 'Applications' && <Applications {...props} open={openApp} setOpen={setOpenApp} />}
      {tab === 'Candidates' && <Candidates {...props} />}
      {tab === 'Approvals' && <Approvals {...props} />}
      {tab === 'Proposals' && <Proposals {...props} />}
      {tab === 'Retention' && <Retention {...props} />}
      {tab === 'Move in' && <MoveIn {...props} />}
      {tab === 'People' && <People {...props} />}
      {tab === 'Audit' && <Audit {...props} />}
    </main>
    <footer className="shell-foot">Lodge keeps the hiring record. It sends no email, ranks no one and makes no hiring decision; people do.</footer>
  </>
}

export interface PageProps { w: D; mutate: (op: string, body: D) => Promise<D>; reload: () => Promise<void>; go: (tab: string, app?: string) => void; setNotice: (n: string) => void }
