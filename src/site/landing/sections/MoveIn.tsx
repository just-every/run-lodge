import { Copy, Section } from '../parts'

// 12: moving in from Workable the Monday before the opening. The terminal shows Lodge's one-line start and a plain
// comment, nothing else; the table reconciles every area against the source.
const rows: [string, string, string, string?, ('amber' | undefined)?][] = [
  ['Jobs', '14', '14'],
  ['Candidates', '2,318', '2,318'],
  ['Resumes and files', '3,904', '3,901', '3 missing in Workable · listed', 'amber'],
  ['Scorecards', '612', '612'],
  ['Active applications', '41', '41', 'join the live pipeline at cutover'],
  ['Old job links', '14', '14\u00a0mapped', 'old board listings flagged'],
]

export function MoveIn() {
  return <Section id="move-in" className="split split-copy-left">
    <div className="split-copy">
      <Copy id="move-in-title" eyebrow="Moving in · Mon Sep 21" title="Leave Workable on a Monday." sub="Move from Workable, Greenhouse or Lever. Jobs, candidates, resumes and scorecards come across, checked against the source." />
      <div className="terminal">
        <span className="lights" aria-hidden="true"><i /><i /><i /></span>
        <pre><code><span className="cmd">npx -y @runeditrun/rer dev just-every/run-lodge</span>{'\n'}<span className="comment"># clones, installs and starts Lodge on your computer</span></code></pre>
      </div>
    </div>
    <div className="card import">
      <div className="import-top"><h3 className="card-title big">Import from Workable</h3><span className="chip chip-green"><span className="nowrap">Reconciled ·</span> <span className="nowrap">ready to cut over</span></span></div>
      <table className="recon">
        <thead><tr><th scope="col"><span className="sr-only">Area</span></th><th scope="col">Workable</th><th scope="col">Lodge</th></tr></thead>
        <tbody>{rows.map(([area, from, to, note, tone]) => <tr key={area}><th scope="row">{area}{note && <span className={tone === 'amber' ? 'note amber' : 'note'}>{note}</span>}</th><td>{from}</td><td>{to}</td></tr>)}</tbody>
      </table>
    </div>
  </Section>
}
