import { Copy, Section } from '../parts'

// 12: moving in from Workable the Monday before the opening. The terminal shows Lodge's one-line start and plain
// comments, nothing else; the table reconciles every area against the source.

// The one start line every Run Edit Run page shows, and the alternative for people who already have Node.
const START = 'curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-lodge'
const ALTERNATIVE = 'Already have Node 22 or later? npx -y @runeditrun/rer dev just-every/run-lodge'

/** A command that wraps only between words, keeping the installer's `install.sh | sh` together. */
function words(line: string) {
  return line.split(/(\S*install\.sh \| sh|\S+)/).map((part, index) => {
    const pipe = /^(.*\/)(install\.sh \| sh)$/.exec(part)
    if (pipe) return <span key={index}><span className="nowrap">{pipe[1]}</span><wbr /><span className="nowrap">{pipe[2]}</span></span>
    return part.trim() ? <span key={index} className="nowrap">{part}</span> : part
  })
}

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
        <pre><code><span className="cmd">{words(START)}</span>{'\n'}<span className="comment"># {words('installs rer, then gets and starts Lodge on your computer')}</span>{'\n'}<span className="comment"># {words(ALTERNATIVE)}</span></code></pre>
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
