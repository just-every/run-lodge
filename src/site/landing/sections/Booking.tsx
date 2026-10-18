import { Check, Chip, Copy, Section } from '../parts'

// 05: Jordan books the panel from the team's free times on a phone (the clock reads 8:12, the minute he booked),
// and the itinerary that followed: Juniper, 10:00 to 11:30 a.m., invites accepted 3 of 3.
const days: { day: string; times: string[] }[] = [
  { day: 'Tue Oct 20', times: ['1:00 p.m.', '3:30 p.m.'] },
  { day: 'Wed Oct 21', times: ['9:30 a.m.'] },
  { day: 'Thu Oct 22', times: ['10:00 a.m.', '2:30 p.m.'] },
]

export function Booking() {
  return <Section id="booking">
    <Copy id="booking-title" eyebrow="Hire · Tue Oct 13 – Mon Oct 19" title="They pick the time." sub="Candidates book straight from your team's calendars. Lodge sends the invites, holds the room and mails the itinerary." />
    <div className="booking">
      <div className="phone" role="img" aria-label="Jordan's phone at 8:12: Fernway · Panel interview, Product Designer, 90 minutes, Eastern Time. Thursday Oct 22 at 10:00 a.m. is chosen. Confirm.">
        <div className="phone-screen">
          <div className="phone-status"><span>8:12</span><span className="island" aria-hidden="true" /><span className="phone-icons" aria-hidden="true"><Signal /><Wifi /><Battery /></span></div>
          <p className="phone-title">Fernway · Panel interview</p>
          <p className="phone-sub">Product Designer · 90 min · Eastern Time</p>
          <div className="slots">{days.map(d => <div key={d.day} className="slot-day"><p>{d.day}</p>{d.times.map(t => <span key={t} className={d.day === 'Thu Oct 22' && t === '10:00 a.m.' ? 'slot chosen' : 'slot'}>{d.day === 'Thu Oct 22' && t === '10:00 a.m.' && <Tick />}{t}</span>)}</div>)}</div>
          <span className="phone-confirm">Confirm</span>
        </div>
      </div>
      <div className="booking-side">
        <p className="pill-note"><Check /><span><span className="nowrap">Phone screen ·</span> <span className="nowrap">Tue Oct 13 ·</span> <span className="nowrap">9:30 a.m. ·</span> <span className="nowrap">Google Meet ·</span> <span className="nowrap">done</span></span></p>
        <div className="card itinerary">
          <h3 className="card-title big">Itinerary · Jordan Ellis</h3>
          <p className="itin-when">Thu Oct 22 · Juniper · <span className="nowrap">10:00 – 11:30 a.m.</span></p>
          <table className="itin">
            <tbody>
              <tr><td>10:00 a.m.</td><td>Portfolio review</td><td>Dev Kapoor, Lena Brooks</td></tr>
              <tr><td>10:45 a.m.</td><td>Design exercise</td><td>Maya Torres</td></tr>
            </tbody>
          </table>
          <div className="itin-foot"><Chip tone="green" icon="check">Invites accepted 3 of 3</Chip><span>Google Calendar · Outlook</span></div>
        </div>
        <p className="booked">Booked by Jordan · Mon Oct 19, 8:12 p.m.</p>
      </div>
    </div>
  </Section>
}

function Tick() { return <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5" /></svg> }
function Signal() { return <svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg> }
function Wifi() { return <svg viewBox="0 0 16 12"><path d="M8 11.5 5.6 8.9a3.4 3.4 0 0 1 4.8 0zM3.3 6.6a6.6 6.6 0 0 1 9.4 0l-1.4 1.4a4.6 4.6 0 0 0-6.6 0zM1 4.3a9.8 9.8 0 0 1 14 0l-1.4 1.4a7.8 7.8 0 0 0-11.2 0z" /></svg> }
function Battery() { return <svg viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".45" /><rect x="2.5" y="2.5" width="18" height="7" rx="1.6" /><rect x="23.5" y="4" width="2" height="4" rx="1" opacity=".45" /></svg> }
