import type { ReactNode } from 'react'
import { Actions } from '../../shell/Actions'
import { SiteHeader } from '../../shell/SiteHeader'
import { copy } from '../copy'
import { Check, Facts } from '../parts'

// Each card sits where the approved hero draws it, in the painting's own 1536 x 1024 coordinates; its leader runs
// from the card's edge to the person or desk it describes (the offer's now ends on the laptop, not the hair).
type Card = { x: number; y: number; w: number; lead: string; rest: ReactNode[]; icon?: 'swap' | 'check'; leader: [number, number, number, number] }
const cards: Card[] = [
  { x: 680, y: 122, w: 282, lead: 'Product Designer', rest: ['Columbus,\u00a0OH', '$102k–$124k', <span className="chip chip-green chip-inline">approved</span>], leader: [863, 218, 889, 257] },
  { x: 652, y: 268, w: 264, lead: '46 applied', rest: ['LinkedIn\u00a019', 'Indeed\u00a012', 'careers page\u00a011', 'referral\u00a04'], leader: [844, 364, 876, 409] },
  { x: 1180, y: 88, w: 232, lead: 'Jordan Ellis', rest: ['Panel\u00a02', 'Thu Oct\u00a022, 10:00\u00a0a.m.', 'Juniper'], leader: [1251, 184, 1180, 263] },
  { x: 1132, y: 404, w: 296, lead: 'Interviewer out sick\u00a0→', rest: ['Ana\u00a0Ruiz swapped in', 'Jordan rebooked 2:30\u00a0p.m.'], icon: 'swap', leader: [1256, 404, 1210, 337] },
  { x: 1226, y: 527, w: 240, lead: 'Scorecards 3\u00a0of\u00a03\u00a0in', rest: ['released to team'], icon: 'check', leader: [1390, 598, 1377, 640] },
  { x: 1226, y: 739, w: 232, lead: 'Offer', rest: ['$114,000', 'start Nov\u00a09', 'signed'], icon: 'check', leader: [1381, 811, 1392, 851] },
]
const pct = (v: number, of: number) => `${(v / of * 100).toFixed(3)}%`

export function Hero() {
  const { hero } = copy
  return <section id="top" className="hero" aria-labelledby="hero-title">
    <SiteHeader overlay />
    <div className="hero-inner">
      <div className="site-wrap hero-text">
        <h1 id="hero-title">{hero.title.map(line => <span key={line}>{line}</span>)}</h1>
        <p className="hero-sub">{hero.sub}</p>
        <p className="hero-alt">100% free, open source alternative to <strong>{hero.alternatives[0]}</strong>, <strong>{hero.alternatives[1]}</strong> and <strong>{hero.alternatives[2]}</strong></p>
        <Actions className="hero-actions" />
      </div>
      <div className="hero-visual">
        <picture className="hero-plate">
          <source media="(max-width: 1139px)" type="image/avif" srcSet="/site/hero-phone-480.avif 480w, /site/hero-phone-836.avif 836w" sizes="100vw" />
          <source media="(max-width: 1139px)" type="image/webp" srcSet="/site/hero-phone-480.webp 480w, /site/hero-phone-836.webp 836w" sizes="100vw" />
          <source type="image/avif" srcSet="/site/hero-768.avif 768w, /site/hero-1152.avif 1152w, /site/hero-1536.avif 1536w" sizes="(max-width: 1500px) 100vw, 1500px" />
          <img src="/site/hero-1536.webp" srcSet="/site/hero-768.webp 768w, /site/hero-1152.webp 1152w, /site/hero-1536.webp 1536w" sizes="(max-width: 1500px) 100vw, 1500px" width="1536" height="1024" alt="Fernway's open office in clay: desks with red chairs, the curved reception desk and the glass Juniper interview room, where a panel sits with a candidate." fetchPriority="high" decoding="async" />
        </picture>
        <svg className="hero-leaders" viewBox="0 0 1536 1024" preserveAspectRatio="none" aria-hidden="true">
          {cards.map(({ leader: [x1, y1, x2, y2] }) => <g key={`${x1}-${y1}`}><line x1={x1} y1={y1} x2={x2} y2={y2} /><circle cx={x2} cy={y2} r="5" /></g>)}
        </svg>
        <ul className="hero-cards" aria-label="Fernway's Product Designer hire in Lodge">
          {cards.map(card => <li key={card.lead} className={card.icon ? `hero-card has-icon` : 'hero-card'} style={{ left: pct(card.x, 1536), top: pct(card.y, 1024), width: pct(card.w, 1536) }}>
            {card.icon === 'swap' && <Swap />}{card.icon === 'check' && <Check />}
            <p><span className="nowrap lead">{card.lead === '46 applied' ? <strong>{card.lead}</strong> : card.lead}<span className="lead-sep">{card.lead.endsWith('→') ? '' : '\u00a0·'}</span></span> <Facts items={card.rest} /></p>
          </li>)}
        </ul>
      </div>
    </div>
  </section>
}

function Swap() {
  return <svg className="swap" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" /></svg>
}
