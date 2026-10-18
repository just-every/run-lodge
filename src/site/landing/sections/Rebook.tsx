import { Avatar, Copy, Dot, Facts, Section } from '../parts'

// 06: Juniper's Thursday in scheduling's own form. Every hour is the same height, so the struck 10:00-11:30 panel
// and the new 2:30-4:00 block are the same size; the seat chips hang under the new block instead of stretching it.
const hours = ['9 a.m.', '10 a.m.', '11 a.m.', '12 p.m.', '1 p.m.', '2 p.m.', '3 p.m.', '4 p.m.']
const at = (h: number) => ({ top: `calc(${h - 9} * var(--hour))` })
const span = (from: number, to: number) => ({ ...at(from), height: `calc(${to - from} * var(--hour))` })

export function Rebook() {
  return <Section id="rebook">
    <Copy id="rebook-title" eyebrow="Hire · Thu Oct 22" title={<>Out sick at 7:38.<br />Rebooked by 8:06.</>} sub="Lodge finds a replacement, gets your OK and lets the candidate pick the new time." />
    <div className="rebook">
      <div className="card day">
        <h3 className="card-title">Juniper · Thursday, Oct 22</h3>
        <div className="day-grid">
          <ol className="hours" aria-hidden="true">{hours.map((h, i) => <li key={h} style={at(9 + i)}><span>{h}</span></li>)}</ol>
          <div className="events">
            <p className="event ghost" style={span(10, 11.5)}><s><Facts items={['Panel 2', 'Jordan Ellis', '10:00 – 11:30 a.m.']} /></s></p>
            <p className="event crit" style={span(12, 12.75)}><span>Design crit. <i>·</i> <span className="nowrap">12:00 – 12:45 p.m.</span></span></p>
            <svg className="moved" viewBox="0 0 100 300" preserveAspectRatio="none" aria-hidden="true"><path d="M4 4C70 30 82 150 46 286" /><path d="M32 270l14 18 14-20" /></svg>
            <div className="event new" style={span(14.5, 16)}>
              <p><strong>Panel 2 · Jordan Ellis</strong><span>2:30 – 4:00 p.m.</span></p>
              <ul className="seats">
                <li><Avatar initials="DK" />Dev Kapoor</li>
                <li><Avatar initials="MT" tone="violet" />Maya Torres</li>
                <li className="out"><Avatar initials="LB" tone="grey" /><s>Lena Brooks</s></li>
                <li className="in"><Avatar initials="AR" tone="green" />Ana Ruiz</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div className="rebook-side">
        <div className="card email">
          <p className="to">To: Jordan Ellis</p>
          <h3 className="card-title big">Pick a new time for your panel</h3>
          <p className="email-sub">Your 10:00 a.m. panel needs a new time.</p>
          <ul className="options">
            <li className="chosen"><Radio on /><span>Thu Oct 22 <i>·</i> 2:30 p.m.</span></li>
            <li><Radio /><span>Fri Oct 23 <i>·</i> 10:00 a.m.</span></li>
            <li><Radio /><span>Fri Oct 23 <i>·</i> 1:30 p.m.</span></li>
          </ul>
          <p className="picked">Jordan picked 8:02 a.m.</p>
        </div>
        <ol className="card log">
          <li><time>7:38 a.m.</time><Dot tone="red" /><span>Lena Brooks out sick</span></li>
          <li><time>7:44 a.m.</time><Dot /><span>Maya approved Ana Ruiz</span></li>
          <li className="done"><time>8:06 a.m.</time><Dot /><span><span className="nowrap">Rebooked ·</span> <span className="nowrap">invites accepted 3 of 3</span></span></li>
        </ol>
      </div>
    </div>
  </Section>
}

function Radio({ on = false }: { on?: boolean }) {
  return on
    ? <svg className="radio" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff" /><path d="M7 12.4l3.3 3.3L17.2 8.8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg className="radio" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
}
