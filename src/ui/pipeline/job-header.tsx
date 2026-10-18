import { Fragment } from 'react'
import type { PageProps } from '../app'
import { WORK_MODES } from '../../lodge/core/labels'
import { day, payShort, weekday } from '../format'
import { Icon } from '../icons'
import type { D } from '../shared'
import { VacancyStatus } from '../vacancies'
import { sources } from './facts'

/** The job's title and terms as chips, then how many applied and from where. */
export function JobHeader({ v, apps, w, go }: { v: D; apps: D[] } & Pick<PageProps, 'w' | 'go'>) {
  const boardable = w.vacancies.filter((x: D) => x.status === 'open' || w.applications.some((a: D) => a.vacancy === x.id))
  // The rail lists the open jobs; the switch shows on wide screens only when a closed or imported job has applications too.
  const railed = boardable.every((x: D) => x.status === 'open')
  return <header className="job-head">
    {boardable.length > 1 && <label className={railed ? 'job-switch narrow-only' : 'job-switch'}>Job
      <select value={v.id} onChange={e => go('Applications', { job: e.target.value, app: null })}>{boardable.map((x: D) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
    </label>}
    <h1>{v.title}</h1>
    <ul className="chips">
      {v.location && <li className="chip"><Icon name="pin" size={17} />{v.location}{v.workMode && v.workMode !== 'remote' ? ` · ${WORK_MODES[v.workMode].toLowerCase()}` : ''}</li>}
      {v.compensation && <li className="chip"><Icon name="dollar" size={17} />{payShort(v.compensation)}</li>}
      {v.manages && <li className="chip plain"><VacancyStatus v={v} /></li>}
      {v.publishedAt && v.status === 'open' && <li className="chip" title={'Published ' + day(v.publishedAt)}><Icon name="calendar" size={17} />Posted {weekday(v.publishedAt).replace(/^\w+ /, '')}</li>}
      {v.status === 'open' && <li className="chip"><a href={`/jobs/${v.slug}`}><Icon name="external" size={17} />Application page</a></li>}
    </ul>
    <p className="sources"><strong>{apps.length} applied</strong>{sources(apps).map(([name, n]) => <Fragment key={name}> · <span>{name} {n}</span></Fragment>)}</p>
  </header>
}
