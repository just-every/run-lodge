import type { ReactNode } from 'react'
import '../site.css'
import './landing.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { links } from '../shell/links'
import { Arrow } from './Arrow'
import { copy } from './copy'
import { ApprovalDrawing, HistoryDrawing, LicenceDrawing, MoveInDrawing, ScorecardDrawing } from './Drawings'
import { HeroBoard } from './HeroBoard'
import { Icon } from './Icons'

/** The run site's homepage (run-lodge.com): hero, five sections, what else is included, closing. */
export function Landing() {
  const { hero, sections, included } = copy
  return <div className="site">
    <SiteHeader />
    <main>
      <section id="top" className="hero">
        <h1>{hero.title}</h1>
        <p className="sub">{hero.sub}</p>
        <p className="alt">100% free, open source alternative to <strong>{hero.alternatives[0]}</strong>, <strong>{hero.alternatives[1]}</strong> and <strong>{hero.alternatives[2]}</strong></p>
        <Actions />
        <p className="small">{hero.licence}</p>
        <HeroBoard />
      </section>
      <Feature id="scorecards" side="right" {...sections.scorecards}><ScorecardDrawing /></Feature>
      <Feature id="free" side="left" {...sections.free}><LicenceDrawing /></Feature>
      <Feature id="approvals" side="right" {...sections.approvals}><ApprovalDrawing /></Feature>
      <Feature id="history" side="left" {...sections.history}><HistoryDrawing /></Feature>
      <Feature id="move-in" side="right" {...sections.moveIn}><MoveInDrawing /></Feature>
      <section id="included" className="included" aria-labelledby="included-title">
        <p className="eyebrow">{included.eyebrow}</p>
        <h2 id="included-title">{included.title}</h2>
        <ul className="tiles">{included.tiles.map(([icon, text]) => <li key={icon} className="plank"><Icon name={icon} /><span>{text}</span></li>)}</ul>
      </section>
      <section id="start" className="closing" aria-labelledby="start-title">
        <div className="board closing-board"><h2 id="start-title">{hero.title}</h2><p>{hero.licence}</p></div>
        <Actions />
      </section>
    </main>
    <SiteFooter />
  </div>
}

function Actions() {
  return <p className="actions"><a className="pill" href={links.run}>{copy.hero.run} <Arrow /></a><a className="pill" href="https://demo.run-lodge.com/">Try the demo <Arrow /></a><a className="text-link" href={links.docs}>{copy.hero.docs}</a></p>
}

function Feature({ id, side, eyebrow, title, body, children }: { id: string; side: 'left' | 'right'; eyebrow: string; title: string; body: string; children: ReactNode }) {
  return <section id={id} className={`feature drawing-${side}`} aria-labelledby={`${id}-title`}>
    <div className="feature-text">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="body">{body}</p>
    </div>
    <div className="feature-drawing">{children}</div>
  </section>
}
