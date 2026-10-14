import { Arrow } from './Arrow'
import { copy } from './copy'

/** The hero drawing: one birch board, three engraved cards, the loop ending in an accepted offer. */
export function HeroBoard() {
  return <figure className="board hero-board" role="img" aria-label={copy.hero.label}>
    <div className="step">
      <p className="step-head"><span className="disc">1</span>Approved</p>
      <div className="plank">
        <p className="plank-title">Product Designer</p>
        <p className="plank-row ruled">Austin, TX · headcount 1</p>
        <span className="chip">approved</span>
      </div>
    </div>
    <span className="between"><Arrow /><Arrow down /></span>
    <div className="step">
      <p className="step-head"><span className="disc">2</span>Scored on their own</p>
      <div className="plank">
        <p className="plank-row score"><span>Ivy Chen</span><span className="tick">✓</span><span>submitted</span></p>
        <p className="plank-row score"><span>Sam Ortiz</span><span className="tick">✓</span><span>submitted</span></p>
        <p className="band">Strong yes</p>
      </div>
    </div>
    <span className="between"><Arrow /><Arrow down /></span>
    <div className="step">
      <p className="step-head"><span className="disc">3</span>Offer accepted</p>
      <div className="plank">
        <p className="plank-title compact">Product Designer · starts Nov 3</p>
        <span className="chip">accepted</span>
      </div>
    </div>
  </figure>
}
