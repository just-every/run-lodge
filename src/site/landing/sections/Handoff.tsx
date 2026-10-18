import { Check, Copy, Section } from '../parts'

// 09: the background check came back clear, then the BambooHR preview (nine fields, one mapping exception Maya
// approved) and the verified result. As on the desk: copy on top, the cards run left to right Checkr → BambooHR →
// Created (one column flowing down on tablets and phones).
const fields: [string, string][] = [
  ['Name', 'Jordan Ellis'], ['Job title', 'Product Designer'], ['Department', 'Product'], ['Manager', 'Dev Kapoor'],
  ['Location', 'Columbus, OH'], ['Employment', 'Full-time'], ['Pay', '$114,000 a year'], ['Start date', 'Mon Nov 16'], ['Documents', 'Signed offer v2'],
]

export function Handoff() {
  return <Section id="handoff">
    <Copy id="handoff-title" eyebrow="Welcome · Mon Nov 2 – Tue Nov 3" title="Handed to HR, exactly once." sub="When the offer is signed and the check is clear, Lodge creates the employee in BambooHR and reads it back." />
    <div className="handoff">
      <div className="card checkr">
        <h3 className="card-title">Checkr · Basic+</h3>
        <dl className="pairs">
          <div><dt>Consent</dt><dd>Wed Oct 28</dd></div>
          <div><dt>Status</dt><dd><span className="status-ok"><Check /><span>Clear · Mon Nov 2, 4:10 p.m.</span></span></dd></div>
        </dl>
        <p className="card-foot small">Report visible to Maya only</p>
      </div>
      <span className="flow-arrow" aria-hidden="true"><FlowArrow /></span>
      <div className="card bamboo">
        <h3 className="card-title">New employee · BambooHR</h3>
        <ul className="fields">
          {fields.map(([k, v]) => <li key={k}><span>{k}</span><span>{v}</span><Check />
            {k === 'Department' && <p className="exception"><span className="excl" aria-hidden="true">!</span><span>“Design” isn’t a BambooHR department · mapped to Product · Maya approved</span></p>}
          </li>)}
        </ul>
        <p className="card-foot small">Authorized by Maya Torres · <span className="nowrap">Tue Nov 3, 9:12 a.m.</span></p>
      </div>
      <span className="flow-arrow" aria-hidden="true"><FlowArrow /></span>
      <div className="card created">
        <span className="big-check"><Check /></span>
        <h3 className="card-title">Created in BambooHR</h3>
        <p>Employee 0412<br />9 of 9 fields match</p>
        <p className="card-foot small">Read back 9:13 a.m.</p>
      </div>
    </div>
  </Section>
}

function FlowArrow() {
  return <svg viewBox="0 0 44 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h36M29 3l10 9-10 9" /></svg>
}
