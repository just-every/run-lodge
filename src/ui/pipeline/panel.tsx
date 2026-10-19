import { useState } from 'react'
import type { PageProps } from '../app'
import { Icon } from '../icons'
import { Avatar, type D } from '../shared'
import { Interviews } from '../interviews'
import { ScorecardForm, Scorecards } from '../scorecards'
import { Debriefs } from '../debriefs'
import { Messages, Offers } from '../decisions'
import { DocumentViewer, applicationDocuments } from '../document-viewer'
import { Documents } from '../documents'
import { Notes } from '../notes'
import { RecordOverview } from './record'

/** The open application beside the board: who they are, then its record in tabs. */
export function ApplicationPanel({ app, w, mutate, close }: { app: D; close: () => void } & PageProps) {
  const v = w.vacancies.find((x: D) => x.id === app.vacancy)
  const c = w.candidates.find((x: D) => x.id === app.candidate) ?? { name: app.candidateName }
  const tabs = ['Overview', 'Notes', 'Interviews', 'Scorecards', ...(app.manages ? ['Decisions'] : []), 'Documents']
  const [tab, setTab] = useState('Overview')
  const id = (t: string) => `panel-${t.toLowerCase()}`
  return <section className="app-panel" aria-label={`Application of ${c.name}`}>
    <header className="app-head">
      <Avatar name={c.name} size="lg" />
      <div><h2>{c.name}</h2><p>{v?.title}</p><p className="muted">{[c.location, app.source].filter(Boolean).join(' · ')}</p></div>
      <button className="icon-button" aria-label="Close the application" onClick={close}><Icon name="close" /></button>
    </header>
    <div role="tablist" aria-label="Application record" className="tabs">
      {tabs.map(t => <button key={t} role="tab" id={id(t) + '-tab'} aria-selected={tab === t} aria-controls={id(t)} onClick={() => setTab(t)}>{t}</button>)}
    </div>
    <div role="tabpanel" id={id(tab)} aria-labelledby={id(tab) + '-tab'} className="tab-body">
      {tab === 'Overview' && <RecordOverview app={app} v={v} c={c} w={w} mutate={mutate} />}
      {tab === 'Notes' && <Notes app={app} w={w} mutate={mutate} />}
      {tab === 'Interviews' && <Interviews app={app} v={v} w={w} mutate={mutate} />}
      {tab === 'Scorecards' && <><Scorecards app={app} v={v} w={w} mutate={mutate} /><Debriefs app={app} v={v} w={w} mutate={mutate} /><div className="document-and-scorecard"><DocumentViewer documents={applicationDocuments(app, w)} /><ScorecardForm app={app} v={v} w={w} mutate={mutate} /></div></>}
      {tab === 'Decisions' && <><Offers app={app} v={v} w={w} mutate={mutate} /><Messages app={app} w={w} mutate={mutate} /></>}
      {tab === 'Documents' && <Documents app={app} w={w} mutate={mutate} />}
    </div>
  </section>
}
