import { Actions } from '../../shell/Actions'
import { copy } from '../copy'

// 13: Fernway's front entrance on Jordan's first morning. The headline and actions are HTML on the painted sky.
export function Closing() {
  return <section id="start" className="closing" aria-labelledby="start-title">
    <picture className="closing-plate">
      <source media="(max-width: 760px)" type="image/avif" srcSet="/site/closing-phone-480.avif 480w, /site/closing-phone-900.avif 900w" sizes="100vw" />
      <source media="(max-width: 760px)" type="image/webp" srcSet="/site/closing-phone-480.webp 480w, /site/closing-phone-900.webp 900w" sizes="100vw" />
      <source type="image/avif" srcSet="/site/closing-768.avif 768w, /site/closing-1152.avif 1152w, /site/closing-1536.avif 1536w" sizes="100vw" />
      <img src="/site/closing-1536.webp" srcSet="/site/closing-768.webp 768w, /site/closing-1152.webp 1152w, /site/closing-1536.webp 1536w" sizes="100vw" width="1536" height="1024" loading="lazy" decoding="async" alt="Fernway's white clay building on Jordan's first morning: Jordan walks up the steps with a coffee and a red tote while Maya waves from the open wood door under a red awning, beside a sign that reads Welcome, Jordan." />
    </picture>
    <div className="closing-copy site-wrap">
      <h2 id="start-title">{copy.closing}</h2>
      <Actions className="closing-actions" />
    </div>
  </section>
}
