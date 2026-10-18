import '../styles/site.css'
import '../styles/cards.css'
import '../styles/landing.css'
import '../styles/hero.css'
import { SiteFooter } from '../shell/SiteFooter'
import { Booking } from './sections/Booking'
import { Closing } from './sections/Closing'
import { Handoff } from './sections/Handoff'
import { Hero } from './sections/Hero'
import { Interlude } from './sections/Interlude'
import { MoveIn } from './sections/MoveIn'
import { Offer } from './sections/Offer'
import { Posted } from './sections/Posted'
import { Queue } from './sections/Queue'
import { Rebook } from './sections/Rebook'
import { Report } from './sections/Report'
import { Scorecards } from './sections/Scorecards'
import { Story } from './sections/Story'

/**
 * The run site's homepage (run-lodge.com), built from the design desk's approved page (17 Oct 2026): one hire,
 * Jordan Ellis as Fernway's Product Designer, told Find → Hire → Welcome, then the report and the move-in.
 */
export function Landing() {
  return <div className="site home">
    <a className="skip-link" href="#story">Skip to the story</a>
    <main>
      <Hero />
      <Story />
      <Posted />
      <Queue />
      <Booking />
      <Rebook />
      <Scorecards />
      <Offer />
      <Handoff />
      <Interlude />
      <Report />
      <MoveIn />
      <Closing />
    </main>
    <SiteFooter />
  </div>
}
