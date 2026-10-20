import { useEffect, useState } from 'react'
import type { PageProps } from './app'
import { openProposals, proposalApplication } from './pipeline/facts'
import { JobHeader } from './pipeline/job-header'
import { Coordinator } from './pipeline/coordinator'
import { Board } from './pipeline/board'
import { BulkActions } from './pipeline/bulk'
import { Activity } from './pipeline/activity'
import { ApplicationPanel } from './pipeline/panel'
import { Empty, type D } from './shared'
import { ReviewQueue } from './review-queue'
import { BlindReviewSettings } from './blind-review'
import { HiringViews } from './hiring-views'

/** The job a board opens on: the one with a decision waiting, else the busiest open job, else any with applications. */
function defaultJob(w: D) {
  const waiting = openProposals(w).map(proposalApplication).map((id: string) => w.applications.find((a: D) => a.id === id)?.vacancy).find(Boolean)
  const count = (v: D) => w.applications.filter((a: D) => a.vacancy === v.id && a.status === 'active').length
  const open = w.vacancies.filter((v: D) => v.status === 'open').sort((x: D, y: D) => count(y) - count(x))
  return waiting ?? open[0]?.id ?? w.vacancies.find((v: D) => w.applications.some((a: D) => a.vacancy === v.id))?.id
}

/** Applications: one job's pipeline as a stage board, with the open application beside it. */
export function Applications(props: PageProps) {
  const { w, nav, go } = props
  const chosen = w.applications.find((a: D) => a.id === nav.app)
  const job = w.vacancies.find((v: D) => v.id === (chosen?.vacancy ?? nav.job ?? defaultJob(w)))
  const apps = w.applications.filter((a: D) => a.vacancy === job?.id)
  // Arriving on a job with a decision waiting opens that application, and it stays open once decided;
  // closing the panel (app '') keeps it shut.
  const waiting = nav.app === null ? openProposals(w).map(proposalApplication).find((id: string) => apps.some((a: D) => a.id === id)) : undefined
  const [held, setHeld] = useState<string>()
  // DATA-003: the bulk selection stays while the reader moves between jobs.
  const [selection, setSelection] = useState<string[]>([])
  useEffect(() => { if (waiting) setHeld(waiting) }, [waiting])
  const app = nav.app === '' ? undefined : chosen ?? apps.find((a: D) => a.id === (waiting ?? held))
  if (!job) return <div className="page"><h1>Applications</h1><Empty icon="applications" title="No applications you can see yet.">Publish a vacancy’s application page or add a candidate, and each job’s pipeline appears here.</Empty></div>
  const open = (id: string) => go('Applications', { job: job.id, app: id })
  return <div className={app ? 'pipeline with-panel' : 'pipeline'}>
    <div className="pipeline-main">
      <JobHeader v={job} apps={apps} {...props} />
      <BlindReviewSettings key={job.id} v={job} mutate={props.mutate} />
      <Coordinator v={job} apps={apps} w={w} go={go} open={open} />
      <ReviewQueue v={job} w={w} mutate={props.mutate} open={open} />
      <Board v={job} w={w} selected={app?.id} open={open} mutate={props.mutate} />
      <HiringViews key={job.id} v={job} open={open} revision={w} />
      <BulkActions v={job} w={w} reload={props.reload} selection={selection} setSelection={setSelection} />
      <Activity v={job} apps={apps} w={w} open={open} />
    </div>
    {app && <ApplicationPanel key={app.id} app={app} {...props} close={() => go('Applications', { job: job.id, app: '' })} />}
  </div>
}
