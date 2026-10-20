import { useEffect, useState } from 'react'
import { call, type D } from './shared'
import { Rail, type Tab } from './shell/rail'
import { TopBar } from './shell/topbar'
import { Overview } from './overview'
import { Vacancies } from './vacancies'
import { Applications } from './applications'
import { Candidates } from './candidates'
import { Events } from './events'
import { Approvals } from './approvals'
import { Proposals } from './proposals'
import { Retention } from './retention'
import { MoveIn } from './move-in'
import { People } from './people'
import { Audit } from './audit'
import { WorkflowSandbox } from './workflow-sandbox'
import { Kit } from './kit'
import { openProposals } from './pipeline/facts'
import { useZone } from './format'
import { businessZone } from '../lodge/core/time'

/** Where the workspace is: the screen, and on it the open application, the job on the board and the open vacancy. */
export interface Nav { tab: string; app: string | null; job: string | null; vacancy: string | null }
export type Target = Partial<Omit<Nav, 'tab'>>

export function App() {
  const [w, setW] = useState<D>(), [error, setError] = useState(''), [notice, setNotice] = useState('')
  // An empty tab is the home screen: the job board, the screen the owner picked, once there are applications to run.
  const [nav, setNav] = useState<Nav>({ tab: '', app: null, job: null, vacancy: null })
  // An interview kit opens straight from its calendar invitation link (/app?kit=<interview>).
  const [kit, setKit] = useState<string | null>(null)
  async function reload() { setW(await call('state')) }
  // HOME-001 links name the exact work item: ?application=, ?job=, ?approval= or ?task= (a kit keeps its own URL).
  const [focus, setFocus] = useState<string | null>(null)
  function follow(href: string) {
    const q = new URLSearchParams(new URL(href, location.origin).search), at = (k: string) => q.get(k)
    setKit(at('kit')); setNotice(''); scrollTo({ top: 0 })
    history.replaceState(null, '', at('kit') ? '/app?kit=' + encodeURIComponent(at('kit')!) : '/app')
    if (at('application')) setNav(n => ({ ...n, tab: 'Applications', app: at('application'), job: null }))
    else if (at('job')) setNav(n => ({ ...n, tab: 'Applications', job: at('job'), app: '' }))
    else if (at('approval')) { setNav(n => ({ ...n, tab: 'Approvals' })); setFocus('approval-' + at('approval')) }
    else if (at('task')) { setNav(n => ({ ...n, tab: 'Overview' })); setFocus('task-' + at('task')) }
  }
  useEffect(() => { follow(location.href); reload().catch(e => setError(e.message)) }, [])
  useEffect(() => { if (w && focus) { document.getElementById(focus)?.scrollIntoView({ block: 'center' }); setFocus(null) } }, [w, focus, nav.tab])
  async function mutate(op: string, body: D) {
    const result = await call('command/' + op, body)
    setNotice('Saved.')
    await reload()
    return result
  }
  if (!w) return <main className="loading"><img src="/brand/mark.svg" alt="" width="52" height="34" /><h1>Lodge</h1>{error ? <p role="alert">{error} · <a href="/signin?returnTo=%2Fapp">Sign in</a></p> : <p>Opening your hiring workspace…</p>}</main>
  useZone(businessZone(w.business))
  const { actor } = w
  const admin = actor.owner || actor.roles.includes('admin'), manager = admin || actor.roles.includes('manager')
  const me = actor.email
  const pending = w.approvals.filter((x: D) => x.status === 'pending')
  const tabs: Tab[] = [
    { name: 'Overview', icon: 'overview' },
    ...(manager ? [{ name: 'Vacancies', icon: 'vacancies', count: w.vacancies.filter((v: D) => v.status === 'open').length } as Tab] : []),
    ...(w.applications.length || manager ? [{ name: 'Applications', icon: 'applications', count: w.applications.filter((a: D) => a.status === 'active').length } as Tab] : []),
    ...(manager ? [{ name: 'Candidates', icon: 'candidates' } as Tab] : []),
    ...(manager || w.events.length ? [{ name: 'Events', icon: 'pin', count: w.events.length } as Tab] : []),
    ...(w.approvals.length || actor.roles.includes('approver') ? [{ name: 'Approvals', icon: 'approvals', count: pending.length, urgent: pending.some((x: D) => x.approver === me) } as Tab] : []),
    { name: 'Proposals', icon: 'proposals', count: openProposals(w).length, urgent: openProposals(w).length > 0 },
    ...(manager ? [{ name: 'Workflow sandbox', icon: 'proposals' } as Tab] : []),
    ...(admin ? [{ name: 'Retention', icon: 'retention', count: w.retention?.due.length } as Tab] : []),
    ...(actor.owner ? [{ name: 'Move in', icon: 'movein' } as Tab] : []),
    ...(admin ? [{ name: 'People', icon: 'people' } as Tab, { name: 'Audit', icon: 'audit' } as Tab] : []),
  ]
  const go = (tab: string, target: Target = {}) => { setKit(null); setNav(n => ({ ...n, ...target, tab })); setNotice(''); scrollTo({ top: 0 }) }
  const closeKit = () => { history.replaceState(null, '', '/app'); setKit(null) }
  const props = { w, mutate, reload, go, setNotice, nav, follow }
  const home = w.business && manager && w.applications.some((a: D) => a.manages) ? 'Applications' : 'Overview'
  const tab = nav.tab || home
  return <div className="shell">
    <Rail w={w} tabs={tabs} nav={{ ...nav, tab }} go={go} />
    <div className="work">
      <TopBar w={w} go={go} manager={manager} />
      <main>
        <p aria-live="polite" className="notice">{notice}</p>
        {kit && <Kit id={kit} w={w} mutate={mutate} close={closeKit} />}
        {!kit && tab === 'Overview' && <Overview {...props} />}
        {!kit && tab === 'Vacancies' && <Vacancies {...props} />}
        {!kit && tab === 'Applications' && <Applications {...props} />}
        {!kit && tab === 'Candidates' && <Candidates {...props} />}
        {!kit && tab === 'Events' && <Events {...props} />}
        {!kit && tab === 'Approvals' && <Approvals {...props} />}
        {!kit && tab === 'Proposals' && <Proposals {...props} />}
        {!kit && tab === 'Retention' && <Retention {...props} />}
        {!kit && tab === 'Move in' && <MoveIn {...props} />}
        {!kit && tab === 'People' && <People {...props} />}
        {!kit && tab === 'Audit' && <Audit {...props} />}
        {!kit && tab === 'Workflow sandbox' && <WorkflowSandbox {...props} />}
      </main>
      <footer className="shell-foot">Lodge keeps the hiring record. It sends no email, ranks no one and makes no hiring decision; people do.</footer>
    </div>
  </div>
}

export interface PageProps { w: D; mutate: (op: string, body: D) => Promise<D>; reload: () => Promise<void>; go: (tab: string, target?: Target) => void; setNotice: (n: string) => void; nav: Nav; follow: (href: string) => void }
