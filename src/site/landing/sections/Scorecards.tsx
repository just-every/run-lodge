import { Avatar, Clock, Copy, Dot, Facts, Section } from '../parts'

// 07: three independent scorecards on the job's rubric, the overdue reminder, Dev's release and the debrief brief
// (agreements, differences and what nobody assessed; no overall score).
type Card = { initials: string; tone: 'rose' | 'sky' | 'violet'; name: string; part: string; verdict: string; strong?: boolean; scores: [string, number][]; quote: string }
const cards: Card[] = [
  { initials: 'DK', tone: 'rose', name: 'Dev Kapoor', part: 'Portfolio review', verdict: 'Strong yes', strong: true, scores: [['Craft', 4], ['Systems thinking', 4]], quote: '“Rebuilt Lakeshore’s intake flow; form errors fell by half.”' },
  { initials: 'AR', tone: 'sky', name: 'Ana Ruiz', part: 'Portfolio review', verdict: 'Yes', scores: [['Craft', 4], ['Systems thinking', 2]], quote: '“Strong screens; the component library was thin.”' },
  { initials: 'MT', tone: 'violet', name: 'Maya Torres', part: 'Design exercise', verdict: 'Yes', scores: [['Collaboration', 4], ['Communication', 3]], quote: '“Asked the right questions before drawing.”' },
]

export function Scorecards() {
  return <Section id="scorecards">
    <Copy id="scorecards-title" eyebrow="Hire · Thu Oct 22 – Fri Oct 23" title="Scored on their own. Read together." sub="Each interviewer scores the job's rubric without seeing the others. Dev releases them when all three are in." />
    <div className="card released">
      <p><span className="overdue"><Clock /></span><span><span className="nowrap">Dev's scorecard overdue ·</span> <span className="nowrap">reminded Fri 9:00 a.m. ·</span> <span className="nowrap">in 10:26 a.m.</span></span></p>
      <span className="chip chip-green"><span className="nowrap">Released by Dev Kapoor ·</span> <span className="nowrap">Fri Oct 23, 11:05 a.m.</span></span>
    </div>
    <div className="scores">
      <ul className="score-cards">
        {cards.map(card => <li key={card.name} className="card score">
          <Avatar initials={card.initials} tone={card.tone} />
          <h3>{card.name}</h3>
          <p className="part">{card.part}</p>
          <span className={card.strong ? 'verdict strong' : 'verdict'}>{card.verdict}</span>
          <dl className="rubric">{card.scores.map(([criterion, n]) => <div key={criterion}><dt>{criterion}</dt><dd><span className="pips" aria-label={`${n} of 4`}>{[1, 2, 3, 4].map(i => <i key={i} className={i <= n ? 'on' : undefined} />)}</span><span className="num">{n}</span></dd></div>)}</dl>
          <blockquote>{card.quote}</blockquote>
        </li>)}
      </ul>
      <div className="card debrief">
        <h3 className="card-title">Debrief brief for Dev</h3>
        <ul>
          <li><Dot /><Facts items={['Agree', 'Craft', 'Dev 4, Ana\u00a04']} /></li>
          <li><Dot tone="amber" /><Facts items={['Differ', 'Systems thinking', 'Dev 4, Ana\u00a02']} /></li>
          <li><Dot tone="grey" /><Facts items={['Not assessed', 'Accessibility']} /></li>
        </ul>
        <p className="card-foot small">9 passages cited · no overall score</p>
      </div>
    </div>
  </Section>
}
