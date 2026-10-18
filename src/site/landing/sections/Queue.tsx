import { Avatar, Check, Clock, Copy, Dot, Facts, Section } from '../parts'

// 04: the review queue on Wed Oct 7 with Jordan's parsed resume, the source split (19 + 12 + 11 + 4 = 46) and the
// candidate email that went out. Copy sits left of the queue here, to break the run of top-copy sections.
const sources: [string, number][] = [['LinkedIn', 19], ['Indeed', 12], ['Careers page', 11], ['Referral', 4]]

export function Queue() {
  return <Section id="queue" className="split split-copy-left">
    <div className="split-copy">
      <Copy id="queue-title" eyebrow="Find · Thu Oct 1 – Wed Oct 14" title="46 applicants, one queue." sub="Resumes are read for you, every applicant gets a receipt, and you decide from one queue." />
      <div className="card came">
        <h3 className="card-title">Where they came from</h3>
        <ul className="bars">{sources.map(([name, n]) => <li key={name}><span>{name}</span><span className="bar" aria-hidden="true"><i style={{ width: `${n / 19 * 72}%` }} /></span><span className="num">{n}</span></li>)}</ul>
        <p className="card-foot">46 applied</p>
      </div>
      <MailCard />
    </div>
    <div className="queue-cards">
      <div className="card review">
        <div className="review-top"><h3 className="card-title">Review queue · Product Designer</h3><Facts className="meta" items={['6 of 21 left', 'Wed Oct 7']} /></div>
        <div className="person"><Avatar initials="JE" /><div><strong>Jordan Ellis</strong><Facts items={['Referred by Priya Nair', 'Mon Oct 5']} /></div></div>
        <p className="label">From the resume</p>
        <ul className="resume">
          <li><Facts items={['Senior Designer', 'Lakeshore Health', '2021 – now']} /></li>
          <li><Facts items={['Designer', 'Short North Studio', '2018 – 2021']} /></li>
          <li><Facts items={['BFA, Design', 'Ohio State', '2018']} /></li>
        </ul>
        <p className="label">Screening</p>
        <ul className="screening">
          <li><Check /><Facts items={['Portfolio', 'jordanellis.design']} /></li>
          <li><Check /><Facts items={['Authorized to work in the US', 'Yes']} /></li>
        </ul>
        <div className="decide"><span className="btn btn-red">Advance</span><span className="btn">Reject</span><span className="btn">Skip</span></div>
      </div>
    </div>
  </Section>
}

function MailCard() {
  return <div className="card mail">
    <h3 className="card-title">Candidate email</h3>
    <ul className="ticks">
      <li><Check /><Facts items={['46 receipts sent', '0 failed']} /></li>
      <li><Check /><Facts items={['37 not moving forward', 'reason recorded']} /></li>
      <li><span className="tick-clock"><Clock /></span>Their emails go out in 2 business days</li>
      <li><Dot tone="amber" /><span><span className="nowrap">resume_scan.jpg unreadable ·</span> <span className="nowrap">original kept ·</span> <span className="nowrap">PDF requested</span></span></li>
    </ul>
  </div>
}
