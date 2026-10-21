import type { ReactNode } from 'react'
import type { PageProps } from './app'
import { home, STALLED_DAYS } from '../lodge/views/home'
import { slot, weekday } from './format'
import { Icon, type IconName } from './icons'
import { count, KINDS, person } from './names'
import { Status, type D } from './shared'

const short = (title: string) => title.split(':')[0]

/** HOME-001: what waits on the reader across every job they are on, each row linking to its exact work item.
 *  Their follow-ups and tasks sit in their own card below, where they are marked done. */
export function YourWork({ w, follow, mutate }: Pick<PageProps, 'w' | 'follow' | 'mutate'>) {
  const h = home(w)
  const rows: { key: string; icon: IconName; label: string; detail: string; link: string | null; mention?: string; status?: ReactNode }[] = [
    ...h.interviews.map((i: D) => ({ key: i.id, icon: 'calendar' as IconName, label: `${short(i.title)} with ${i.candidateName}`, detail: `${i.job} · ${slot(i.start)} · open the kit`, link: i.link, status: i.today ? <Status tone="warn">today</Status> : undefined })),
    ...h.scorecards.map((x: D) => ({ key: 'card' + x.id, icon: 'clock' as IconName, label: `Scorecard for ${x.candidateName}`, detail: `${x.job} · ${short(x.title)}`, link: x.link, status: x.overdue ? <Status tone="alert">overdue</Status> : x.due ? <Status tone="warn">due {weekday(x.due)}</Status> : undefined })),
    ...h.approvals.map((x: D) => ({ key: x.id, icon: 'approvals' as IconName, label: `Approve ${KINDS[x.subjectKind].toLowerCase()}: ${x.title}`, detail: `Requested by ${person(w, x.requestedBy)}`, link: x.link, status: <Status tone="alert">waiting on you</Status> })),
    ...h.reviews.map((q: D) => ({ key: 'review' + q.id, icon: 'applications' as IconName, label: `Review applications: ${q.job}`, detail: `${count(q.remaining, 'application')} in the queue`, link: q.link })),
    ...h.mentions.map((x: D) => ({ key: 'mention' + x.id, icon: 'mail' as IconName, label: x.title, detail: (x.text ?? '').slice(0, 140), link: x.link, mention: x.id, status: x.textOnly ? <Status>no link</Status> : undefined })),
    ...h.offers.map((o: D) => ({ key: o.id, icon: 'dollar' as IconName, label: `${o.action === 'record-outcome' ? 'Record the offer outcome' : 'Send the offer for approval'}: ${o.candidateName}`, detail: `${o.job} · ${o.title}`, link: o.link })),
    ...h.attention.map((j: D) => ({ key: 'job' + j.id, icon: 'alert' as IconName, label: `Needs attention: ${j.job}`, detail: [j.stalled ? `${count(j.stalled, 'candidate')} ${STALLED_DAYS}+ days in a stage` : '', j.unscheduled ? `${count(j.unscheduled, 'interview')} not yet scheduled` : ''].filter(Boolean).join(' · '), link: j.link })),
  ]
  return <section className="card"><h2>Your work</h2>
    {rows.length ? <ul className="list rich">{rows.map(r => <li key={r.key}><a href={r.link ?? '#'} onClick={async e => { e.preventDefault(); if (r.mention) await mutate('alert-read', { id: r.mention }); if (r.link) follow(r.link) }}><Icon name={r.icon} /><span><strong>{r.label}</strong><small>{r.detail}</small></span>{r.status}</a></li>)}</ul>
      : <p className="empty">Nothing is waiting on you.</p>}
  </section>
}
