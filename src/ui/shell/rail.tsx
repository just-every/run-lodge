import { useState } from 'react'
import type { Nav, Target } from '../app'
import { forgetAll, signOut, sync, unsynced } from '../captures'
import { Icon, type IconName } from '../icons'
import { Avatar, type D } from '../shared'

export interface Tab { name: string; icon: IconName; count?: number; urgent?: boolean }

/** The left rail: the Lodge lockup, the open jobs, every screen with what waits on it, and who is signed in. */
export function Rail({ w, tabs, nav, go }: { w: D; tabs: Tab[]; nav: Nav; go: (tab: string, target?: Target) => void }) {
  const { actor } = w
  const jobs = w.vacancies.filter((v: D) => v.status === 'open')
  const active = (v: D) => w.applications.filter((a: D) => a.vacancy === v.id && a.status === 'active').length
  return <aside className="rail">
    <div className="rail-top">
      <a className="lockup" href="/app"><img src="/brand/mark.svg" alt="" width="46" height="31" /><strong data-rer-name>Lodge</strong></a>
      {w.business && <p className="business">{w.business.name}</p>}
    </div>
    {jobs.length > 0 && <section className="jobs" aria-labelledby="open-jobs">
      <h2 id="open-jobs">Open jobs</h2>
      <ul>{jobs.map((v: D) => <li key={v.id}><button aria-current={nav.tab === 'Applications' && nav.job === v.id ? 'true' : undefined} onClick={() => go('Applications', { job: v.id, app: null })}>
        <span title={v.title}>{v.title}</span><span className="job-count">{active(v)}<span className="visually-hidden"> active</span></span></button></li>)}</ul>
    </section>}
    <nav aria-label="Workspace">
      {tabs.map(t => <button key={t.name} aria-current={nav.tab === t.name ? 'page' : undefined} aria-describedby={t.count ? 'count-' + t.icon : undefined} onClick={() => go(t.name)}>
        <Icon name={t.icon} /><span>{t.name}</span>{t.count ? <span id={'count-' + t.icon} className={t.urgent ? 'count urgent' : 'count'} aria-hidden="true">{t.count}</span> : null}
      </button>)}
      {w.business && <a href="/jobs"><Icon name="external" /><span>Application pages</span></a>}
    </nav>
    <div className="me"><Avatar name={actor.name} /><p><strong>{actor.name}</strong><small>{actor.owner ? 'Owner' : actor.agent ? 'Agent' : actor.roles.map((r: string) => ROLE[r]).join(', ') || 'No Lodge role yet'}</small></p></div>
    <SignOut me={actor.email} />
  </aside>
}

const ROLE: D = { admin: 'Hiring admin', manager: 'Hiring manager', interviewer: 'Interviewer', approver: 'Approver' }

/**
 * CRM-009: signing out with event captures still on this device first says how
 * many, and offers to sync them; they are deleted only after that warning.
 */
function SignOut({ me }: { me: string }) {
  const [waiting, setWaiting] = useState<number | null>(null), [problem, setProblem] = useState('')
  async function start() {
    const left = (await unsynced(me).catch(() => [])).length
    if (left) setWaiting(left)
    else await signOut()
  }
  async function syncFirst() {
    const result = await sync(me)
    if (!result.left) return signOut().catch(() => setProblem('Lodge could not be reached to sign out; try again once online.'))
    setWaiting(result.left); setProblem(result.refused.join(' · ') || 'Still offline: these captures could not be sent yet.')
  }
  return <div className="sign-out">
    {waiting === null ? <><button className="link" onClick={() => start().catch(() => setProblem('Lodge could not be reached to sign out; try again once online.'))}>Sign out</button>{problem && <p role="alert">{problem}</p>}</>
      : <div role="alertdialog" aria-label="Unsynced captures" className="card">
        <p><strong>{waiting === 1 ? '1 person' : `${waiting} people`} captured on this device {waiting === 1 ? 'is' : 'are'} not synced yet.</strong> Signing out deletes {waiting === 1 ? 'that capture' : 'those captures'} from this device.</p>
        {problem && <p role="alert">{problem}</p>}
        <button className="primary" onClick={syncFirst}>Sync now, then sign out</button>
        <button onClick={async () => { await forgetAll(me); setWaiting(null); await signOut().catch(() => setProblem('The captures were deleted, but Lodge could not be reached to sign out; sign out again once online.')) }}>Delete them and sign out</button>
        <button className="link" onClick={() => { setWaiting(null); setProblem('') }}>Cancel</button>
      </div>}
  </div>
}
