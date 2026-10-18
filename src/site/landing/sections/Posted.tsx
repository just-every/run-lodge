import { Check, Chip, Copy, Section, Stop } from '../parts'

// 03: the approved opening, the careers page and the four places it went live. Indeed refused it first for a
// missing street address, a reason the board raises itself; the office address went in and it was live at 9:14.
export function Posted() {
  return <Section id="posted">
    <Copy id="posted-title" eyebrow="Find · Mon Sep 28 – Fri Oct 2" title="Posted to four places by Friday." sub="Lodge publishes the approved job to your careers page and the boards, and keeps every listing in step." />
    <div className="posted">
      <div className="card opening">
        <h3 className="card-title">Opening · Product Designer</h3>
        <dl className="pairs">
          <div><dt>Location</dt><dd>Columbus, OH · hybrid</dd></div>
          <div><dt>Pay</dt><dd><span className="nowrap">$102,000–$124,000</span> <span className="nowrap">a year</span></dd></div>
          <div><dt>Hiring manager</dt><dd>Dev Kapoor</dd></div>
          <div><dt>Headcount</dt><dd>1</dd></div>
        </dl>
        <p className="banner banner-green"><Check /><span><span className="nowrap">Approved by Sam Okafor ·</span> <span className="nowrap">Mon Sep 28</span></span></p>
      </div>
      <div className="card browser">
        <div className="browser-bar"><span className="lights" aria-hidden="true"><i /><i /><i /></span><span className="url"><Lock />careers.fernway.co</span></div>
        <div className="browser-body">
          <h3 className="careers-title">Join Fernway</h3>
          <ul className="jobs">
            <li><div><strong>Product Designer</strong><span><span className="nowrap">Columbus, OH ·</span> <span className="nowrap">$102k – $124k a year</span></span></div><span className="apply">Apply</span></li>
            <li><div><strong>Customer Success Lead</strong><span>Remote, US · $68k – $80k a year</span></div></li>
            <li><div><strong>Warehouse Associate</strong><span>Columbus, OH · $19 – $22 an hour</span></div></li>
          </ul>
        </div>
      </div>
      <div className="posted-side">
        <div className="card where">
          <h3 className="card-title">Where it's posted</h3>
          <ul className="boards">
            <li><strong>Careers page</strong><Chip tone="green" icon="check">Live Thu Oct 1</Chip></li>
            <li><strong>LinkedIn Jobs</strong><Chip tone="green" icon="check">Live</Chip><span className="detail">ID 4021187733</span></li>
            <li><strong>Indeed</strong><Chip tone="green" icon="check">Live 9:14 a.m.</Chip><span className="detail fail">Rejected 9:02 a.m.: street address required</span><span className="detail"><span className="nowrap">Office address added ·</span> <span className="nowrap">re-sent 9:10 a.m.</span></span></li>
            <li><strong>Google for Jobs</strong><Chip tone="green" icon="check">Indexed Fri Oct 2</Chip></li>
          </ul>
        </div>
        <p className="refusal"><Stop /><span><span className="nowrap">“Current salary?” refused ·</span> <span className="nowrap">Columbus salary-history ban</span></span></p>
      </div>
    </div>
  </Section>
}

function Lock() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor" /><path d="M5.2 7V5.3a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
}
