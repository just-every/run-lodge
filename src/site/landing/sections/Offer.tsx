import { Copy, Section, type Tone } from '../parts'

// 08: offer letter v2 inside the approved range with the moved start date, and the DocuSign timeline: v1 signed,
// the start date moved, v2 redrafted, approved and signed. A completed envelope is superseded, never voided.
const steps: [when: string, what: string, tone: Tone][] = [
  ['Mon Oct 26 · 1:20 p.m.', 'Approved by Sam Okafor', 'green'],
  ['3:10 p.m.', 'Sent', 'grey'],
  ['6:48 p.m.', 'Viewed', 'grey'],
  ['Tue Oct 27 · 9:15 a.m.', 'v1 signed', 'green'],
  ['Fri Oct 30 · 9:02 a.m.', 'Jordan asks to start Nov 16', 'grey'],
  ['9:20 a.m.', 'v2 drafted with Mon Nov\u00a016\u00a0· v1\u00a0superseded', 'grey'],
  ['10:20 a.m.', 'Sam approved v2', 'green'],
  ['10:24 a.m.', 'v2 sent to Jordan', 'grey'],
  ['1:47 p.m.', 'v2 signed', 'green'],
]

export function Offer() {
  return <Section id="offer" className="split split-copy-right">
    <div className="offer-stack">
      <div className="card letter">
        <div className="letter-top"><h3 className="card-title">Offer letter · v2</h3><span className="chip chip-green">Signed</span></div>
        <p className="letter-who">Jordan Ellis · Product Designer</p>
        <dl className="pairs plain">
          <div><dt>Base salary</dt><dd>$114,000 a year</dd></div>
          <div><dt>Approved range</dt><dd>$102,000 – $124,000</dd></div>
          <div><dt>Start date</dt><dd><s>Mon Nov 9</s> · <strong>Mon Nov 16</strong></dd></div>
          <div><dt>Schedule</dt><dd>Full-time · hybrid · Columbus, OH</dd></div>
        </dl>
        <p className="letter-foot">Approved by Sam Okafor</p>
      </div>
      <div className="card sign">
        <h3 className="card-title">Signature · DocuSign</h3>
        <ol className="timeline">{steps.map(([when, what, tone], i) => <li key={i} className={i === steps.length - 1 ? 'last' : undefined}><span className={`tl-dot dot-${tone}`} aria-hidden="true" /><time>{when}</time><span>{what}</span></li>)}</ol>
      </div>
    </div>
    <div className="split-copy">
      <Copy id="offer-title" eyebrow="Hire · Mon Oct 26 – Fri Oct 30" title="Signed as approved." sub="Lodge fills the offer from your template and tracks the signature. Change the start date and it redrafts the offer and sends it back for signing." />
    </div>
  </Section>
}
