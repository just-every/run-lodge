import type { Nav, Target } from '../app'
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
  </aside>
}

const ROLE: D = { admin: 'Hiring admin', manager: 'Hiring manager', interviewer: 'Interviewer', approver: 'Approver' }
