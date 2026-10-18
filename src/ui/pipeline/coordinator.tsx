import type { Target } from '../app'
import { Icon } from '../icons'
import { person } from '../names'
import type { D } from '../shared'
import { openProposals, proposalApplication } from './facts'

/** One line on what agents did for this job this week and what waits for the signed-in person. */
export function Coordinator({ v, apps, w, go, open }: { v: D; apps: D[]; w: D; go: (tab: string, target?: Target) => void; open: (id: string) => void }) {
  const ours = (p: D) => apps.some(a => a.id === proposalApplication(p))
  const related = w.proposals.filter(ours)
  if (!related.length) return null
  const week = Date.now() - 7 * 86400000
  const applied = related.filter((p: D) => p.status === 'applied' && Date.parse(p.decidedAt) > week).sort((x: D, y: D) => y.decidedAt.localeCompare(x.decidedAt))
  const waiting = openProposals(w).filter(ours)
  const decisions = [...new Set(waiting.map(proposalApplication))] as string[]
  const agents = [...new Set(related.map((p: D) => person(w, p.proposedBy)))].join(', ')
  const said = applied.length ? `applied this week: ${applied.slice(0, 2).map((p: D) => p.summary).join('; ')}${applied.length > 2 ? ` and ${applied.length - 2} more` : ''}.` : 'nothing applied this week.'
  return <section className="coordinator" aria-label={`Agent proposals for ${v.title}`}>
    <Icon name="agent" />
    <p><strong>{agents}:</strong> {said}</p>
    {decisions.length > 0 && <button className="flag" onClick={() => open(decisions[0])}>{decisions.length === 1 ? '1 decision needs you' : `${decisions.length} decisions need you`}</button>}
    <button className="link" onClick={() => go('Proposals')}>All proposals</button>
  </section>
}
