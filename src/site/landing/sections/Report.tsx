import { Check, Copy, Section } from '../parts'

// 11: what the hire took. 29 days to fill in five stages (7 + 8 + 9 + 4 + 1 = 29), the funnel 46 → 9 → 3 → 1 → 1,
// source and cost per hire ($420 + $1,500 = $1,920) and the agent's note on where the time went, which sits under
// the copy at right.
const stages: [string, number, string][] = [
  ['Opened → Jordan applied', 7, 'grey'], ['Applied → phone screen', 8, 'ink'], ['Phone screen → panel', 9, 'amber'], ['Panel → offer', 4, 'sky'], ['Offer → signed', 1, 'green'],
]
const funnel: [string, number][] = [['Applied', 46], ['Phone screen', 9], ['Panel', 3], ['Offer', 1], ['Hired', 1]]

export function Report() {
  return <Section id="report" className="split split-copy-right">
    <div className="report">
      <div className="card fill">
        <h3 className="card-title">Product Designer · filled</h3>
        <p className="days"><strong>29 days</strong><span>to fill</span></p>
        <p className="opened"><span className="nowrap">Opened Mon Sep 28 ·</span> <span className="nowrap">filled Tue Oct 27</span></p>
        <div className="stage-bar" aria-hidden="true">{stages.map(([name, d, tone]) => <i key={name} className={`seg-${tone}`} style={{ flexGrow: d }} />)}</div>
        <ul className="legend">{stages.map(([name, d, tone]) => <li key={name}><span className={`key seg-${tone}`} aria-hidden="true" /><span>{name}</span><span className="num">{d} {d === 1 ? 'day' : 'days'}</span></li>)}</ul>
        <p className="card-foot">Jordan's time to hire · 22 days</p>
      </div>
      <div className="card funnel">
        <h3 className="card-title">Funnel</h3>
        <ul className="bars funnel-bars">{funnel.map(([name, n]) => <li key={name}><span>{name}</span><span className="bar bare" aria-hidden="true"><i style={{ width: `${Math.max(n / 46 * 100, 4)}%` }} /></span><span className="num">{n}</span></li>)}</ul>
        <dl className="pairs plain">
          <div><dt>Source of hire</dt><dd><span className="nowrap">Referral ·</span> <span className="nowrap">Priya Nair</span></dd></div>
          <div><dt>Cost per hire</dt><dd><strong>$1,920</strong></dd></div>
        </dl>
        <p className="card-foot small"><span className="nowrap">Indeed sponsored $420 +</span> <span className="nowrap">referral bonus $1,500</span></p>
      </div>
    </div>
    <div className="split-copy">
      <Copy id="report-title" eyebrow="After the hire · Tue Nov 17" title="See what every hire took." sub="Time to fill, where hires came from and who is still waiting, straight from the records." />
      <div className="report-side">
        <div className="card note">
          <h3 className="card-title"><span className="dot dot-sky" aria-hidden="true" />Agent note</h3>
          <p>Screen to panel took 9 days. 6 of them waited on panel calendars.</p>
          <p>Try: send panel times with the screen invite.</p>
          <span className="btn btn-wide">Try it on the next job</span>
        </div>
        <p className="card heard"><Check /><span><span className="nowrap">Candidates heard back ·</span> <span className="nowrap">45 of 45 ·</span> <span className="nowrap">0 waiting</span></span></p>
      </div>
    </div>
  </Section>
}
