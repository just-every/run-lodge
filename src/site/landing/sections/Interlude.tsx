import { Plate } from '../parts'

// 10: Monday Nov 16, Jordan's desk set and waiting. The date tag is HTML over the clean plate.
export function Interlude() {
  return <section className="interlude" aria-label="Monday, November 16: Jordan's desk is set and waiting">
    <div className="interlude-stage">
      <Plate name="interlude" widths={[768, 1152, 1536]} sizes="(max-width: 1536px) 100vw, 1536px" width={1536} height={1024} alt="Jordan's new desk in clay on a rounded plinth: a closed laptop, a red mug, a gift with a red ribbon, a badge on a red lanyard, a plant, a red chair and a name card that reads Jordan Ellis · Product Designer." />
      <p className="interlude-tag"><time dateTime="2026-11-16T09:00">Mon Nov 16 · 9:00 a.m.</time></p>
    </div>
  </section>
}
