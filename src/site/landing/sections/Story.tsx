import { Copy, Dot, Section, type Tone } from '../parts'

// 02: the map of the story, one hire in three stages of four dated rows. The two exceptions carry amber dots.
type Row = [date: string, what: string, tone?: Tone, final?: boolean]
const stages: { n: number; title: string; rows: Row[] }[] = [
  { n: 1, title: 'Find', rows: [['Mon Sep 28', 'Opening approved'], ['Thu Oct 1', 'Posted to 4 places'], ['Mon Oct 5', 'Jordan Ellis referred'], ['Wed Oct 7', 'Moved to phone screen']] },
  { n: 2, title: 'Hire', rows: [['Tue Oct 13', 'Phone screen'], ['Thu Oct 22', 'Panel, rebooked 2:30\u00a0p.m.', 'amber'], ['Fri Oct 23', 'Scorecards released'], ['Tue Oct 27', 'Offer signed']] },
  { n: 3, title: 'Welcome', rows: [['Fri Oct 30', 'Start moved, re-signed', 'amber'], ['Mon Nov 2', 'Checkr clear'], ['Tue Nov 3', 'Created in BambooHR'], ['Mon Nov 16', 'First day', 'green', true]] },
]

export function Story() {
  return <Section id="story">
    <Copy id="story-title" eyebrow="One hire · Sep 28 → Nov 16" title="Opening on Sep 28. Desk ready Nov 16." sub="Fernway, 60 people in Columbus, Ohio, needs a product designer. Maya Torres runs hiring between her real work." />
    <ol className="story">
      {stages.map((stage, i) => <li key={stage.n} className="story-stage">
        <div className="card story-card">
          <h3 className="story-head"><span className="story-n" aria-hidden="true">{stage.n}</span>{stage.title}</h3>
          <ul className="story-rows">{stage.rows.map(([date, what, tone, final]) => <li key={date} className={final ? 'final' : undefined}><Dot tone={tone ?? 'green'} /><strong>{date}</strong><span>{what}</span></li>)}</ul>
        </div>
        {i < stages.length - 1 && <span className="story-arrow" aria-hidden="true">→</span>}
      </li>)}
    </ol>
  </Section>
}
